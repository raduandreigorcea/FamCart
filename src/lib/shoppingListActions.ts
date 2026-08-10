import { ref, type Ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  countActiveItemsByMember,
  findActiveItemByName,
  sortItemsForDisplay,
} from './shoppingList'
import {
  enqueueOfflineMutation,
  flushOfflineQueue,
  hasQueuedOfflineMutations,
  isOfflineError,
  isRateLimitedError,
  loadOfflineQueue,
  type FlushResult,
} from './offlineQueue'
import { userMessage } from './errorMessages'
import { ITEM_NAME_MAX_LENGTH, ITEM_QUANTITY_MAX } from './limits'
import type { ShoppingItemRow } from './householdRealtime'
import type { ProductSuggestion } from './productSearch'

// How long a quantity stepper may keep being tapped before the change is sent.
// Comfortably longer than the gap between two deliberate taps, short enough that
// closing the app straight after the last one does not outrun it.
const QUANTITY_WRITE_DEBOUNCE_MS = 300

// A product on its way onto the list, with the two facts about HOW it got there
// that the catalog write needs and the item row does not. Both are dropped
// before the insert, which builds its row from named fields only.
//
// Declared here rather than beside ProductSuggestion because productSearch.ts is
// vendored byte-for-byte into the catalog importer (see test/vendorDrift), and
// the importer has no use for either field. A type the app alone needs does not
// belong in the file the two repos have to keep identical.
export interface AddedProduct extends ProductSuggestion {
  /** Contribute this product to the catalog rather than bump it: the "Add your
   *  own" path, for something the catalog does not have yet. */
  custom?: boolean
  /** The barcode it was scanned from. Stored alongside a custom contribution so
   *  the next scan of the same package finds it instead of missing again. */
  barcode?: string | null
}

// Every write the list can make, and the optimistic bookkeeping around them.
//
// The shape of all of these is the same: change the local array first so the tap
// feels instant, send the write, and put the array back if it fails. What makes
// them long is that "fails" has four different meanings — the network never
// left, the DB rejected it on the per-member cap, another device won a race on
// the same product name, or something genuinely went wrong — and only the last
// one is an error the user should see.
//
// Extracted from HomeView, where this was the largest of seven concerns.

export interface ShoppingListActions {
  /** Set while an item's write is in flight, so a racing refetch keeps the local row. */
  pendingItemWrites: Set<string>
  addError: Ref<string>
  limitReachedPopupOpen: Ref<boolean>
  closeLimitReachedPopup: () => void
  ensureQueueFlushed: () => Promise<FlushResult>
  loadItems: () => Promise<void>
  addItem: (product?: AddedProduct | null) => Promise<void>
  toggleItem: (item: ShoppingItemRow) => Promise<void>
  setItemQuantity: (item: ShoppingItemRow, next: number) => Promise<void>
  deleteItem: (item: ShoppingItemRow) => Promise<void>
  checkoutItems: (ids: string[]) => Promise<void>
}

