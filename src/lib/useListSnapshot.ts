import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import {
  loadListSnapshot,
  saveListSnapshot,
  type ListSnapshot,
} from './listCache'
import { ITEM_LIMIT_DEFAULT } from './limits'
import type { ListMemberProfile, ShoppingItemRow } from './listRealtime'

// The painted cache: reading the last known list state back on startup,
// and keeping it current afterwards.
//
// Stale-while-revalidate, and the stale half is most of the value. A returning
// user sees their real list instead of a column of skeletons while Clerk warms
// up and the first fetches run; offline that paint is the entire boot.
//
// ─── WHY THIS IS ONE FILE ────────────────────────────────────────────────────
//
// The three operations here each name the same set of fields, and they have to
// agree. Painting sets them, discarding a paint clears them, persisting reads
// them. HomeView had all three several hundred lines apart, and they had
// already drifted once: listItemLimit and the cached shopping answer were
// set by the paint and not cleared by the discard, so after Clerk resolved to a
// different account the PREVIOUS user's item cap still governed the add form
// until loadListHeader returned, and their shopping history decided whether
// the new user's empty list read "All bought" or "Nothing here yet".
//
// The lists are now guarded by the compiler rather than by a comment. Adding a
// field to ListSnapshot fails the build in three places at once, which was
// checked by doing it: `EMPTY` below stops satisfying its Record, `persist`
// stops building a whole ListSnapshot, and the caller's `refs` object stops
// matching SnapshotRefs.
//
// `hydrate` is the exception and the one to read carefully. It reads from the
// snapshot it was handed, so a field it forgets to paint is not an error
// anywhere -- it simply arrives as whatever the ref already held.

/** The fields the paint owns. hasShopped is separate: see cachedShoppedListId. */
type PaintedFields = Omit<ListSnapshot, 'hasShopped'>

/** The view's refs for those fields, which it also renders from directly. */
export type SnapshotRefs = {
  [K in keyof Omit<PaintedFields, 'listId'>]: Ref<PaintedFields[K]>
} & {
  // Wider than the snapshot's own: the view's "no list" is null, while a
  // snapshot that exists always describes one.
  listId: Ref<string | null>
}

// What each field goes back to when a paint is thrown away.
//
// `satisfies` rather than a plain annotation, which is the whole point of it
// being here: it demands every key of PaintedFields and rejects any extra, so a
// field added to the snapshot cannot be painted without also being clearable.
// A plain object literal would silently allow the gap that caused the bug this
// file's header describes.
const EMPTY = {
  // null, not '': it is the ref's declared "no list", and HomeView tests it
  // with truthiness that would let a second sentinel hide.
  listId: null,
  listName: '',
  listInviteCode: '',
  listOwnerId: '',
  listItemLimit: ITEM_LIMIT_DEFAULT,
  listEmoji: '',
  listMembers: [] as ListMemberProfile[],
  items: [] as ShoppingItemRow[],
} satisfies Record<keyof PaintedFields, unknown>

export interface ListSnapshotState {
  /** A cached snapshot has been painted, so the list on screen is real. */
  paintedFromCache: Ref<boolean>
  /**
   * Which list the cached snapshot said had shopped, or '' for none.
   *
   * The list id rather than a bare boolean, because the snapshot is keyed
   * to the USER: after creating or joining a list, that list is active
   * immediately while the painted snapshot still describes the previous one. A
   * boolean carried the old list's answer straight onto the new
   * list's empty list, which then opened on "All bought" having bought
   * nothing. Storing what the answer is ABOUT makes it self-invalidating.
   */
  cachedShoppedListId: Ref<string>
  /**
   * Whether a snapshot exists for this user at all.
   *
   * Separate from hydrate() because the boot path asks a different question
   * than "did you paint": with Clerk still unresolved, the existence of a
   * snapshot is what decides whether an offline boot may call itself
   * initialized. hydrate() declines when the list is already populated, which
   * is not the same answer.
   */
  hasSnapshot: () => boolean
  /** Paint the last known state, if there is one for this user. */
  hydrate: () => void
  /** Throw away a paint made for somebody other than the confirmed account. */
  discard: () => void
  /** Whether the current paint belongs to `userId`. */
  paintedFor: (userId: string) => boolean
  /** Write now if a write is owed. For the way out, where "next tick" may never come. */
  flush: () => void
  /** Write immediately, ignoring the coalescing window. */
  persist: () => void
}

