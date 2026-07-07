import { describe, it, expect } from 'vitest'
import {
  loadFamilySnapshot,
  saveFamilySnapshot,
  clearFamilySnapshot,
  SNAPSHOT_MAX_AGE_MS,
} from '../src/lib/familyCache'

function makeStorage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    map,
  }
}

function makeSnapshot(overrides = {}) {
  return {
    familyId: 'fam-1',
    familyName: 'Fam',
    familyInviteCode: 'ABCDEFGH',
    familyOwnerId: 'user-1',
    familyItemLimit: 50,
    familyMembers: [{ user_id: 'user-1', display_name: 'Me', image_url: null, role: 'moderator' }],
    items: [{ id: 'i1', name: 'Milk', quantity: 2, checked: false, created_at: '2026-01-01T00:00:00.000Z' }],
    ...overrides,
  }
}

describe('familyCache', () => {
  it('round-trips a snapshot for the same user', () => {
    const storage = makeStorage()
    saveFamilySnapshot(storage, 'user-1', makeSnapshot())
    expect(loadFamilySnapshot(storage, 'user-1')).toEqual(makeSnapshot())
  })

  it('never returns another user\'s snapshot', () => {
    const storage = makeStorage()
    saveFamilySnapshot(storage, 'user-1', makeSnapshot())
    expect(loadFamilySnapshot(storage, 'user-2')).toBeNull()
  })

  it('expires snapshots older than the max age', () => {
    const storage = makeStorage()
    const savedAt = 1_000_000
    saveFamilySnapshot(storage, 'user-1', makeSnapshot(), savedAt)
    expect(loadFamilySnapshot(storage, 'user-1', savedAt + SNAPSHOT_MAX_AGE_MS)).not.toBeNull()
    expect(loadFamilySnapshot(storage, 'user-1', savedAt + SNAPSHOT_MAX_AGE_MS + 1)).toBeNull()
  })

  it('returns null for corrupt or structurally invalid data', () => {
    const storage = makeStorage()
    storage.setItem('famcart-family-snapshot', '{not json')
    expect(loadFamilySnapshot(storage, 'user-1')).toBeNull()

    saveFamilySnapshot(storage, 'user-1', makeSnapshot({ familyId: '' }))
    expect(loadFamilySnapshot(storage, 'user-1')).toBeNull()

    saveFamilySnapshot(storage, 'user-1', makeSnapshot({ items: 'oops' }))
    expect(loadFamilySnapshot(storage, 'user-1')).toBeNull()
  })

  it('fills defaults for missing optional fields', () => {
    const storage = makeStorage()
    saveFamilySnapshot(storage, 'user-1', makeSnapshot({ familyName: undefined, familyItemLimit: undefined }))
    const loaded = loadFamilySnapshot(storage, 'user-1')
    expect(loaded.familyName).toBe('')
    expect(loaded.familyItemLimit).toBe(50)
  })

  it('swallows storage write failures', () => {
    const storage = makeStorage()
    storage.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    expect(() => saveFamilySnapshot(storage, 'user-1', makeSnapshot())).not.toThrow()
  })

  it('clears the snapshot', () => {
    const storage = makeStorage()
    saveFamilySnapshot(storage, 'user-1', makeSnapshot())
    clearFamilySnapshot(storage)
    expect(loadFamilySnapshot(storage, 'user-1')).toBeNull()
  })
})
