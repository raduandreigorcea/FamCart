<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { useAuth, useUser } from '@clerk/vue'
import { useRouter } from 'vue-router'
import { useSupabase } from '../supabase'
import AppTopbar from '../components/AppTopbar.vue'
import ConfirmModal from '../components/ConfirmModal.vue'
import ErrorModal from '../components/ErrorModal.vue'
import ShoppingList from '../components/ShoppingList.vue'
import AddItemForm from '../components/AddItemForm.vue'
import { useFamilyRealtime } from '../lib/familyRealtime'
import {
  findActiveItemByName,
  countActiveItemsByMember,
} from '../lib/shoppingList'
import { getUserDisplayName, getUserPrimaryEmail } from '../lib/userIdentity'
import { cleanAuthCallbackUrl } from '../lib/authCallbackUrl'
import { loadFamilySnapshot, saveFamilySnapshot, clearFamilySnapshot } from '../lib/familyCache'
import { enqueueOfflineMutation, flushOfflineQueue, hasQueuedOfflineMutations, isOfflineError } from '../lib/offlineQueue'
import { isCurrentlyOffline, onReconnect } from '../lib/connectivity'
import { rememberUser, getRememberedUser } from '../lib/session'

const { userId, isLoaded, getToken } = useAuth()
const { user } = useUser()
const router = useRouter()
const db = useSupabase()

// Offline, Clerk hasn't loaded and userId is null, but we may have booted from a
// remembered session. Fall back to that id so the cache, offline queue, and new
// rows' authorship all key to the right user until Clerk confirms it online.
const effectiveUserId = computed(() => userId.value || getRememberedUser(localStorage))

const items = ref([])
const familyId = ref(null)
const familyName = ref('')
const familyInviteCode = ref('')
const familyOwnerId = ref('')
const familyItemLimit = ref(50)
const familyMembers = ref([])
const newItem = ref('')
const newQty = ref(1)
const loadError = ref('')
const addError = ref('')
const limitReachedPopupOpen = ref(false)
const adding = ref(false)
const hasInitialized = ref(false)
const ITEM_NAME_MAX_LENGTH = 120

// Realtime sync (channels, reconnects, watchdog) lives in the composable; it
// registers its own lifecycle listeners and calls back into the loaders below.
const { setupRealtimeSubscriptions, cleanupRealtimeSubscriptions } = useFamilyRealtime({
  db,
  familyId,
  hasInitialized,
  items,
  familyMembers,
  loadItems,
  loadFamilyHeader,
  refreshMembershipOrRedirect,
  onFamilyDeleted: () => router.replace('/family-setup'),
})

// Initial load: nothing fetched yet and no error to show instead. Items arriving
// (realtime or fetch) end the skeleton early even before hasInitialized flips.
const initialLoading = computed(() => !hasInitialized.value && !items.value.length && !loadError.value)

