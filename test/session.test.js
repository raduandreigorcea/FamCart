import { describe, it, expect, beforeEach } from 'vitest'
import {
  rememberUser,
  getRememberedUser,
  forgetUser,
  forgetLocalUserState,
} from '../src/lib/session'
import {
  saveHouseholdSnapshot,
  loadHouseholdSnapshot,
  saveActiveHouseholdId,
  loadActiveHouseholdId,
} from '../src/lib/householdCache'
import { enqueueOfflineMutation, hasQueuedOfflineMutations } from '../src/lib/offlineQueue'
import { makeStorage } from './support/fakeStorage'

describe('session', () => {
  let storage
  beforeEach(() => { storage = makeStorage() })

  it('returns null when no user has been remembered', () => {
    expect(getRememberedUser(storage)).toBe(null)
  })

  it('remembers and reads back the last signed-in user', () => {
    rememberUser(storage, 'user-abc')
    expect(getRememberedUser(storage)).toBe('user-abc')
  })

  it('forgets the user on sign-out', () => {
    rememberUser(storage, 'user-abc')
    forgetUser(storage)
    expect(getRememberedUser(storage)).toBe(null)
  })

  it('never throws when storage is unavailable', () => {
    const broken = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    }
    expect(() => rememberUser(broken, 'x')).not.toThrow()
    expect(getRememberedUser(broken)).toBe(null)
    expect(() => forgetUser(broken)).not.toThrow()
  })
})

// ─── what signing out drops ──────────────────────────────────────────────────
// Sign-out used to spell this list out at the call site and got three of the
// four: the active-household pointer was left behind. Harmless in itself (it is
// rejected on read by any other account) but the list only existed inside one
// component, so the next key added would have been forgotten the same way.
describe('forgetLocalUserState', () => {
  it('drops every key this device holds for the account', () => {
    const storage = makeStorage()
    rememberUser(storage, 'user-1')
    saveHouseholdSnapshot(storage, 'user-1', {
      householdId: 'fam-1',
      householdName: 'Fam',
      householdInviteCode: 'ABCDEFGH',
      householdOwnerId: 'user-1',
      householdItemLimit: 50,
      householdEmoji: '🏠',
      householdMembers: [],
      items: [],
      hasShopped: false,
    })
    saveActiveHouseholdId(storage, 'user-1', 'fam-1')
    enqueueOfflineMutation(storage, 'user-1', { kind: 'delete', id: 'i1' })

    forgetLocalUserState(storage, 'user-1')

    expect(getRememberedUser(storage)).toBeNull()
    expect(loadHouseholdSnapshot(storage, 'user-1')).toBeNull()
    expect(loadActiveHouseholdId(storage, 'user-1')).toBeNull()
    expect(hasQueuedOfflineMutations(storage, 'user-1')).toBe(false)
    // Nothing of this account left anywhere on the device.
    expect(storage.map.size).toBe(0)
  })

  it('leaves another account on the same device alone', () => {
    const storage = makeStorage()
    enqueueOfflineMutation(storage, 'user-a', { kind: 'delete', id: 'a1' })
    enqueueOfflineMutation(storage, 'user-b', { kind: 'delete', id: 'b1' })

    forgetLocalUserState(storage, 'user-a')

    expect(hasQueuedOfflineMutations(storage, 'user-a')).toBe(false)
    expect(hasQueuedOfflineMutations(storage, 'user-b')).toBe(true)
  })
})
