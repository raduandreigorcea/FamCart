// Unit tests for the offline write queue: coalescing rules keep the replay
// minimal and never touch rows the server has never seen; the flush must
// survive interruptions without replaying acknowledged writes and must never
// let one rejected mutation wedge the rest of the queue.
import { describe, it, expect } from 'vitest'
import {
  loadOfflineQueue,
  enqueueOfflineMutation,
  hasQueuedOfflineMutations,
  clearOfflineQueue,
  flushOfflineQueue,
} from '../src/lib/offlineQueue'
import { createFakeDb } from './support/fakeSupabase.js'

function makeStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  }
}

const USER = 'user-1'

function insertMutation(id, overrides = {}) {
  return {
    kind: 'insert',
    id,
    row: { id, family_id: 'fam-1', name: 'Milk', quantity: 1, ...overrides },
  }
}

describe('enqueueOfflineMutation', () => {
  it('round-trips mutations in order, keyed to the user', () => {
    const storage = makeStorage()
    enqueueOfflineMutation(storage, USER, insertMutation('a'))
    enqueueOfflineMutation(storage, USER, { kind: 'delete', id: 'server-row' })

    expect(loadOfflineQueue(storage, USER).map((m) => m.kind)).toEqual(['insert', 'delete'])
    // Another account on the same browser must never see (or replay) this queue.
    expect(loadOfflineQueue(storage, 'user-2')).toEqual([])
    expect(hasQueuedOfflineMutations(storage, USER)).toBe(true)

    clearOfflineQueue(storage)
    expect(hasQueuedOfflineMutations(storage, USER)).toBe(false)
  })

  it('returns an empty queue for corrupted storage instead of throwing', () => {
    const storage = makeStorage()
    storage.setItem('famcart-offline-queue', '{not json')
    expect(loadOfflineQueue(storage, USER)).toEqual([])
  })

  it('folds an update into a queued insert for the same row', () => {
    const storage = makeStorage()
    enqueueOfflineMutation(storage, USER, insertMutation('a', { quantity: 1 }))
    enqueueOfflineMutation(storage, USER, { kind: 'update', id: 'a', patch: { quantity: 3 } })

    const queue = loadOfflineQueue(storage, USER)
    expect(queue).toHaveLength(1)
    expect(queue[0].kind).toBe('insert')
    expect(queue[0].row.quantity).toBe(3)
  })

  it('merges consecutive updates for the same row (absolute values, last wins)', () => {
    const storage = makeStorage()
    enqueueOfflineMutation(storage, USER, { kind: 'update', id: 'a', patch: { quantity: 2 } })
    enqueueOfflineMutation(storage, USER, { kind: 'update', id: 'a', patch: { quantity: 5, checked: true } })

    const queue = loadOfflineQueue(storage, USER)
    expect(queue).toHaveLength(1)
    expect(queue[0].patch).toEqual({ quantity: 5, checked: true })
  })

  it('cancels a queued insert (and its updates) when the row is deleted offline', () => {
    const storage = makeStorage()
    enqueueOfflineMutation(storage, USER, insertMutation('a'))
    enqueueOfflineMutation(storage, USER, { kind: 'update', id: 'a', patch: { checked: true } })
    enqueueOfflineMutation(storage, USER, { kind: 'delete', id: 'a' })

    expect(loadOfflineQueue(storage, USER)).toEqual([])
  })

  it('supersedes queued updates with the delete for a server row', () => {
    const storage = makeStorage()
    enqueueOfflineMutation(storage, USER, { kind: 'update', id: 'srv-1', patch: { checked: true } })
    enqueueOfflineMutation(storage, USER, { kind: 'delete', id: 'srv-1' })

    const queue = loadOfflineQueue(storage, USER)
    expect(queue).toEqual([{ kind: 'delete', id: 'srv-1' }])
  })
})

