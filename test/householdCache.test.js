import { describe, it, expect } from 'vitest'
import {
  loadHouseholdSnapshot,
  saveHouseholdSnapshot,
  clearHouseholdSnapshot,
  loadActiveHouseholdId,
  saveActiveHouseholdId,
  clearActiveHouseholdId,
  SNAPSHOT_MAX_AGE_MS,
} from '../src/lib/householdCache'
import { makeStorage } from './support/fakeStorage'

function makeSnapshot(overrides = {}) {
  return {
    householdId: 'fam-1',
    householdName: 'Fam',
    householdInviteCode: 'ABCDEFGH',
    householdOwnerId: 'user-1',
    householdItemLimit: 50,
    householdEmoji: '🏠',
    householdMembers: [{ user_id: 'user-1', display_name: 'Me', image_url: null, role: 'moderator' }],
    items: [{ id: 'i1', name: 'Milk', quantity: 2, checked: false, created_at: '2026-01-01T00:00:00.000Z' }],
    hasShopped: true,
    ...overrides,
  }
}

// The household id is the one field read back out as a query parameter rather
// than as display text — lib/productSuggestions interpolates it into a
// PostgREST `or` filter — and localStorage is not a trust boundary the app
// controls. A snapshot whose id is not an opaque identifier is refused whole.
describe('householdCache rejects a tampered household id', () => {
  const REJECTED = {
    'a PostgREST filter expression': 'fam-1,household_id.not.is.null',
    'an operator suffix': 'fam-1.eq.anything',
    'a parenthesised condition': 'fam-1,or(a.eq.b)',
    'a quoted string': `fam-1'`,
    'whitespace': 'fam-1 or true',
    'nothing at all': '',
  }

  for (const [what, householdId] of Object.entries(REJECTED)) {
    it(`refuses ${what}`, () => {
      const storage = makeStorage()
      saveHouseholdSnapshot(storage, 'user-1', makeSnapshot({ householdId }))
      expect(loadHouseholdSnapshot(storage, 'user-1')).toBeNull()
    })
  }

  it('still accepts an ordinary id', () => {
    const storage = makeStorage()
    saveHouseholdSnapshot(storage, 'user-1', makeSnapshot({
      householdId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    }))
    expect(loadHouseholdSnapshot(storage, 'user-1')).not.toBeNull()
  })
})

describe('householdCache', () => {
  it('round-trips a snapshot for the same user', () => {
    const storage = makeStorage()
    saveHouseholdSnapshot(storage, 'user-1', makeSnapshot())
    expect(loadHouseholdSnapshot(storage, 'user-1')).toEqual(makeSnapshot())
  })

  it('defaults a snapshot saved before the emoji existed to no emoji', () => {
    const storage = makeStorage()
    const { householdEmoji, ...withoutEmoji } = makeSnapshot()
    saveHouseholdSnapshot(storage, 'user-1', withoutEmoji)
    expect(loadHouseholdSnapshot(storage, 'user-1').householdEmoji).toBe('')
  })

  // Snapshots written before this field existed are still version 1, so they
  // must survive rather than be discarded — false is the pre-existing reading.
  it('defaults a snapshot saved before hasShopped existed to not shopped', () => {
    const storage = makeStorage()
    const { hasShopped, ...older } = makeSnapshot()
    saveHouseholdSnapshot(storage, 'user-1', older)
    expect(loadHouseholdSnapshot(storage, 'user-1').hasShopped).toBe(false)
  })

  it('never returns another user\'s snapshot', () => {
    const storage = makeStorage()
    saveHouseholdSnapshot(storage, 'user-1', makeSnapshot())
    expect(loadHouseholdSnapshot(storage, 'user-2')).toBeNull()
  })

  it('expires snapshots older than the max age', () => {
    const storage = makeStorage()
    const savedAt = 1_000_000
    saveHouseholdSnapshot(storage, 'user-1', makeSnapshot(), savedAt)
    expect(loadHouseholdSnapshot(storage, 'user-1', savedAt + SNAPSHOT_MAX_AGE_MS)).not.toBeNull()
    expect(loadHouseholdSnapshot(storage, 'user-1', savedAt + SNAPSHOT_MAX_AGE_MS + 1)).toBeNull()
  })

  it('returns null for corrupt or structurally invalid data', () => {
    const storage = makeStorage()
    storage.setItem('famcart-household-snapshot', '{not json')
    expect(loadHouseholdSnapshot(storage, 'user-1')).toBeNull()

    saveHouseholdSnapshot(storage, 'user-1', makeSnapshot({ householdId: '' }))
    expect(loadHouseholdSnapshot(storage, 'user-1')).toBeNull()

    saveHouseholdSnapshot(storage, 'user-1', makeSnapshot({ items: 'oops' }))
    expect(loadHouseholdSnapshot(storage, 'user-1')).toBeNull()
  })

  it('fills defaults for missing optional fields', () => {
    const storage = makeStorage()
    saveHouseholdSnapshot(storage, 'user-1', makeSnapshot({ householdName: undefined, householdItemLimit: undefined }))
    const loaded = loadHouseholdSnapshot(storage, 'user-1')
    expect(loaded.householdName).toBe('')
    expect(loaded.householdItemLimit).toBe(50)
  })

  it('swallows storage write failures', () => {
    const storage = makeStorage()
    storage.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    expect(() => saveHouseholdSnapshot(storage, 'user-1', makeSnapshot())).not.toThrow()
  })

  it('clears the snapshot', () => {
    const storage = makeStorage()
    saveHouseholdSnapshot(storage, 'user-1', makeSnapshot())
    clearHouseholdSnapshot(storage)
    expect(loadHouseholdSnapshot(storage, 'user-1')).toBeNull()
  })
})