export function useShoppingListActions(options: {
  db: SupabaseClient
  items: Ref<ShoppingItemRow[]>
  householdId: Ref<string | null>
  /** The Clerk id, or the remembered one while Clerk is still loading offline. */
  userId: Ref<string>
  itemLimit: Ref<number>
  isOffline: () => boolean
  // The add form's fields. The add path reads them and clears them on success,
  // and restores them when a failed add is worth retrying.
  draftName: Ref<string>
  draftQuantity: Ref<number>
  selectedProduct: Ref<AddedProduct | null>
  // The view's shared error surface. addError below is this composable's own
  // because only the add path writes it; loadError is passed in because the
  // household loaders and the reconnect sync write it too.
  loadError: Ref<string>
  // From the suggestions composable: what to tell the search screen landed, and
  // what to record against the catalog once it has.
  reportAdded: (name: string, maker: string | null) => void
  clearLastAdded: () => void
  recordProductAdd: (product: AddedProduct) => void
  /** A checkout succeeded — the empty list means "bought", not "never started". */
  onCheckedOut: () => void
}): ShoppingListActions {
  const {
    db,
    items,
    householdId,
    userId,
    itemLimit,
    isOffline,
    draftName,
    draftQuantity,
    selectedProduct,
    loadError,
    reportAdded,
    clearLastAdded,
    recordProductAdd,
    onCheckedOut,
  } = options

  const addError = ref('')
  const limitReachedPopupOpen = ref(false)
  const pendingItemWrites = new Set<string>()

  // How many writes are in flight per row. The set above is the thing everyone
  // reads, but a set cannot express "still two of these outstanding" -- so a row
  // written twice in quick succession had its guard cleared by whichever write
  // finished first, while the other was still on the wire. Realtime then stopped
  // skipping that row and merged a late echo carrying the older value.
  //
  // That is invisible for a toggle, which alternates and is slow. It is very
  // visible on a quantity stepper: the number jumps backwards, and because the
  // count keys the row's transition, the animation plays again.
  const itemWriteDepth = new Map<string, number>()

  function beginItemWrite(id: string): void {
    itemWriteDepth.set(id, (itemWriteDepth.get(id) ?? 0) + 1)
    pendingItemWrites.add(id)
  }

  // Quantity changes waiting out their debounce, by item id. See
  // scheduleQuantityWrite.
  const quantityWrites = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; before: number; onError?: () => void }
  >()

  // Inserts still on the wire, by the id the client generated for them. A row
  // exists locally the instant it is pushed, so a second tap finds it and wants
  // to bump its quantity -- but an UPDATE against an id the server has not been
  // told about yet matches nothing, reports no error, and silently loses the
  // increment. Quantity writes wait here first.
  const inFlightInserts = new Map<string, Promise<unknown>>()

  // Rows whose quantity has moved on locally and not yet been written. Spans the
  // whole intent -- from the tap that scheduled it until the write settles --
  // because the two things that would otherwise overwrite it (the insert echo,
  // a refetch) can arrive at either end of that window.
  const quantityIntent = new Set<string>()

  // Sends every waiting quantity change now. Called before a refetch, which
  // would otherwise read back the server's pre-write number and paint over a
  // change the user can already see.
  async function flushQuantityWrites(): Promise<void> {
    const waiting = [...quantityWrites.entries()]
    quantityWrites.clear()
    await Promise.all(
      waiting.map(([id, entry]) => {
        const { timer, before } = entry
        clearTimeout(timer)
        const item = items.value.find((i) => i.id === id)
        return item ? flushQuantityWrite(item, before, entry.onError) : Promise.resolve()
      }),
    )
  }

  function endItemWrite(id: string): void {
    const left = (itemWriteDepth.get(id) ?? 1) - 1
    if (left > 0) {
      itemWriteDepth.set(id, left)
      return
    }
    itemWriteDepth.delete(id)
    pendingItemWrites.delete(id)
  }

  function closeLimitReachedPopup(): void {
    limitReachedPopupOpen.value = false
  }

  // A live write can still fail at the network layer even when navigator.onLine
  // reports true (common in the Android WebView / on a dead Wi-Fi). When that
  // happens, treat it exactly like the up-front offline path: queue the mutation
  // and keep the optimistic state, rather than rolling back and popping a raw
  // "Failed to fetch" modal. Returns true when it handled the failure.
  function deferIfOffline(error: unknown, mutation: Parameters<typeof enqueueOfflineMutation>[2]): boolean {
    if (!isOfflineError(error)) return false
    enqueueOfflineMutation(localStorage, userId.value, mutation)
    return true
  }

  // Single-flight flush of the offline queue. Every list refetch funnels through
  // this first (see loadItems), so a reload triggered by realtime/watchdog on
  // reconnect can never paint the server's pre-sync state and drop the user's own
  // queued change — the write lands before we read it back. Concurrent callers
  // share one in-flight flush, so a mutation is never replayed twice.
  let flushPromise: Promise<FlushResult> | null = null
  function ensureQueueFlushed(): Promise<FlushResult> {
    if (!userId.value || !hasQueuedOfflineMutations(localStorage, userId.value)) {
      return Promise.resolve({ flushed: 0, failed: 0, interrupted: false })
    }
    if (!flushPromise) {
      flushPromise = flushOfflineQueue(localStorage, userId.value, db).finally(() => {
        flushPromise = null
      })
    }
    return flushPromise
  }

  async function loadItems(): Promise<void> {
    // Same reasoning as the queue flush below, for the writes still sitting in
    // their debounce: a refetch that overtakes them reads the server's older
    // quantity and paints over a number the user is looking at.
    await flushQuantityWrites()
    // Push any writes made offline before reading the list back, so a reload that
    // races the flush (realtime/watchdog on reconnect) can't momentarily show the
    // server's version without the user's own pending change.
    await ensureQueueFlushed()

    const [uncheckedRes, checkedRes] = await Promise.all([
      db
        .from('shopping_list_items')
        .select('*')
        .eq('household_id', householdId.value)
        .eq('checked', false)
        .order('created_at', { ascending: true }),
      db
        .from('shopping_list_items')
        .select('*')
        .eq('household_id', householdId.value)
        .eq('checked', true)
        // Most recently checked first, so the 30-row cap keeps the latest ticks.
        // This is a "which rows survive the cap" order, not a display order:
        // sortItemsForDisplay puts the merged list back into creation order.
        .order('checked_at', { ascending: false, nullsFirst: false })
        .limit(30),
    ])

    // Offline: keep the cached list on screen and let the 'online' handler refetch.
    // Genuine server errors get a plain message, never a raw "Failed to fetch".
    const readError = uncheckedRes.error || checkedRes.error
    if (readError) {
      if (!isOfflineError(readError)) loadError.value = 'Could not load your list. Please try again.'
      return
    }

    // The checked query fetches newest-first so its 30-row cap keeps the most
    // recent purchases, but the merged array goes into the one canonical display
    // order. A locally toggled item keeps its array position, so if a refetch
    // ordered things differently, rows would visibly swap on the next background
    // sync (focus, reconnect, watchdog) — sorting every rebuild the same way is
    // what keeps the list still.
    const fresh = [...(uncheckedRes.data ?? []), ...(checkedRes.data ?? [])] as ShoppingItemRow[]
    if (pendingItemWrites.size) {
      // A write is in flight for some rows: keep the local optimistic version of
      // those, so this refetch can't momentarily revert a just-checked item to the
      // server's pre-write state (the "check bounces back" bug). The kept row
      // sorts by creation time like every other, so its position is unaffected.
      const localById = new Map(items.value.map((i) => [i.id, i]))
      for (let i = 0; i < fresh.length; i++) {
        const local = pendingItemWrites.has(fresh[i].id) && localById.get(fresh[i].id)
        if (local) fresh[i] = local
      }
    }

    // Anything still in the queue never reached the server, so the refetch above
    // cannot contain it — and replacing the list wholesale would take the user's
    // row off the screen while it sat waiting to be sent.
    //
    // This used to be masked: a flush stops on a transient failure, and until the
    // list gained a rate ceiling (004_shopping_list.sql) "transient" meant a dead
    // network, which made the fetch above fail too, so loadItems returned early
    // and left the cached list alone. A throttled replay is the first transient
    // failure that happens while the network is perfectly fine, so the refetch
    // succeeds and the row vanishes into a queue that retries up to an hour
    // later. Re-merging is what makes a throttled add behave like an offline one:
    // it stays on screen and syncs when it can.
    //
    // Only inserts: an update or delete refers to a row the server already has,
    // so the fetched copy is the right thing to show until the queue drains.
    //
    // Scoped to this household, and that is load-bearing: the queue is keyed by
    // user, not by household, and a user may belong to three. Without the
    // household_id check, an add queued offline in one household renders in another
    // household's list the moment you switch to it — the row is never written
    // there, but showing it at all is the cross-tenant leak the whole RLS design
    // exists to prevent.
    const queued = userId.value ? loadOfflineQueue(localStorage, userId.value) : []
    for (const mutation of queued) {
      if (mutation.kind !== 'insert') continue
      if (mutation.row.household_id !== householdId.value) continue
      if (fresh.some((i) => i.id === mutation.id)) continue
      fresh.push({
        checked: false,
        // The queue does not record when the row was created, and the server
        // never saw it, so it sorts to the end — where an unsent add sat when it
        // was made.
        created_at: new Date().toISOString(),
        ...mutation.row,
      } as unknown as ShoppingItemRow)
    }

    items.value = sortItemsForDisplay(fresh)
  }

  // Increment the existing active row for this product (used when a concurrent
  // add beat us to it). Looks locally first, then fetches to reconcile stale state.
  // Returns whether the quantity actually landed, so the caller knows whether to
  // record the add against the catalog (a deferred offline update counts).
  async function incrementActiveItemByName(
    name: string,
    maker: string | null,
    quantity: number,
    optimisticId: string,
  ): Promise<boolean> {
    items.value = items.value.filter((i) => i.id !== optimisticId)

    let target = findActiveItemByName(items.value, name, { maker })
    if (!target) {
      const { data } = await db
        .from('shopping_list_items')
        .select('*')
        .eq('household_id', householdId.value)
        .eq('checked', false)
      target = findActiveItemByName((data ?? []) as ShoppingItemRow[], name, { maker })
      if (target && !items.value.some((i) => i.id === target!.id)) {
        // Place the fetched row by its (server) created_at, not on the end, or the
        // next refetch would move it there.
        items.value = sortItemsForDisplay([...items.value, target])
      }
    }
    if (!target) {
      addError.value = 'Could not add that item.'
      return false
    }

    const previousQty = Number(target.quantity) || 1
    target.quantity = previousQty + quantity
    const { error } = await db
      .from('shopping_list_items')
      .update({ quantity: target.quantity })
      .eq('id', target.id)
    if (error) {
      if (deferIfOffline(error, { kind: 'update', id: target.id, patch: { quantity: target.quantity } }))
        return true
      target.quantity = previousQty
      addError.value = userMessage(error, 'Could not update that item.')
      return false
    }
    return true
  }

  // `product` is set when a suggestion was tapped, and that product is then the
  // whole intent — name and maker both come from it, not from the input. A plain
  // form submit passes nothing and adds whatever was typed.
  async function addItem(
    product: AddedProduct | null = null,
  ): Promise<void> {
    const name = (product?.name ?? draftName.value).trim()
    if (!name) return
    if (name.length > ITEM_NAME_MAX_LENGTH) {
      addError.value = `Item name must be ${ITEM_NAME_MAX_LENGTH} characters or fewer.`
      return
    }
    addError.value = ''

    const quantity = draftQuantity.value
    // The maker comes from a product rather than the typed text: the catalog
    // product just tapped, one restored after a failed add (the draft watcher
    // clears that as soon as the text stops matching it), or a custom one from the
    // "Add your own" modal. Keep the whole product too, so a successful add can
    // record itself against the catalog.
    const picked = product ?? selectedProduct.value
    const maker = picked?.maker ?? null

    // If an unchecked item for the same product (name + maker) already exists,
    // bump its quantity instead of adding a duplicate row. Checked (already-
    // bought) items are left alone so re-adding them starts a fresh active item.
    const existing = findActiveItemByName(items.value, name, { maker })
    if (existing) {
      draftQuantity.value = 1
      // The pick is spent: it is on the list now. The query watcher would
      // normally drop it when the text changes, but the text no longer changes
      // on an add — so without this, typing nothing and pressing Add again would
      // put the TYPED words on the list carrying the picked product's maker.
      selectedProduct.value = null
      const previousQty = Number(existing.quantity) || 1
      existing.quantity = previousQty + quantity // optimistic
      reportAdded(name, maker)
      if (picked) recordProductAdd(picked)

      // Through the same coalescing writer the row's own stepper uses, rather
      // than a write per tap. Tapping a product twenty times used to put twenty
      // UPDATEs on the wire, each carrying the absolute quantity it had computed
      // at tap time and none of them ordered against the others -- so the row
      // ended up on whichever number happened to land last, which is why the
      // count came back lower than the taps. Now it is one UPDATE carrying the
      // number the user actually stopped on.
      //
      // The rollback target is the quantity before the first tap of the burst,
      // which scheduleQuantityWrite keeps for exactly this.
      scheduleQuantityWrite(existing, previousQty, clearLastAdded)
      return
    }

    // Guard the per-member active-item cap locally so we never flash an optimistic
    // row that the DB trigger would reject. The trigger (004_shopping_list.sql) stays the
    // authoritative backstop for races or stale local state.
    const activeCount = countActiveItemsByMember(items.value, userId.value)
    if (activeCount >= itemLimit.value) {
      limitReachedPopupOpen.value = true
      return
    }
    // Optimistic: show the item instantly and clear the form.
    //
    // Generate the id client-side and reuse it as the row's primary key so the
    // optimistic row and the real row share the same TransitionGroup key. If the
    // key changed when the insert echoed back, Vue would remount the element and
    // restart the add animation mid-flight.
    const id = crypto.randomUUID()
    const row = {
      id,
      household_id: householdId.value,
      name,
      maker,
      quantity,
      added_by: userId.value,
    }
    items.value.push({
      ...row,
      checked: false,
      created_at: new Date().toISOString(),
    } as unknown as ShoppingItemRow)
    draftQuantity.value = 1
      // The pick is spent: it is on the list now. The query watcher would
      // normally drop it when the text changes, but the text no longer changes
      // on an add — so without this, typing nothing and pressing Add again would
      // put the TYPED words on the list carrying the picked product's maker.
    selectedProduct.value = null
    reportAdded(name, maker)

    if (isOffline()) {
      enqueueOfflineMutation(localStorage, userId.value, { kind: 'insert', id, row })
      return
    }

    // Registered before it is awaited, so a second tap arriving mid-flight can
    // find it and wait rather than firing an UPDATE at a row the server has not
    // heard of. Cleared in the finally below, whatever the outcome — a quantity
    // write waiting on a failed insert must still be released.
    // Promise.resolve, not the builder itself: a PostgrestBuilder is a thenable
    // that issues its request every time it is awaited, so handing the raw
    // builder to two consumers would insert the row twice. This adapts it once.
    const insertCall = Promise.resolve(
      db.from('shopping_list_items').insert(row).select().single(),
    )
    inFlightInserts.set(
      id,
      insertCall.then(
        () => {},
        () => {},
      ),
    )

    let result
    try {
      result = await insertCall
    } finally {
      inFlightInserts.delete(id)
    }
    const { data, error } = result

    if (error) {
      // Lost a race: the DB already has an unchecked item for this product (our
      // local check missed it). Fold this quantity into that row instead of erroring.
      if (error.code === '23505') {
        // The quantity still landed (folded into the existing row), so record the
        // add against the catalog just as the direct-insert path does.
        if ((await incrementActiveItemByName(name, maker, quantity, id)) && picked) {
          recordProductAdd(picked)
        }
        return
      }
      // Network failure (WebView reported online but the write never left): keep
      // the optimistic row and queue the insert for the next sync.
      if (deferIfOffline(error, { kind: 'insert', id, row })) return
      // Roll back the optimistic row and surface the reason.
      items.value = items.value.filter((i) => i.id !== id)
      clearLastAdded() // it did not land after all
      if (
        error.message?.includes('member_active_item_limit_exceeded') ||
        error.message?.includes('limit of')
      ) {
        limitReachedPopupOpen.value = true
      } else {
        // The item-insert ceiling (004_shopping_list.sql) gets its own
        // message: the add was valid and will work again shortly, which "Failed
        // to add item." does not say. Deliberately NOT routed through
        // userMessage() — that reports to Sentry, and a limit doing its job is
        // not a fault. The server already audits it to security_events.
        addError.value = isRateLimitedError(error)
          ? 'You are adding items too quickly. Wait a minute and try again.'
          : userMessage(error, 'Failed to add item.')
        // Only when there is nothing to put back over: adding no longer empties
        // the field, so the text is normally still sitting there -- possibly
        // edited since -- and restoring would overwrite what is being typed now.
        if (!draftName.value) draftName.value = name
        draftQuantity.value = quantity
        // Keep the catalog pick across the retry (the watcher sees the restored
        // text matching it and leaves it in place). Preserve the custom tag too, so
        // a retried "Add your own" item is still contributed rather than bumped.
        selectedProduct.value = picked?.custom
          ? { name, maker, custom: true }
          : maker
            ? { name, maker }
            : null
      }
      return
    }

    // Refresh the row with server-authoritative fields. The id is unchanged, so no
    // remount; the realtime INSERT echo dedupes on this same id and is a no-op.
    const index = items.value.findIndex((i) => i.id === id)
    if (index !== -1) {
      const server = data as ShoppingItemRow
      // The echo carries the quantity this insert was sent with. Taps that
      // landed while it was in flight moved the local number past that, and
      // their write is still queued behind this very insert -- so taking the
      // echo verbatim would undo them, and the queued write would then send the
      // number back down. Everything else is server-authoritative.
      items.value[index] = quantityIntent.has(id)
        ? { ...server, quantity: items.value[index].quantity }
        : server
      // The server's created_at replaces the optimistic client timestamp — a
      // different sort key. Re-sort now so the row settles into its canonical spot
      // immediately, instead of sitting at the append position until the next
      // background sync abruptly moves it (the "rows jump on their own" bug).
      items.value = sortItemsForDisplay(items.value)
    }

    if (picked) recordProductAdd(picked)
  }

  // Fold `source`'s quantity into `target` (same-name unchecked row) and remove
  // `source`. Optimistic, with rollback if either write fails.
  async function mergeItemInto(source: ShoppingItemRow, target: ShoppingItemRow): Promise<void> {
    const sourceIndex = items.value.findIndex((i) => i.id === source.id)
    const previousTargetQty = Number(target.quantity) || 1
    const addedQty = Number(source.quantity) || 1

    target.quantity = previousTargetQty + addedQty
    const removedSource = sourceIndex !== -1 ? items.value.splice(sourceIndex, 1)[0] : source

    const rollback = (message: string) => {
      target.quantity = previousTargetQty
      if (sourceIndex !== -1) items.value.splice(sourceIndex, 0, removedSource)
      loadError.value = message
    }

    if (isOffline()) {
      // Queue both halves of the merge; if `source` was itself added offline, the
      // queue coalesces the pair away entirely.
      enqueueOfflineMutation(localStorage, userId.value, {
        kind: 'update',
        id: target.id,
        patch: { quantity: target.quantity },
      })
      enqueueOfflineMutation(localStorage, userId.value, { kind: 'delete', id: source.id })
      return
    }

    const { error: updateErr } = await db
      .from('shopping_list_items')
      .update({ quantity: target.quantity })
      .eq('id', target.id)
    if (updateErr) {
      // Neither half reached the server: queue both and keep the merged state.
      if (isOfflineError(updateErr)) {
        enqueueOfflineMutation(localStorage, userId.value, {
          kind: 'update',
          id: target.id,
          patch: { quantity: target.quantity },
        })
        enqueueOfflineMutation(localStorage, userId.value, { kind: 'delete', id: source.id })
        return
      }
      rollback(userMessage(updateErr, 'Could not merge those items.'))
      return
    }

    const { error: deleteErr } = await db
      .from('shopping_list_items')
      .delete()
      .eq('id', source.id)
    if (deleteErr) {
      // The quantity bump already landed; only the delete is outstanding. Queue it
      // rather than undoing a change the server has committed.
      if (deferIfOffline(deleteErr, { kind: 'delete', id: source.id })) return
      // Undo the quantity bump we already committed, then restore the row.
      await db
        .from('shopping_list_items')
        .update({ quantity: previousTargetQty })
        .eq('id', target.id)
      rollback(userMessage(deleteErr, 'Could not merge those items.'))
    }
  }

  async function toggleItem(item: ShoppingItemRow): Promise<void> {
    const previous = item.checked
    const previousCheckedAt = (item.checked_at as string | null) ?? null
    const nextChecked = !previous

    // Unchecking: if another unchecked item with the same name already exists,
    // fold this one into it instead of leaving two active rows — same merge rule
    // as adding.
    if (!nextChecked) {
      const target = findActiveItemByName(items.value, item.name, {
        excludeId: item.id,
        maker: item.maker as string | null,
      })
      if (target) {
        await mergeItemInto(item, target)
        return
      }
    }

    // Optimistic: flip immediately, roll back if the write fails. checked_at is
    // mirrored because the refetch's 30-row cap is taken on it, not because it
    // affects position: display order is creation time, so a tick never moves the
    // row. The DB trigger (004_shopping_list.sql) is the authority on the stored value, so
    // we only send `checked` — the server stamps the time itself.
    item.checked = nextChecked
    item.checked_at = nextChecked ? new Date().toISOString() : null
    const patch = { checked: nextChecked }

    if (isOffline()) {
      enqueueOfflineMutation(localStorage, userId.value, {
        kind: 'update',
        id: item.id,
        patch,
      })
      return
    }

    // Track the in-flight write so a background refetch that races it (reconnect,
    // focus, watchdog) keeps this flip rather than reading back the server's
    // pre-write value — see loadItems and pendingItemWrites.
    beginItemWrite(item.id)
    try {
      const { error } = await db
        .from('shopping_list_items')
        .update(patch)
        .eq('id', item.id)

      if (error) {
        // Keep the flip and queue it when the failure is just lost connectivity.
        if (deferIfOffline(error, { kind: 'update', id: item.id, patch })) return
        item.checked = previous
        item.checked_at = previousCheckedAt
        // Unchecking would push the member over the active-item cap
        // (004_shopping_list.sql enforces it on uncheck too): show the same
        // friendly popup as adding.
        if (
          error.message?.includes('member_active_item_limit_exceeded') ||
          error.message?.includes('limit of')
        ) {
          limitReachedPopupOpen.value = true
          return
        }
        // Unique-violation while unchecking: an active same-name row appeared (race).
        // Merge into it rather than surfacing an error.
        if (!nextChecked && error.code === '23505') {
          let target = findActiveItemByName(items.value, item.name, {
            excludeId: item.id,
            maker: item.maker as string | null,
          })
          if (!target) {
            const { data } = await db
              .from('shopping_list_items')
              .select('*')
              .eq('household_id', householdId.value)
              .eq('checked', false)
            target = findActiveItemByName((data ?? []) as ShoppingItemRow[], item.name, {
              excludeId: item.id,
              maker: item.maker as string | null,
            })
            if (target && !items.value.some((i) => i.id === target!.id)) {
              items.value = sortItemsForDisplay([...items.value, target])
            }
          }
          if (target) {
            await mergeItemInto(item, target)
            return
          }
        }
        loadError.value = userMessage(error, 'Could not update that item.')
      }
    } finally {
      endItemWrite(item.id)
    }
  }

  // Check out every checked item: archive them to purchase history and drop them
  // from the active list. The animation has already played in ShoppingList by the
  // time this runs, so we just persist the outcome.
  async function checkoutItems(ids: string[]): Promise<void> {
    if (!ids.length) return
    const idSet = new Set(ids)
    const known = items.value.filter((i) => idSet.has(i.id))
    const bought = known.filter((i) => i.checked)

    // Which ids actually reach the RPC. While the rows are here — the normal
    // case, mid drain animation — only the checked ones do, never an unchecked
    // row that happened to be named, mirroring the RPC's own `checked = true`
    // guard.
    //
    // None of them being here is a different situation: switching household
    // replaces the whole array while that animation is still running. This used
    // to read as "nothing to buy" and return, leaving the rows checked in the
    // database after the user had been told they were bought. There is nothing
    // local left to judge checkedness by, so the confirmed ids are the
    // authority and the server's own guard is what filters them.
    const toBuy = known.length ? bought.map((i) => i.id) : ids
    if (!toBuy.length) return

    // Optimistic removal covers only rows actually present and checked. Keep
    // the pre-removal array so a hard failure can restore the exact list, order
    // included.
    const boughtIds = new Set(bought.map((i) => i.id))
    const snapshot = items.value
    items.value = items.value.filter((i) => !boughtIds.has(i.id))

    // Offline (or a WebView that lies about connectivity): there is no multi-table
    // transaction to run here, so queue plain deletes. The rows leave the list but
    // an offline checkout is not recorded in history — it is archived only when the
    // checkout runs against the server.
    if (isOffline()) {
      for (const id of toBuy) {
        enqueueOfflineMutation(localStorage, userId.value, { kind: 'delete', id })
      }
      return
    }

    const { error } = await db.rpc('buy_items', { p_item_ids: toBuy })
    if (error) {
      // Never reached the server: keep them off the list and fall back to queued
      // deletes, same as the offline path.
      if (isOfflineError(error)) {
        for (const id of toBuy) {
          enqueueOfflineMutation(localStorage, userId.value, { kind: 'delete', id })
        }
        return
      }
      items.value = snapshot
      loadError.value = userMessage(error, 'Could not complete the checkout.')
      return
    }

    onCheckedOut()
  }

  // Setting a quantity on a row that already exists. Adding the same product
  // again has always summed quantities (see addItem), which covers going up but
  // never down — so until now a wrong number could only be fixed by deleting the
  // item and adding it back. This is the way down, and the only path that sets a
  // quantity outright rather than by increment.
  //
  // Same optimistic/queue/rollback shape as toggleItem, for the same reason: the
  // number under a thumb has to move on the tap, not on the round trip.
  // A stepper is held down, not clicked once. Writing per tap put four or five
  // UPDATEs on the wire for one decision, and they do not necessarily come back
  // in the order they left -- so the row would settle on whichever echo landed
  // last rather than on the number under the thumb.
  //
  // The local value still moves on the tap; only the write waits. Taps inside the
  // window collapse into one UPDATE carrying the final number, which is also the
  // only number anyone else needs to hear about.
  function scheduleQuantityWrite(
    item: ShoppingItemRow,
    before: number,
    onError?: () => void,
  ): void {
    const open = quantityWrites.get(item.id)
    if (open) clearTimeout(open.timer)
    // Guarded from the tap, not from the moment the write leaves. The row spends
    // the whole debounce holding a number the server has not been told about
    // yet, and an echo landing in that gap -- a previous burst's own write
    // coming home, or another device -- would be merged as news and set the
    // count back. The number keys the row's transition, so it does not just
    // change: it visibly counts backwards and plays the animation again.
    //
    // Once per intent, or a burst of twenty taps would raise the depth twenty
    // times against a single release and pin the row guarded forever.
    if (!quantityIntent.has(item.id)) {
      quantityIntent.add(item.id)
      beginItemWrite(item.id)
    }
    quantityWrites.set(item.id, {
      onError: onError ?? open?.onError,
      // The value from before this BURST, not before this tap: rolling a failed
      // write back one step would leave the row on a number nobody chose.
      before: open ? open.before : before,
      timer: setTimeout(() => {
        const pending = quantityWrites.get(item.id)
        quantityWrites.delete(item.id)
        void flushQuantityWrite(item, pending ? pending.before : before, pending?.onError)
      }, QUANTITY_WRITE_DEBOUNCE_MS),
    })
  }

  async function flushQuantityWrite(
    item: ShoppingItemRow,
    before: number,
    onError?: () => void,
  ): Promise<void> {
    // The row may still be being created. Bumping a quantity is always a change
    // to a row that exists, so wait until it does.
    const insert = inFlightInserts.get(item.id)
    if (insert) await insert

    try {
      await sendQuantity(item, before, onError)
    } finally {
      quantityIntent.delete(item.id)
      endItemWrite(item.id)
    }
  }

  async function sendQuantity(
    item: ShoppingItemRow,
    before: number,
    onError?: () => void,
  ): Promise<void> {
    const target = Number(item.quantity) || 1
    // Up and back down again inside the window: the row never changed, so there
    // is nothing to tell the server.
    if (target === before) return

    const patch = { quantity: target }

    if (isOffline()) {
      enqueueOfflineMutation(localStorage, userId.value, { kind: 'update', id: item.id, patch })
      return
    }

    // Tracked for the same reason a toggle is: a refetch racing this write must
    // not paint the server's pre-write quantity back over it.
    beginItemWrite(item.id)
    try {
      const { error } = await db
        .from('shopping_list_items')
        .update(patch)
        .eq('id', item.id)

      if (error) {
        if (deferIfOffline(error, { kind: 'update', id: item.id, patch })) return
        item.quantity = before // rollback, to where the burst started
        onError?.()
        loadError.value = userMessage(error, 'Could not update that item.')
      }
    } finally {
      endItemWrite(item.id)
    }
  }

  async function setItemQuantity(item: ShoppingItemRow, next: number): Promise<void> {
    // A checked item's count is settled: the next thing that happens to it is a
    // checkout, which copies the quantity into purchase history. The row already
    // refuses to open its stepper, but a change can still arrive from a stepper
    // that was open when the row was ticked from another device -- and the same
    // rule already holds one layer down, where addItem's merge skips checked
    // rows rather than bumping them.
    if (item.checked) return

    const previous = Number(item.quantity) || 1
    // 004_shopping_list.sql only enforces >= 1; the ceiling is this app's, and it
    // matches what the row's stepper will offer.
    const target = Math.max(1, Math.min(ITEM_QUANTITY_MAX, Math.round(next)))
    if (target === previous) return

    item.quantity = target // optimistic, on the tap
    scheduleQuantityWrite(item, previous)
  }

  async function deleteItem(item: ShoppingItemRow): Promise<void> {
    // Optimistic: remove immediately, restore at its original position on failure.
    const index = items.value.findIndex((i) => i.id === item.id)
    if (index === -1) return
    const [removed] = items.value.splice(index, 1)

    if (isOffline()) {
      enqueueOfflineMutation(localStorage, userId.value, { kind: 'delete', id: item.id })
      return
    }

    const { error } = await db.from('shopping_list_items').delete().eq('id', item.id)

    if (error) {
      // Keep the row removed and queue the delete when it's just connectivity.
      if (deferIfOffline(error, { kind: 'delete', id: item.id })) return
      items.value.splice(index, 0, removed)
      loadError.value = userMessage(error, 'Could not delete that item.')
    }
  }

  return {
    pendingItemWrites,
    addError,
    limitReachedPopupOpen,
    closeLimitReachedPopup,
    ensureQueueFlushed,
    loadItems,
    addItem,
    toggleItem,
    setItemQuantity,
    deleteItem,
    checkoutItems,
  }
}