describe('flushOfflineQueue', () => {
  it('replays mutations in order and empties the queue', async () => {
    const storage = makeStorage()
    enqueueOfflineMutation(storage, USER, insertMutation('a'))
    enqueueOfflineMutation(storage, USER, { kind: 'update', id: 'srv-1', patch: { checked: true } })
    enqueueOfflineMutation(storage, USER, { kind: 'delete', id: 'srv-2' })

    const db = createFakeDb()
    db.handlers['shopping_list_items.insert'] = () => ({ data: null, error: null })
    db.handlers['shopping_list_items.update'] = () => ({ data: null, error: null })
    db.handlers['shopping_list_items.delete'] = () => ({ data: null, error: null })

    const result = await flushOfflineQueue(storage, USER, db)

    expect(result).toEqual({ flushed: 3, failed: 0, interrupted: false })
    expect(db.calls.map((q) => q.op)).toEqual(['insert', 'update', 'delete'])
    expect(db.calls[1].filters.id).toBe('srv-1')
    expect(db.calls[2].filters.id).toBe('srv-2')
    expect(hasQueuedOfflineMutations(storage, USER)).toBe(false)
  })

  it('is a no-op on an empty queue', async () => {
    const db = createFakeDb()
    const result = await flushOfflineQueue(makeStorage(), USER, db)
    expect(result).toEqual({ flushed: 0, failed: 0, interrupted: false })
    expect(db.calls).toHaveLength(0)
  })

  it('folds a conflicting insert (23505) into the concurrent same-name row', async () => {
    const storage = makeStorage()
    enqueueOfflineMutation(storage, USER, insertMutation('a', { name: 'Milk', quantity: 2 }))

    const db = createFakeDb()
    db.handlers['shopping_list_items.insert'] = () => ({
      data: null,
      error: { code: '23505', message: 'duplicate key value' },
    })
    db.handlers['shopping_list_items.select'] = () => ({
      data: [{ id: 'srv-1', name: 'milk', checked: false, quantity: 3 }],
      error: null,
    })
    db.handlers['shopping_list_items.update'] = () => ({ data: null, error: null })

    const result = await flushOfflineQueue(storage, USER, db)

    expect(result).toEqual({ flushed: 1, failed: 0, interrupted: false })
    const update = db.calls.find((q) => q.op === 'update')
    expect(update.filters.id).toBe('srv-1')
    expect(update.payload).toEqual({ quantity: 5 })
    expect(hasQueuedOfflineMutations(storage, USER)).toBe(false)
  })

  it('stops on a network-level failure and keeps the unsent tail', async () => {
    const storage = makeStorage()
    enqueueOfflineMutation(storage, USER, { kind: 'update', id: 'srv-1', patch: { checked: true } })
    enqueueOfflineMutation(storage, USER, { kind: 'delete', id: 'srv-2' })

    const db = createFakeDb()
    db.handlers['shopping_list_items.update'] = () => ({
      data: null,
      error: { message: 'TypeError: Failed to fetch' },
    })

    const result = await flushOfflineQueue(storage, USER, db)

    expect(result).toEqual({ flushed: 0, failed: 0, interrupted: true })
    // Both mutations survive for the next attempt — nothing was acknowledged.
    expect(loadOfflineQueue(storage, USER)).toHaveLength(2)
  })

  it('drops a permanently rejected mutation and continues with the rest', async () => {
    const storage = makeStorage()
    enqueueOfflineMutation(storage, USER, { kind: 'update', id: 'srv-1', patch: { checked: true } })
    enqueueOfflineMutation(storage, USER, { kind: 'delete', id: 'srv-2' })

    const db = createFakeDb()
    db.handlers['shopping_list_items.update'] = () => ({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    })
    db.handlers['shopping_list_items.delete'] = () => ({ data: null, error: null })

    const result = await flushOfflineQueue(storage, USER, db)

    expect(result).toEqual({ flushed: 1, failed: 1, interrupted: false })
    expect(db.calls.map((q) => q.op)).toEqual(['update', 'delete'])
    expect(hasQueuedOfflineMutations(storage, USER)).toBe(false)
  })
})