// ─── one snapshot per account ────────────────────────────────────────────────
// The single device-wide key was never a leak (the userId check below has always
// rejected somebody else's snapshot) but it was a loss: whoever saved last
// owned the key, so signing in as B threw A's cache away.
describe('per-user snapshot keys', () => {
  it('keeps two accounts on one device from overwriting each other', () => {
    const storage = makeStorage()
    saveHouseholdSnapshot(storage, 'user-a', makeSnapshot({ householdName: 'A House' }))
    saveHouseholdSnapshot(storage, 'user-b', makeSnapshot({ householdName: 'B House' }))

    // Before this, B's save took the one key and A's snapshot was simply gone.
    expect(loadHouseholdSnapshot(storage, 'user-a').householdName).toBe('A House')
    expect(loadHouseholdSnapshot(storage, 'user-b').householdName).toBe('B House')
  })

  it('clears only the named account when told which one', () => {
    const storage = makeStorage()
    saveHouseholdSnapshot(storage, 'user-a', makeSnapshot())
    saveHouseholdSnapshot(storage, 'user-b', makeSnapshot())

    clearHouseholdSnapshot(storage, 'user-a')

    expect(loadHouseholdSnapshot(storage, 'user-a')).toBeNull()
    expect(loadHouseholdSnapshot(storage, 'user-b')).not.toBeNull()
  })

  it('clears every account when it cannot say whose it is', () => {
    const storage = makeStorage()
    saveHouseholdSnapshot(storage, 'user-a', makeSnapshot())
    saveHouseholdSnapshot(storage, 'user-b', makeSnapshot())

    // Signing out from a screen that never learned who was signed in: the safer
    // end of the trade on a shared browser.
    clearHouseholdSnapshot(storage)

    expect(loadHouseholdSnapshot(storage, 'user-a')).toBeNull()
    expect(loadHouseholdSnapshot(storage, 'user-b')).toBeNull()
  })
})

// The fourth and last record on this device to move off a single device-wide
// key with the account stamped inside it, after the offline queue, the snapshot
// above and the notification preference.
//
// Mildest of the four by a distance -- losing it means landing on your first
// household rather than the one you last picked, where the queue loses unsent
// writes -- which is exactly why it was the one left behind. It is the same
// shape one severity down, and the shape is what comes back somewhere it
// matters.
describe('per-user active household', () => {

  it('keeps two accounts on one device from overwriting each other', () => {
    const storage = makeStorage()
    saveActiveHouseholdId(storage, 'user-a', 'fam-a')
    saveActiveHouseholdId(storage, 'user-b', 'fam-b')

    // Before this, B's save took the one key and A's choice was simply gone.
    expect(loadActiveHouseholdId(storage, 'user-a')).toBe('fam-a')
    expect(loadActiveHouseholdId(storage, 'user-b')).toBe('fam-b')
  })

  it('clears only the named account when told which one', () => {
    const storage = makeStorage()
    saveActiveHouseholdId(storage, 'user-a', 'fam-a')
    saveActiveHouseholdId(storage, 'user-b', 'fam-b')

    clearActiveHouseholdId(storage, 'user-a')

    expect(loadActiveHouseholdId(storage, 'user-a')).toBeNull()
    expect(loadActiveHouseholdId(storage, 'user-b')).toBe('fam-b')
  })

  it('clears every account when it cannot say whose it is', () => {
    const storage = makeStorage()
    saveActiveHouseholdId(storage, 'user-a', 'fam-a')
    saveActiveHouseholdId(storage, 'user-b', 'fam-b')

    clearActiveHouseholdId(storage)

    expect(loadActiveHouseholdId(storage, 'user-a')).toBeNull()
    expect(loadActiveHouseholdId(storage, 'user-b')).toBeNull()
  })

  // The stored id is read back out as a query parameter, so the tamper check
  // that guards the snapshot's household id guards this one too.
  it('refuses an id that is not an opaque identifier', () => {
    const storage = makeStorage()
    storage.setItem(
      'famcart-active-household:user-1',
      JSON.stringify({ userId: 'user-1', householdId: 'fam-1,name.eq.x' }),
    )
    expect(loadActiveHouseholdId(storage, 'user-1')).toBeNull()
  })
})
