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
  isRateLimitedError,
} from '../src/lib/offlineQueue'
import { createFakeDb } from './support/fakeSupabase.js'
import { makeStorage } from './support/fakeStorage.js'

const USER = 'user-1'

function insertMutation(id, overrides = {}) {
  return {
    kind: 'insert',
    id,
    row: { id, household_id: 'fam-1', name: 'Milk', quantity: 1, ...overrides },
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

  it('keeps each account queue separate when a session ends without signing out', () => {
    const storage = makeStorage()
    enqueueOfflineMutation(storage, USER, insertMutation('a'))
    // A different account enqueues on the same device. This used to overwrite
    // the single shared key and lose USER's unsent writes silently.
    enqueueOfflineMutation(storage, 'user-2', insertMutation('b'))

    expect(loadOfflineQueue(storage, USER).map((m) => m.id)).toEqual(['a'])
    expect(loadOfflineQueue(storage, 'user-2').map((m) => m.id)).toEqual(['b'])
  })

  it('migrates a queue written under the pre-per-user key', () => {
    const storage = makeStorage()
    // Exactly what an older build left behind: one key, the account stamped inside.
    storage.setItem(
      'famcart-offline-queue',
      JSON.stringify({ version: 1, userId: USER, mutations: [insertMutation('a')] }),
    )

    expect(loadOfflineQueue(storage, USER).map((m) => m.id)).toEqual(['a'])
    // Another account still must not see it.
    expect(loadOfflineQueue(storage, 'user-2')).toEqual([])

    // The next save moves it across and retires the old key, so an emptied
    // per-user queue cannot fall back to this stale copy.
    enqueueOfflineMutation(storage, USER, insertMutation('b'))
    expect(storage.getItem('famcart-offline-queue')).toBeNull()
    expect(loadOfflineQueue(storage, USER).map((m) => m.id)).toEqual(['a', 'b'])
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

  // The maker is half the match key (004_shopping_list.sql), and the fold used
  // to ignore it — so a conflict on a product that has one found no target,
  // counted as a permanent rejection, and was dropped. Every catalog pick and
  // every barcode scan carries a maker, so this was the common path.
  it('folds a conflicting insert into the same-name row with the same maker', async () => {
    const storage = makeStorage()
    enqueueOfflineMutation(
      storage,
      USER,
      insertMutation('a', { name: 'Lapte 3.5% 1L', maker: 'Napolact', quantity: 2 }),
    )

    const db = createFakeDb()
    db.handlers['shopping_list_items.insert'] = () => ({
      data: null,
      error: { code: '23505', message: 'duplicate key value' },
    })
    db.handlers['shopping_list_items.select'] = () => ({
      data: [
        // Same name, different maker: a different product, and not the row we
        // collided with.
        { id: 'srv-other', name: 'Lapte 3.5% 1L', maker: 'LaDorna', checked: false, quantity: 9 },
        { id: 'srv-1', name: 'lapte 3.5% 1l', maker: 'napolact', checked: false, quantity: 3 },
      ],
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

  // A flush is a sequence of round trips, and the user is still using the app
  // during them. On a flaky connection their next tap fails at the network
  // layer, takes the offline path, and lands in storage — while the flush is
  // between two of its own writes. The flush must not carry a queue it read
  // before that happened back over the top of it.
  //
  // The handler below enqueues from inside the request, which is exactly the
  // window: after the flush loaded the queue, before it saves it again.
  it('sends a write enqueued while a mutation was on the wire', async () => {
    const storage = makeStorage()
    enqueueOfflineMutation(storage, USER, insertMutation('a'))
    enqueueOfflineMutation(storage, USER, { kind: 'delete', id: 'srv-1' })

    const db = createFakeDb()
    // One tap, during the first request only — otherwise replaying the write it
    // adds would add another, forever.
    let tapped = false
    db.handlers['shopping_list_items.insert'] = () => {
      if (!tapped) {
        tapped = true
        // The tap that happened while this insert was in flight.
        enqueueOfflineMutation(storage, USER, insertMutation('late'))
      }
      return { data: null, error: null }
    }
    db.handlers['shopping_list_items.delete'] = () => ({ data: null, error: null })

    const result = await flushOfflineQueue(storage, USER, db)

    // Three, not two: the write made mid-flush is picked up by this same flush
    // rather than being overwritten by the queue it read before that tap.
    expect(result).toEqual({ flushed: 3, failed: 0, interrupted: false })
    expect(db.calls.filter((q) => q.op === 'insert').map((q) => q.payload.id)).toEqual([
      'a',
      'late',
    ])
    expect(hasQueuedOfflineMutations(storage, USER)).toBe(false)
  })

  // Same window, on the path that stops early. The transient branch used to
  // persist its own snapshot too, so it dropped a concurrent write just as the
  // acknowledged path did.
  it('keeps a write enqueued while an interrupted mutation was on the wire', async () => {
    const storage = makeStorage()
    enqueueOfflineMutation(storage, USER, { kind: 'update', id: 'srv-1', patch: { checked: true } })

    const db = createFakeDb()
    db.handlers['shopping_list_items.update'] = () => {
      enqueueOfflineMutation(storage, USER, insertMutation('late'))
      return { data: null, error: { message: 'TypeError: Failed to fetch' } }
    }

    const result = await flushOfflineQueue(storage, USER, db)

    expect(result).toEqual({ flushed: 0, failed: 0, interrupted: true })
    // The unsent update, and the write made while it was failing.
    expect(loadOfflineQueue(storage, USER).map((m) => m.id)).toEqual(['srv-1', 'late'])
  })
})

// The item-insert ceiling in 004_shopping_list.sql. A throttled write
// looks like a permanent rejection to the flush -- the server answered, so it
// carries an error code -- and would be DROPPED by the rule directly above this.
// That is the wrong call for a refusal that expires: replaying a long offline
// trip is both the likeliest way to reach the ceiling and the costliest place to
// lose writes.
describe('rate-limited writes', () => {
  const throttled = {
    code: 'P0001',
    message: 'Too many items added in a short time. Try again shortly.',
    details: 'item_insert_rate_limit_exceeded',
  }

  it('recognises the throttle in either field the server may use', () => {
    expect(isRateLimitedError(throttled)).toBe(true)
    // PostgREST has moved DETAIL between fields across versions; the queue is
    // not where a silent data-loss bug should hide behind one of them.
    expect(isRateLimitedError({ message: 'item_insert_rate_limit_exceeded' })).toBe(true)
    expect(isRateLimitedError({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(isRateLimitedError(null)).toBe(false)
  })

  it('keeps a throttled insert for the next attempt instead of dropping it', async () => {
    const storage = makeStorage()
    enqueueOfflineMutation(storage, USER, insertMutation('a'))
    enqueueOfflineMutation(storage, USER, insertMutation('b'))

    const db = createFakeDb()
    db.handlers['shopping_list_items.insert'] = () => ({ data: null, error: throttled })

    const result = await flushOfflineQueue(storage, USER, db)

    // Interrupted, not failed: nothing was rejected on its merits.
    expect(result).toEqual({ flushed: 0, failed: 0, interrupted: true })
    expect(loadOfflineQueue(storage, USER)).toHaveLength(2)
    // Stopped at the first one rather than burning the rest against a ceiling
    // that is already refusing them.
    expect(db.calls).toHaveLength(1)
  })
})

// ─── upgrading across the families → households rename ───────────────────────
// A queued insert carries the literal row it will POST. One enqueued by a
// pre-rename build says `family_id`, which is now a column that does not exist,
// so the replay would be rejected permanently — and this queue drops permanent
// failures by design. Without the rewrite on load, anything a user added while
// offline during the upgrade would vanish with no error they ever see.
describe('legacy pre-rename queue rows', () => {
  const KEY = 'famcart-offline-queue'

  function writeLegacyQueue(storage, mutations) {
    storage.setItem(KEY, JSON.stringify({ version: 1, userId: USER, mutations }))
  }

  it('rewrites family_id to household_id on a queued insert', () => {
    const storage = makeStorage()
    writeLegacyQueue(storage, [
      { kind: 'insert', id: 'i1', row: { id: 'i1', family_id: 'fam-1', name: 'Lapte', quantity: 2 } },
    ])

    const [mutation] = loadOfflineQueue(storage, USER)
    expect(mutation.row.household_id).toBe('fam-1')
    expect(mutation.row).not.toHaveProperty('family_id')
    // Everything else about the row survives untouched.
    expect(mutation.row.name).toBe('Lapte')
    expect(mutation.row.quantity).toBe(2)
  })

  it('leaves an already-migrated row alone', () => {
    const storage = makeStorage()
    writeLegacyQueue(storage, [insertMutation('i1')])

    const [mutation] = loadOfflineQueue(storage, USER)
    expect(mutation.row.household_id).toBe('fam-1')
    expect(mutation.row).not.toHaveProperty('family_id')
  })

  it('does not invent a row key on updates and deletes', () => {
    const storage = makeStorage()
    writeLegacyQueue(storage, [
      { kind: 'update', id: 'i1', patch: { checked: true } },
      { kind: 'delete', id: 'i2' },
    ])

    const [update, remove] = loadOfflineQueue(storage, USER)
    expect(update).toEqual({ kind: 'update', id: 'i1', patch: { checked: true } })
    expect(remove).toEqual({ kind: 'delete', id: 'i2' })
  })

  it('replays a legacy insert against the renamed column', async () => {
    const storage = makeStorage()
    writeLegacyQueue(storage, [
      { kind: 'insert', id: 'i1', row: { id: 'i1', family_id: 'fam-1', name: 'Lapte', quantity: 2 } },
    ])

    const db = createFakeDb()
    db.handlers['shopping_list_items.insert'] = () => ({ data: null, error: null })

    const result = await flushOfflineQueue(storage, USER, db)
    expect(result).toEqual({ flushed: 1, failed: 0, interrupted: false })
    // What actually reaches the server carries the new column name.
    expect(db.calls[0].payload.household_id).toBe('fam-1')
    expect(db.calls[0].payload).not.toHaveProperty('family_id')
  })

  // Unbounded, the only limit was localStorage's own quota — a device-dependent
  // cliff that arrives mid-write and was swallowed silently.
  describe('the queue ceiling', () => {
    // Distinct rows, so coalescing cannot collapse them and the count is real.
    function fill(storage, count) {
      for (let i = 0; i < count; i++) {
        enqueueOfflineMutation(storage, USER, { kind: 'delete', id: `row-${i}` })
      }
    }

    it('keeps everything below the ceiling', () => {
      const storage = makeStorage()
      fill(storage, 500)
      expect(loadOfflineQueue(storage, USER)).toHaveLength(500)
    })

    it('stops growing once the ceiling is reached', () => {
      const storage = makeStorage()
      fill(storage, 520)
      expect(loadOfflineQueue(storage, USER)).toHaveLength(500)
    })

    it('drops the oldest, keeping the write the user just made', () => {
      const storage = makeStorage()
      fill(storage, 510)

      const queued = loadOfflineQueue(storage, USER)
      // The ten earliest are gone; the most recent survived.
      expect(queued[0]).toEqual({ kind: 'delete', id: 'row-10' })
      expect(queued[queued.length - 1]).toEqual({ kind: 'delete', id: 'row-509' })
    })
  })
})