// Mutations check this at call time: on a definite offline signal they queue
// the write instead of hitting the network. Mid-flight failures on a flaky
// connection keep the existing rollback paths. The Capacitor connectivity ref
// is authoritative on native; navigator.onLine is the web/test fallback.
function isOffline() {
  if (isCurrentlyOffline()) return true
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

// A live write can still fail at the network layer even when navigator.onLine
// reports true (common in the Android WebView / on a dead Wi-Fi). When that
// happens, treat it exactly like the up-front offline path: queue the mutation
// and keep the optimistic state, rather than rolling back and popping a raw
// "Failed to fetch" modal. Returns true when it handled the failure.
function deferIfOffline(error, mutation) {
  if (!isOfflineError(error)) return false
  enqueueOfflineMutation(localStorage, effectiveUserId.value, mutation)
  return true
}

let stopReconnect = null

onMounted(() => {
  // Two reconnect signals: the reliable native one, plus the web 'online' event
  // for the browser and tests. Both funnel into the same idempotent sync.
  window.addEventListener('online', handleBackOnline)
  stopReconnect = onReconnect(handleBackOnline)
  void initializeHome()
})

onBeforeUnmount(() => {
  window.removeEventListener('online', handleBackOnline)
  if (stopReconnect) stopReconnect()
})

// Single-flight flush of the offline queue. Every list refetch funnels through
// this first (see loadItems), so a reload triggered by realtime/watchdog on
// reconnect can never paint the server's pre-sync state and drop the user's own
// queued change — the write lands before we read it back. Concurrent callers
// share one in-flight flush, so a mutation is never replayed twice.
let flushPromise = null
function ensureQueueFlushed() {
  if (!effectiveUserId.value || !hasQueuedOfflineMutations(localStorage, effectiveUserId.value)) {
    return Promise.resolve({ flushed: 0, failed: 0, interrupted: false })
  }
  if (!flushPromise) {
    flushPromise = flushOfflineQueue(localStorage, effectiveUserId.value, db)
      .finally(() => { flushPromise = null })
  }
  return flushPromise
}

// Back online: replay writes queued while offline, then re-fetch so local state
// converges on the server's. Reentrancy-safe: reconnect and Clerk-ready can both
// fire, and a trigger arriving mid-sync reruns once more so nothing is missed.
let syncInFlight = false
let syncAgain = false
async function handleBackOnline() {
  if (!hasInitialized.value || !effectiveUserId.value || !familyId.value) return
  if (syncInFlight) { syncAgain = true; return }
  syncInFlight = true
  try {
    do {
      syncAgain = false
      const { failed } = await ensureQueueFlushed()
      if (failed) loadError.value = 'Some changes made offline could not be synced.'
      await loadFamilyHeader()
      await loadItems()
      await setupRealtimeSubscriptions()
    } while (syncAgain)
  } finally {
    syncInFlight = false
  }
}

watch([isLoaded, userId], () => {
  // Clerk finished loading after we already booted from cache offline: sync now
  // that it can mint a token, rather than re-running the full init.
  if (hasInitialized.value) {
    if (userId.value) void handleBackOnline()
    return
  }
  void initializeHome()
})

async function initializeHome() {
  if (hasInitialized.value) return

  // Offline boot: Clerk can't verify the session without a network, but a
  // remembered user with a cached snapshot can run entirely from local state.
  // The router already vetted us here; paint the cache and let reconnection (or
  // Clerk finishing to load) reconcile with the server.
  if (!isLoaded.value || !userId.value) {
    const uid = effectiveUserId.value
    if (isOffline() && uid && loadFamilySnapshot(localStorage, uid)) {
      sanitizeAuthCallbackUrl()
      hydrateFromCachedSnapshot()
      hasInitialized.value = true
    }
    return
  }

  // Confirmed signed in: remember this user so a later offline open can boot.
  rememberUser(localStorage, userId.value)
  sanitizeAuthCallbackUrl()
  hydrateFromCachedSnapshot()

  // Fetch the user's family only after Clerk has finished loading.
  const { data: membership, error: mErr } = await db
    .from('family_members')
    .select('family_id')
    .eq('user_id', userId.value)
    .limit(1)
    .maybeSingle()

  if (mErr) {
    // Offline with a cached snapshot already painted: run from local state and
    // let the reconnect handler flush queued writes and reconcile. Realtime is
    // still set up so its reconnect logic takes over once connectivity returns.
    // isOfflineError also catches the WebView case where navigator.onLine lies.
    if (isOfflineError(mErr) && familyId.value) {
      await setupRealtimeSubscriptions()
      hasInitialized.value = true
      return
    }
    loadError.value = isOfflineError(mErr)
      ? 'You appear to be offline. Check your connection and try again.'
      : 'Could not load your family.'
    return
  }

  if (!membership?.family_id) {
    clearFamilySnapshot(localStorage)
    router.replace('/family-setup')
    return
  }

  familyId.value = membership.family_id
  // Writes queued during a previous offline session land before the first
  // fetch, so the list below already reflects them. No-op when the queue is empty.
  await flushOfflineQueue(localStorage, effectiveUserId.value, db)
  await loadFamilyHeader()
  await loadItems()
  await setupRealtimeSubscriptions()
  hasInitialized.value = true
  persistSnapshot()
}

// Paint the last known state immediately (stale-while-revalidate): a returning
// user sees their list instead of skeletons while the fresh fetches above run.
function hydrateFromCachedSnapshot() {
  if (items.value.length) return
  const snapshot = loadFamilySnapshot(localStorage, effectiveUserId.value)
  if (!snapshot) return
  familyId.value = snapshot.familyId
  familyName.value = snapshot.familyName
  familyInviteCode.value = snapshot.familyInviteCode
  familyOwnerId.value = snapshot.familyOwnerId
  familyItemLimit.value = snapshot.familyItemLimit
  familyMembers.value = snapshot.familyMembers
  items.value = snapshot.items
}

function persistSnapshot() {
  if (!hasInitialized.value || !effectiveUserId.value || !familyId.value) return
  saveFamilySnapshot(localStorage, effectiveUserId.value, {
    familyId: familyId.value,
    familyName: familyName.value,
    familyInviteCode: familyInviteCode.value,
    familyOwnerId: familyOwnerId.value,
    familyItemLimit: familyItemLimit.value,
    familyMembers: familyMembers.value,
    items: items.value,
  })
}

// Keep the snapshot current as state changes (mutations, realtime events).
// Guarded by hasInitialized inside persistSnapshot, so hydration itself and
// partial init states are never written back.
watch([items, familyMembers, familyName, familyInviteCode, familyItemLimit], persistSnapshot, {
  deep: true,
})

function sanitizeAuthCallbackUrl() {
  const cleanedUrl = cleanAuthCallbackUrl(window.location.href)
  if (cleanedUrl) window.history.replaceState({}, '', cleanedUrl)
}

async function loadFamilyHeader() {
  const [{ data: family, error: familyErr }, { data: members, error: membersErr }] = await Promise.all([
    db.from('families').select('name, invite_code, created_by, max_items_per_member').eq('id', familyId.value).single(),
    db.from('family_members').select('user_id, display_name, image_url, role').eq('family_id', familyId.value),
  ])

  if (!familyErr && family) {
    familyName.value = family.name
    familyInviteCode.value = family.invite_code || ''
    familyOwnerId.value = family.created_by || ''
    familyItemLimit.value = Math.min(50, Math.max(1, Number(family.max_items_per_member) || 50))
  }

  if (!membersErr && Array.isArray(members)) {
    familyMembers.value = members
  }
}

async function refreshMembershipOrRedirect() {
  const { data: membership, error } = await db
    .from('family_members')
    .select('family_id')
    .eq('user_id', userId.value)
    .limit(1)
    .maybeSingle()

  // A failed lookup (network drop, transient server error) must not be read as
  // "no membership" and eject the user to setup — leave them where they are.
  if (error) return

  if (!membership?.family_id) {
    cleanupRealtimeSubscriptions()
    clearFamilySnapshot(localStorage)
    router.replace('/family-setup')
    return
  }

  if (membership.family_id !== familyId.value) {
    familyId.value = membership.family_id
    await loadFamilyHeader()
    await loadItems()
    await setupRealtimeSubscriptions()
  }
}


async function loadItems() {
  // Push any writes made offline before reading the list back, so a reload that
  // races the flush (realtime/watchdog on reconnect) can't momentarily show the
  // server's version without the user's own pending change.
  await ensureQueueFlushed()

  const [uncheckedRes, checkedRes] = await Promise.all([
    db
      .from('shopping_list_items')
      .select('*')
      .eq('family_id', familyId.value)
      .eq('checked', false)
      .order('created_at', { ascending: true }),
    db
      .from('shopping_list_items')
      .select('*')
      .eq('family_id', familyId.value)
      .eq('checked', true)
      .order('created_at', { ascending: false })
      .limit(30)
  ])

  // Offline: keep the cached list on screen and let the 'online' handler refetch.
  // Genuine server errors get a plain message, never a raw "Failed to fetch".
  const readError = uncheckedRes.error || checkedRes.error
  if (readError) {
    if (!isOfflineError(readError)) loadError.value = 'Could not load your list. Please try again.'
    return
  }

  // Merge the two lists (checkedRes.data is sorted descending, but we preserve it in items state)
  // We reverse the checked items so they display in creation order if needed, 
  // or simply keep them as is. Let's sort the merged items to match how they were displayed.
  items.value = [...uncheckedRes.data, ...checkedRes.data]
}

async function addItem() {
  const name = newItem.value.trim()
  if (!name || adding.value) return
  if (name.length > ITEM_NAME_MAX_LENGTH) {
    addError.value = `Item name must be ${ITEM_NAME_MAX_LENGTH} characters or fewer.`
    return
  }
  addError.value = ''

  const quantity = newQty.value

  // If an unchecked item with the same name already exists, bump its quantity
  // instead of adding a duplicate row. Checked (already-bought) items are left
  // alone so re-adding them starts a fresh active item.
  const existing = findActiveItemByName(items.value, name)
  if (existing) {
    newItem.value = ''
    newQty.value = 1
    const previousQty = Number(existing.quantity) || 1
    existing.quantity = previousQty + quantity // optimistic
    if (isOffline()) {
      enqueueOfflineMutation(localStorage, effectiveUserId.value, {
        kind: 'update',
        id: existing.id,
        patch: { quantity: existing.quantity },
      })
      return
    }
    const { error } = await db
      .from('shopping_list_items')
      .update({ quantity: existing.quantity })
      .eq('id', existing.id)
    if (error) {
      // Keep the bumped quantity and sync it when connectivity returns.
      if (deferIfOffline(error, { kind: 'update', id: existing.id, patch: { quantity: existing.quantity } })) return
      existing.quantity = previousQty // rollback
      addError.value = error.message ?? 'Could not update that item.'
    }
    return
  }

  // Guard the per-member active-item cap locally so we never flash an optimistic
  // row that the DB trigger would reject. The trigger (migration 010) stays the
  // authoritative backstop for races or stale local state.
  const activeCount = countActiveItemsByMember(items.value, effectiveUserId.value)
  if (activeCount >= familyItemLimit.value) {
    limitReachedPopupOpen.value = true
    return
  }
  const creatorName = getUserDisplayName(user.value) || getUserPrimaryEmail(user.value) || 'Unknown'
  const creatorImageUrl = user.value?.imageUrl || null

  // Optimistic: show the item instantly and clear the form. The per-member cap
  // is enforced authoritatively by the DB trigger (migration 010), so we don't
  // pre-count here — a rejection rolls the row back below.
  //
  // Generate the id client-side and reuse it as the row's primary key so the
  // optimistic row and the real row share the same TransitionGroup key. If the
  // key changed when the insert echoed back, Vue would remount the element and
  // restart the add animation mid-flight.
  const id = crypto.randomUUID()
  const row = {
    id,
    family_id: familyId.value,
    name,
    quantity,
    added_by: effectiveUserId.value,
    added_by_name: creatorName,
    added_by_image_url: creatorImageUrl,
  }
  items.value.push({
    ...row,
    checked: false,
    created_at: new Date().toISOString(),
  })
  newItem.value = ''
  newQty.value = 1

  if (isOffline()) {
    enqueueOfflineMutation(localStorage, effectiveUserId.value, { kind: 'insert', id, row })
    return
  }

  const { data, error } = await db
    .from('shopping_list_items')
    .insert(row)
    .select()
    .single()

  if (error) {
    // Lost a race: the DB already has an unchecked item with this name (our local
    // check missed it). Fold this quantity into that row instead of erroring.
    if (error.code === '23505') {
      await incrementActiveItemByName(name, quantity, id)
      return
    }
    // Network failure (WebView reported online but the write never left): keep
    // the optimistic row and queue the insert for the next sync.
    if (deferIfOffline(error, { kind: 'insert', id, row })) return
    // Roll back the optimistic row and surface the reason.
    items.value = items.value.filter((i) => i.id !== id)
    if (error.message?.includes('member_active_item_limit_exceeded')
      || error.message?.includes('limit of')) {
      limitReachedPopupOpen.value = true
    } else {
      addError.value = error.message ?? 'Failed to add item.'
      newItem.value = name
      newQty.value = quantity
    }
    return
  }

  // Refresh the row with server-authoritative fields. The id is unchanged, so no
  // remount; the realtime INSERT echo dedupes on this same id and is a no-op.
  const index = items.value.findIndex((i) => i.id === id)
  if (index !== -1) items.value[index] = data
}

// Increment the existing active row with this name (used when a concurrent add
// beat us to it). Looks locally first, then fetches to reconcile stale state.
async function incrementActiveItemByName(name, quantity, optimisticId) {
  items.value = items.value.filter((i) => i.id !== optimisticId)

  let target = findActiveItemByName(items.value, name)
  if (!target) {
    const { data } = await db
      .from('shopping_list_items')
      .select('*')
      .eq('family_id', familyId.value)
      .eq('checked', false)
    target = findActiveItemByName(data || [], name)
    if (target && !items.value.some((i) => i.id === target.id)) items.value.push(target)
  }
  if (!target) {
    addError.value = 'Could not add that item.'
    return
  }

  const previousQty = Number(target.quantity) || 1
  target.quantity = previousQty + quantity
  const { error } = await db
    .from('shopping_list_items')
    .update({ quantity: target.quantity })
    .eq('id', target.id)
  if (error) {
    if (deferIfOffline(error, { kind: 'update', id: target.id, patch: { quantity: target.quantity } })) return
    target.quantity = previousQty
    addError.value = error.message ?? 'Could not update that item.'
  }
}

function closeLimitReachedPopup() {
  limitReachedPopupOpen.value = false
}

async function toggleItem(item) {
  const previous = item.checked
  const nextChecked = !previous

  // Unchecking: if another unchecked item with the same name already exists,
  // fold this one into it instead of leaving two active rows — same merge rule
  // as adding.
  if (!nextChecked) {
    const target = findActiveItemByName(items.value, item.name, { excludeId: item.id })
    if (target) {
      await mergeItemInto(item, target)
      return
    }
  }

  // Optimistic: flip immediately, roll back if the write fails.
  item.checked = nextChecked

  if (isOffline()) {
    enqueueOfflineMutation(localStorage, effectiveUserId.value, {
      kind: 'update',
      id: item.id,
      patch: { checked: nextChecked },
    })
    return
  }

  const { error } = await db
    .from('shopping_list_items')
    .update({ checked: nextChecked })
    .eq('id', item.id)

  if (error) {
    // Keep the flip and queue it when the failure is just lost connectivity.
    if (deferIfOffline(error, { kind: 'update', id: item.id, patch: { checked: nextChecked } })) return
    item.checked = previous
    // Unique-violation while unchecking: an active same-name row appeared (race).
    // Merge into it rather than surfacing an error.
    if (!nextChecked && error.code === '23505') {
      let target = findActiveItemByName(items.value, item.name, { excludeId: item.id })
      if (!target) {
        const { data } = await db
          .from('shopping_list_items')
          .select('*')
          .eq('family_id', familyId.value)
          .eq('checked', false)
        target = findActiveItemByName(data || [], item.name, { excludeId: item.id })
        if (target && !items.value.some((i) => i.id === target.id)) items.value.push(target)
      }
      if (target) {
        await mergeItemInto(item, target)
        return
      }
    }
    loadError.value = error.message ?? 'Could not update that item.'
  }
}

// Fold `source`'s quantity into `target` (same-name unchecked row) and remove
// `source`. Optimistic, with rollback if either write fails.
async function mergeItemInto(source, target) {
  const sourceIndex = items.value.findIndex((i) => i.id === source.id)
  const previousTargetQty = Number(target.quantity) || 1
  const addedQty = Number(source.quantity) || 1

  target.quantity = previousTargetQty + addedQty
  const removedSource = sourceIndex !== -1 ? items.value.splice(sourceIndex, 1)[0] : source

  const rollback = (message) => {
    target.quantity = previousTargetQty
    if (sourceIndex !== -1) items.value.splice(sourceIndex, 0, removedSource)
    loadError.value = message
  }

  if (isOffline()) {
    // Queue both halves of the merge; if `source` was itself added offline, the
    // queue coalesces the pair away entirely.
    enqueueOfflineMutation(localStorage, effectiveUserId.value, {
      kind: 'update',
      id: target.id,
      patch: { quantity: target.quantity },
    })
    enqueueOfflineMutation(localStorage, effectiveUserId.value, { kind: 'delete', id: source.id })
    return
  }

  const { error: updateErr } = await db
    .from('shopping_list_items')
    .update({ quantity: target.quantity })
    .eq('id', target.id)
  if (updateErr) {
    // Neither half reached the server: queue both and keep the merged state.
    if (isOfflineError(updateErr)) {
      enqueueOfflineMutation(localStorage, effectiveUserId.value, { kind: 'update', id: target.id, patch: { quantity: target.quantity } })
      enqueueOfflineMutation(localStorage, effectiveUserId.value, { kind: 'delete', id: source.id })
      return
    }
    rollback(updateErr.message ?? 'Could not merge those items.')
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
    await db.from('shopping_list_items').update({ quantity: previousTargetQty }).eq('id', target.id)
    rollback(deleteErr.message ?? 'Could not merge those items.')
  }
}

async function deleteItem(item) {
  // Optimistic: remove immediately, restore at its original position on failure.
  const index = items.value.findIndex((i) => i.id === item.id)
  if (index === -1) return
  const [removed] = items.value.splice(index, 1)

  if (isOffline()) {
    enqueueOfflineMutation(localStorage, effectiveUserId.value, { kind: 'delete', id: item.id })
    return
  }

  const { error } = await db
    .from('shopping_list_items')
    .delete()
    .eq('id', item.id)

  if (error) {
    // Keep the row removed and queue the delete when it's just connectivity.
    if (deferIfOffline(error, { kind: 'delete', id: item.id })) return
    items.value.splice(index, 0, removed)
    loadError.value = error.message ?? 'Could not delete that item.'
  }
}
</script>

<template>
  <div class="dashboard">
    <AppTopbar
      :family-id="familyId || ''"
      :family-name="familyName"
      :loading="initialLoading"
      :invite-code="familyInviteCode"
      :family-item-limit="familyItemLimit"
      :owner-user-id="familyOwnerId"
      :member-profiles="familyMembers"
      :current-user-id="effectiveUserId"
      @refresh-family="loadFamilyHeader"
    />

    <main class="dashboard-main">
      <div class="dashboard-content">

        <!-- Add item form -->
        <AddItemForm
          v-model:name="newItem"
          v-model:quantity="newQty"
          :adding="adding"
          :max-length="ITEM_NAME_MAX_LENGTH"
          @submit="addItem"
        />

        <ShoppingList
          :items="items"
          :loading="initialLoading"
          :show-empty="hasInitialized && !items.length && !loadError"
          @toggle="toggleItem"
          @delete="deleteItem"
        />

      </div>
    </main>

    <ConfirmModal
      :open="limitReachedPopupOpen"
      title="Limit reached"
      :message="`You reached your limit of ${familyItemLimit} active items. Check or delete items before adding more.`"
      confirm-text="Got it"
      :show-cancel="false"
      @confirm="closeLimitReachedPopup"
      @cancel="closeLimitReachedPopup"
    />

    <ErrorModal :message="loadError" @dismiss="loadError = ''" />
    <ErrorModal :message="addError" @dismiss="addError = ''" />
  </div>
</template>

<style scoped>
.dashboard {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--color-primary-bg);
}

.dashboard-main {
  flex: 1;
  display: flex;
  justify-content: center;
  padding: 2rem 1rem;
  padding-top: calc(72px + 2rem + var(--safe-top));
  padding-bottom: calc(2rem + var(--safe-bottom));
}

.dashboard-content {
  width: 100%;
  max-width: 480px;
}
</style>

