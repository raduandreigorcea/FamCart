import { findActiveItemByName, type ShoppingItem } from './shoppingList'

// Write queue for shopping-list mutations made while offline. The views apply
// every mutation optimistically already; when the browser reports no
// connectivity they enqueue the write here instead of hitting the network, and
// replay the queue in order once connectivity returns. The queue is keyed to
// one user (like the family snapshot) and survives restarts via localStorage,
// pairing with the snapshot cache: the snapshot restores what the list looked
// like, the queue restores what still has to reach the server.

export type OfflineMutation =
  | { kind: 'insert'; id: string; row: Record<string, unknown> }
  | { kind: 'update'; id: string; patch: Record<string, unknown> }
  | { kind: 'delete'; id: string }

export interface FlushResult {
  // Mutations acknowledged by the server (including inserts folded into a
  // concurrent same-name row).
  flushed: number
  // Mutations the server permanently rejected; they are dropped so one bad
  // write can never wedge the queue.
  failed: number
  // True when a network-level failure stopped the replay; the unsent tail is
  // kept for the next attempt.
  interrupted: boolean
}

interface StoredQueue {
  version: number
  userId: string
  mutations: OfflineMutation[]
}

interface Db {
  from(table: string): any
}

const STORAGE_KEY = 'famcart-offline-queue'
const VERSION = 1
const TABLE = 'shopping_list_items'

export function loadOfflineQueue(storage: Storage, userId: string): OfflineMutation[] {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return []
    const stored = JSON.parse(raw) as StoredQueue
    if (stored.version !== VERSION) return []
    // Never replay one account's writes as another account on the same browser.
    if (stored.userId !== userId) return []
    if (!Array.isArray(stored.mutations)) return []
    return stored.mutations
  } catch {
    return []
  }
}

function saveOfflineQueue(storage: Storage, userId: string, mutations: OfflineMutation[]): void {
  try {
    if (!mutations.length) {
      storage.removeItem(STORAGE_KEY)
      return
    }
    const stored: StoredQueue = { version: VERSION, userId, mutations }
    storage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // Quota exceeded or storage disabled — the write is lost on restart, but
    // the in-session optimistic state still stands.
  }
}

// Append a mutation, coalescing against what is already queued so the replay
// sends the fewest requests and never touches rows the server has never seen:
// - update after a queued insert folds the patch into the insert row
// - update after a queued update merges the patches (fields are absolute values)
// - delete of a queued insert cancels the insert (and its updates) entirely
// - delete otherwise supersedes any queued updates for that row
export function enqueueOfflineMutation(
  storage: Storage,
  userId: string,
  mutation: OfflineMutation,
): void {
  const mutations = loadOfflineQueue(storage, userId)

  if (mutation.kind === 'update') {
    const insert = mutations.find(
      (m): m is Extract<OfflineMutation, { kind: 'insert' }> =>
        m.kind === 'insert' && m.id === mutation.id,
    )
    if (insert) {
      insert.row = { ...insert.row, ...mutation.patch }
      saveOfflineQueue(storage, userId, mutations)
      return
    }
    const update = mutations.find(
      (m): m is Extract<OfflineMutation, { kind: 'update' }> =>
        m.kind === 'update' && m.id === mutation.id,
    )
    if (update) {
      update.patch = { ...update.patch, ...mutation.patch }
      saveOfflineQueue(storage, userId, mutations)
      return
    }
  }

  if (mutation.kind === 'delete') {
    const hadQueuedInsert = mutations.some((m) => m.kind === 'insert' && m.id === mutation.id)
    const kept = mutations.filter((m) => m.id !== mutation.id)
    // The row only ever existed locally — nothing to delete on the server.
    if (hadQueuedInsert) {
      saveOfflineQueue(storage, userId, kept)
      return
    }
    kept.push(mutation)
    saveOfflineQueue(storage, userId, kept)
    return
  }

  mutations.push(mutation)
  saveOfflineQueue(storage, userId, mutations)
}

export function hasQueuedOfflineMutations(storage: Storage, userId: string): boolean {
  return loadOfflineQueue(storage, userId).length > 0
}

export function clearOfflineQueue(storage: Storage): void {
  try {
    storage.removeItem(STORAGE_KEY)
  } catch {
    // Storage disabled — nothing to clear.
  }
}

// A request that died at the network layer (or while the browser still reports
// offline) will succeed later — keep the mutation. Anything the server actually
// answered (it has an error `code`) is a real rejection.
//
// `navigator.onLine === false` is a reliable *positive* offline signal but an
// unreliable *negative* one: an Android WebView (and desktop browsers on a
// captive/dead network) often reports `true` with no real connectivity. So we
// also match the fetch-failure message that Supabase surfaces in that case,
// letting callers route the failure through the offline path instead of showing
// a raw "TypeError: Failed to fetch" error.
export function isOfflineError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  if (!error) return false
  const code = (error as { code?: string }).code
  if (code) return false
  const message = (error as { message?: string }).message ?? String(error)
  return /failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(
    message,
  )
}

async function applyMutation(
  db: Db,
  mutation: OfflineMutation,
): Promise<{ ok: boolean; transient: boolean }> {
  if (mutation.kind === 'insert') {
    const { error } = await db.from(TABLE).insert(mutation.row)
    if (!error) return { ok: true, transient: false }
    // Someone added the same item while we were offline: fold our quantity into
    // their row, mirroring the insert-race handling in HomeView.
    if (error.code === '23505') {
      const { data, error: selectErr } = await db
        .from(TABLE)
        .select('*')
        .eq('family_id', mutation.row.family_id)
        .eq('checked', false)
      if (selectErr) return { ok: false, transient: isOfflineError(selectErr) }
      const target = findActiveItemByName((data ?? []) as ShoppingItem[], String(mutation.row.name))
      if (!target) return { ok: false, transient: false }
      const merged = (Number(target.quantity) || 1) + (Number(mutation.row.quantity) || 1)
      const { error: updateErr } = await db
        .from(TABLE)
        .update({ quantity: merged })
        .eq('id', target.id)
      if (updateErr) return { ok: false, transient: isOfflineError(updateErr) }
      return { ok: true, transient: false }
    }
    return { ok: false, transient: isOfflineError(error) }
  }

  if (mutation.kind === 'update') {
    const { error } = await db.from(TABLE).update(mutation.patch).eq('id', mutation.id)
    if (!error) return { ok: true, transient: false }
    return { ok: false, transient: isOfflineError(error) }
  }

  const { error } = await db.from(TABLE).delete().eq('id', mutation.id)
  if (!error) return { ok: true, transient: false }
  return { ok: false, transient: isOfflineError(error) }
}

// Replay the queue in order. The queue is persisted after every mutation so an
// interruption (tab closed, network dropped again) never replays an
// acknowledged write. Callers should re-fetch the list afterwards so local
// state converges on the server's.
export async function flushOfflineQueue(
  storage: Storage,
  userId: string,
  db: Db,
): Promise<FlushResult> {
  const remaining = loadOfflineQueue(storage, userId)
  const result: FlushResult = { flushed: 0, failed: 0, interrupted: false }

  while (remaining.length) {
    const { ok, transient } = await applyMutation(db, remaining[0])
    if (!ok && transient) {
      result.interrupted = true
      saveOfflineQueue(storage, userId, remaining)
      return result
    }
    if (ok) result.flushed++
    else result.failed++
    remaining.shift()
    saveOfflineQueue(storage, userId, remaining)
  }

  return result
}