export function useListSnapshot(options: {
  /** The Clerk id, or the remembered one while Clerk is still loading offline. */
  userId: Ref<string>
  hasInitialized: Ref<boolean>
  /** The view's own refs. Painted into, cleared, and read back out. */
  refs: SnapshotRefs
  /** Has this list ever bought anything, as the view currently understands it. */
  hasShopped: () => boolean
}): ListSnapshotState {
  const { userId, hasInitialized, refs, hasShopped } = options

  const paintedFromCache = ref(false)
  const cachedShoppedListId = ref('')
  // Which user the painted cache belongs to. The paint happens before Clerk can
  // confirm the session, so if it then resolves to somebody else that paint is
  // the wrong person's list and has to be dropped.
  let hydratedUserId = ''

  function paintedFor(id: string): boolean {
    return !!hydratedUserId && hydratedUserId === id
  }

  function discard(): void {
    hydratedUserId = ''
    paintedFromCache.value = false
    for (const key of Object.keys(EMPTY) as (keyof PaintedFields)[]) {
      // The one cast in this file. Iterating a heterogeneous set of refs cannot
      // be expressed without it, and the alternative -- eight assignments
      // written out -- is the list that drifted in the first place. EMPTY's
      // `satisfies` above is what makes the loop's coverage exact.
      ;(refs[key] as Ref<unknown>).value = EMPTY[key]
    }
    cachedShoppedListId.value = ''
  }

  function hasSnapshot(): boolean {
    return loadListSnapshot(localStorage, userId.value) !== null
  }

  function hydrate(): void {
    if (refs.items.value.length) return
    const snapshot = loadListSnapshot(localStorage, userId.value)
    if (!snapshot) return
    hydratedUserId = userId.value
    paintedFromCache.value = true
    refs.listId.value = snapshot.listId
    refs.listName.value = snapshot.listName
    refs.listInviteCode.value = snapshot.listInviteCode
    refs.listOwnerId.value = snapshot.listOwnerId
    refs.listItemLimit.value = snapshot.listItemLimit
    refs.listEmoji.value = snapshot.listEmoji || ''
    refs.listMembers.value = snapshot.listMembers
    refs.items.value = snapshot.items
    // Offline there is no purchase history to read, so the cached answer is the
    // only one available. Without it an empty list tells a list that shops
    // every week they have never started.
    cachedShoppedListId.value = snapshot.hasShopped ? snapshot.listId : ''
  }

  function persist(): void {
    if (!hasInitialized.value || !userId.value || !refs.listId.value) return
    saveListSnapshot(localStorage, userId.value, {
      listId: refs.listId.value,
      listName: refs.listName.value,
      listInviteCode: refs.listInviteCode.value,
      listOwnerId: refs.listOwnerId.value,
      listItemLimit: refs.listItemLimit.value,
      listEmoji: refs.listEmoji.value,
      listMembers: refs.listMembers.value,
      items: refs.items.value,
      hasShopped: hasShopped(),
    })
  }

  // Writing the snapshot means JSON-stringifying the whole list and handing it
  // to localStorage, which is synchronous and blocks the main thread. The
  // watcher below is deep, so a quantity bump fires it per change — during a
  // checkout, once per row. Coalesce into one write on the next tick: nothing
  // reads the snapshot until a future page load, so it only has to be right when
  // the dust settles, not on every intermediate state.
  let timer: ReturnType<typeof setTimeout> | null = null

  function schedule(): void {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      persist()
    }, 0)
  }

  function flush(): void {
    if (!timer) return
    clearTimeout(timer)
    timer = null
    persist()
  }

  // Keep the snapshot current as state changes (mutations, realtime events).
  // Guarded by hasInitialized inside persist, so hydration itself and partial
  // init states are never written back.
  watch(
    [
      refs.items,
      refs.listMembers,
      refs.listName,
      refs.listInviteCode,
      refs.listItemLimit,
      refs.listEmoji,
    ],
    schedule,
    { deep: true },
  )

  // A scheduled write firing from a view that has gone would read refs nobody is
  // rendering. Flushed rather than cancelled: the change already happened, and
  // localStorage is synchronous, so it always lands.
  onBeforeUnmount(flush)

  return {
    paintedFromCache,
    cachedShoppedListId,
    hasSnapshot,
    hydrate,
    discard,
    paintedFor,
    flush,
    persist,
  }
}
