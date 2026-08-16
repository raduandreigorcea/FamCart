import { describe, it, expect } from 'vitest'
import {
  loadHouseholdSnapshot,
  saveHouseholdSnapshot,
  clearHouseholdSnapshot,
  SNAPSHOT_MAX_AGE_MS,
} from '../src/lib/householdCache'

function makeStorage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    // length/key are part of the real Storage interface, and
    // clearHouseholdSnapshot uses them to find every account's snapshot when it
    // is not told which one to clear. Without them here that branch would be
    // skipped by its own capability guard and never actually run under test.
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    map,
  }
}

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

// ─── upgrading across the families → households rename ───────────────────────
// Everyone who used the app before that deploy has a snapshot under the old key
// with the old field names sitting in their browser. Discarding it would cost a
// returning user their instant-paint list for no reason, so it is read once and
// rewritten under the new key.
describe('legacy pre-rename snapshot', () => {
  const LEGACY_KEY = 'famcart-family-snapshot'
  const KEY = 'famcart-household-snapshot:user-1'

  function writeLegacy(storage, now) {
    storage.setItem(
      LEGACY_KEY,
      JSON.stringify({
        version: 1,
        userId: 'user-1',
        savedAt: now,
        familyId: 'fam-1',
        familyName: 'Acasa',
        familyInviteCode: 'ABCDEFGH',
        familyOwnerId: 'user-1',
        familyItemLimit: 40,
        familyEmoji: '🏠',
        familyMembers: [{ user_id: 'user-1', display_name: 'Me', image_url: null, role: 'moderator' }],
        items: [{ id: 'i1', name: 'Lapte', quantity: 2, checked: false, created_at: '2026-01-01T00:00:00.000Z' }],
        hasShopped: true,
      }),
    )
  }

  it('reads a snapshot written under the old key and field names', () => {
    const storage = makeStorage()
    const now = Date.now()
    writeLegacy(storage, now)

    const loaded = loadHouseholdSnapshot(storage, 'user-1', now)
    expect(loaded).not.toBeNull()
    expect(loaded.householdId).toBe('fam-1')
    expect(loaded.householdName).toBe('Acasa')
    expect(loaded.householdInviteCode).toBe('ABCDEFGH')
    expect(loaded.householdItemLimit).toBe(40)
    expect(loaded.householdEmoji).toBe('🏠')
    expect(loaded.householdMembers).toHaveLength(1)
    expect(loaded.items).toHaveLength(1)
    expect(loaded.hasShopped).toBe(true)
  })

  it('still refuses another account\'s legacy snapshot', () => {
    const storage = makeStorage()
    const now = Date.now()
    writeLegacy(storage, now)
    expect(loadHouseholdSnapshot(storage, 'someone-else', now)).toBeNull()
  })

  it('retires the old key once a new snapshot is saved', () => {
    const storage = makeStorage()
    const now = Date.now()
    writeLegacy(storage, now)

    saveHouseholdSnapshot(storage, 'user-1', makeSnapshot(), now)
    expect(storage.getItem(LEGACY_KEY)).toBeNull()
    expect(storage.getItem(KEY)).not.toBeNull()
  })

  it('prefers the new key when both are present', () => {
    const storage = makeStorage()
    const now = Date.now()
    writeLegacy(storage, now)
    saveHouseholdSnapshot(storage, 'user-1', makeSnapshot({ householdName: 'Newer' }), now)

    expect(loadHouseholdSnapshot(storage, 'user-1', now).householdName).toBe('Newer')
  })

  it('clears both keys on sign-out', () => {
    const storage = makeStorage()
    const now = Date.now()
    writeLegacy(storage, now)
    saveHouseholdSnapshot(storage, 'user-1', makeSnapshot(), now)

    clearHouseholdSnapshot(storage)
    expect(storage.getItem(KEY)).toBeNull()
    expect(storage.getItem(LEGACY_KEY)).toBeNull()
  })
})

// ─── one snapshot per account ────────────────────────────────────────────────
// The single device-wide key was never a leak (the userId check below has always
// rejected somebody else's snapshot) but it was a loss: whoever saved last
// owned the key, so signing in as B threw A's cache away.
describe('per-user snapshot keys', () => {
  const SHARED_LEGACY_KEY = 'famcart-household-snapshot'

  it('keeps two accounts on one device from overwriting each other', () => {
    const storage = makeStorage()
    saveHouseholdSnapshot(storage, 'user-a', makeSnapshot({ householdName: 'A House' }))
    saveHouseholdSnapshot(storage, 'user-b', makeSnapshot({ householdName: 'B House' }))

    // Before this, B's save took the one key and A's snapshot was simply gone.
    expect(loadHouseholdSnapshot(storage, 'user-a').householdName).toBe('A House')
    expect(loadHouseholdSnapshot(storage, 'user-b').householdName).toBe('B House')
  })

  it('adopts a snapshot left under the old device-wide key', () => {
    const storage = makeStorage()
    const now = Date.now()
    storage.setItem(
      SHARED_LEGACY_KEY,
      JSON.stringify({ ...makeSnapshot({ householdName: 'Carried over' }), version: 1, userId: 'user-1', savedAt: now }),
    )

    expect(loadHouseholdSnapshot(storage, 'user-1', now).householdName).toBe('Carried over')

    // And retires it on the next save, so it cannot come back as a stale
    // fallback once the per-user key is cleared.
    saveHouseholdSnapshot(storage, 'user-1', makeSnapshot({ householdName: 'Fresh' }), now)
    expect(storage.getItem(SHARED_LEGACY_KEY)).toBeNull()
    expect(loadHouseholdSnapshot(storage, 'user-1', now).householdName).toBe('Fresh')
  })

  it('still refuses a device-wide snapshot belonging to another account', () => {
    const storage = makeStorage()
    const now = Date.now()
    storage.setItem(
      SHARED_LEGACY_KEY,
      JSON.stringify({ ...makeSnapshot(), version: 1, userId: 'someone-else', savedAt: now }),
    )
    expect(loadHouseholdSnapshot(storage, 'user-1', now)).toBeNull()
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
