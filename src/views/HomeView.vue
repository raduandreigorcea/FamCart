<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { useAuth, useUser } from '@clerk/vue'
import { useRouter } from 'vue-router'
import { useSupabase } from '../supabase'
import AppTopbar from '../components/AppTopbar.vue'
import ConfirmModal from '../components/ConfirmModal.vue'
import CustomProductModal from '../components/CustomProductModal.vue'
import ErrorModal from '../components/ErrorModal.vue'
import NotificationPromptModal from '../components/NotificationPromptModal.vue'
import ShoppingList from '../components/ShoppingList.vue'
import AddItemForm from '../components/AddItemForm.vue'
import OnboardingTour from '../components/OnboardingTour.vue'
import { useFamilyRealtime } from '../lib/familyRealtime'
import { useProductSuggestions } from '../lib/productSuggestions'
import type { ProductSuggestion } from '../lib/productSearch'
import type { FamilyMemberProfile, ShoppingItemRow } from '../lib/familyRealtime'
import { ITEM_NAME_MAX_LENGTH, useShoppingListActions } from '../lib/shoppingListActions'
import { upsertOwnProfile } from '../lib/profile'
import { cleanAuthCallbackUrl } from '../lib/authCallbackUrl'
import {
  loadFamilySnapshot,
  saveFamilySnapshot,
  clearFamilySnapshot,
  loadActiveFamilyId,
  saveActiveFamilyId,
  clearActiveFamilyId,
} from '../lib/familyCache'
import { flushOfflineQueue, isOfflineError } from '../lib/offlineQueue'
import { isCurrentlyOffline, onReconnect } from '../lib/connectivity'
import { rememberUser, getRememberedUser } from '../lib/session'
import { useFirstRunGreeting } from '../lib/firstRunGreeting'

const { userId, isLoaded } = useAuth()
const { user } = useUser()
const router = useRouter()
const db = useSupabase()

// Offline, Clerk hasn't loaded and userId is null, but we may have booted from a
// remembered session. Fall back to that id so the cache, offline queue, and new
// rows' authorship all key to the right user until Clerk confirms it online.
// Always a string: every consumer keys storage or rows by it, and '' simply
// finds nothing rather than forcing a null check at each call site.
const effectiveUserId = computed(() => userId.value || getRememberedUser(localStorage) || '')

// The switcher's rows: every family the user belongs to.
interface FamilyRow { id: string; name: string; emoji?: string | null }

// PostgREST types an embedded to-one relation as an array, but these selects
// each return a single joined row; the casts at the two call sites say so once.
interface MemberRow {
  user_id: string
  role?: string | null
  profiles?: { display_name?: string | null; image_url?: string | null } | null
}
interface MembershipRow {
  family_id: string
  families?: { name?: string | null } | null
}

const items = ref<ShoppingItemRow[]>([])
// Which rows the list shows: 'all' | 'active' | 'checked'. A view of `items`,
// never a filter on what is fetched -- every other path (realtime, offline
// queue, the item cap) keeps working on the whole list.
//
// Deliberately not persisted. Opening the app to a filtered list, with no memory
// of having set one, is how items get declared missing.
const listFilter = ref<'all' | 'active' | 'checked'>('all')
// Every family the user belongs to ({ id, name }), for the topbar switcher.
// familyId below is whichever one is currently active.
const families = ref<FamilyRow[]>([])
const familyId = ref<string | null>(null)
const familyName = ref('')
const familyInviteCode = ref('')
const familyOwnerId = ref('')
const familyItemLimit = ref(50)
const familyEmoji = ref('')
const familyMembers = ref<FamilyMemberProfile[]>([])
// Roster keyed by user id, so a list row can resolve its author's live avatar
// from added_by (the row no longer carries a copied name/photo).
const memberProfileMap = computed(
  () => new Map(familyMembers.value.map((m) => [m.user_id, m])),
)
const newItem = ref('')
const newQty = ref(1)
// Everything behind the search box: the catalog query, this family's purchase
// habits (which rank it), and the regulars offered before anything is typed.
// familyProductStats comes back out because the empty state reads it too — the
// same numbers answer "what does this family buy" and "have they ever shopped".
const {
  suggestions,
  suggestionsLoading,
  selectedProduct,
  searchExpanded,
  canAddCustomProduct,
  familyProductStats,
  productStatsLoaded,
  loadFamilyProductStats,
  recentProducts,
  restartProducts,
  lastAdded,
  reportAdded,
  clearLastAdded,
  recordProductAdd,
  clearSuggestions,
} = useProductSuggestions({ db, familyId, items, query: newItem, isOffline })
// A checkout that just succeeded is proof this family has shopped, available
// immediately rather than after the stats refetch lands.
const boughtThisSession = ref(false)
// The last known answer, from the cached snapshot. Offline this is the only one
// there is, since purchase history cannot be fetched.
const cachedHasShopped = ref(false)
const loadError = ref('')
const customProductOpen = ref(false)
// The one-time first-run sequence: gesture tour, then the notifications ask.
// Owns its own dialog state; the view renders them and passes the answers back.
const {
  onboardingTourOpen,
  notificationPromptOpen,
  notificationError,
  start: startFirstRunGreeting,
  closeTour: closeOnboardingTour,
  acceptNotifications,
  declineNotifications,
} = useFirstRunGreeting({ userId, isOffline })
const hasInitialized = ref(false)
// True while switchFamily is tearing down the old family and loading the new one.
// Drives the skeleton (instead of the "no items" empty state) so a switch never
// flashes the new family as empty.
const switchingFamily = ref(false)

// Every write the list can make, with the optimistic bookkeeping around them.
// It owns the in-flight write set and the offline-queue flush, because both
// exist only to keep those writes honest against a racing refetch.
const {
  pendingItemWrites,
  addError,
  limitReachedPopupOpen,
  closeLimitReachedPopup,
  ensureQueueFlushed,
  loadItems,
  addItem,
  toggleItem,
  deleteItem,
  checkoutItems,
} = useShoppingListActions({
  db,
  items,
  familyId,
  userId: effectiveUserId,
  itemLimit: familyItemLimit,
  isOffline,
  draftName: newItem,
  draftQuantity: newQty,
  selectedProduct,
  loadError,
  reportAdded,
  clearLastAdded,
  recordProductAdd,
  onCheckedOut: () => {
    // The list is empty because it was bought, not because it was never filled.
    boughtThisSession.value = true
    // The checkout just became history, which is the ranking signal — fold it in
    // so what was bought ranks higher on the very next keystroke.
    void loadFamilyProductStats()
  },
})

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
  onFamilyDeleted: () => void reconcileActiveFamily(),
  // A realtime UPDATE must not clobber a row whose own write is still in flight
  // (its authoritative echo is still coming) — same guard as loadItems.
  hasPendingWrite: (id) => pendingItemWrites.has(id),
})

// Set once a cached snapshot has been painted. The list on screen is then real
// (an empty cached list is still an answer), so skeletons over it would be a lie.
const paintedFromCache = ref(false)
// Initial load: nothing painted or fetched yet, and no error to show instead.
// Items arriving (realtime or fetch) end the skeleton early even before
// hasInitialized flips.
const initialLoading = computed(
  () => !hasInitialized.value && !paintedFromCache.value && !items.value.length && !loadError.value,
)
// The skeleton shows on the first-ever load and while switching families.
const listLoading = computed(() => initialLoading.value || switchingFamily.value)

// Has this family ever bought anything? Purchase history is the record, but a
// checkout in this session counts before the refetch confirms it.
const hasShopped = computed(
  () => familyProductStats.value.size > 0 || boughtThisSession.value || cachedHasShopped.value,
)

// The three error channels are independent, so more than one can be set at once
// — a background refresh failing while an add is also rejected, say. Rendering a
// dialog each stacked two overlays on top of each other. Show the first that has
// something to say and leave the rest queued behind it; dismissing reveals the
// next, so nothing is silently dropped.
const ERROR_CHANNELS = [
  { ref: () => loadError, title: 'Something went wrong' },
  { ref: () => addError, title: 'Something went wrong' },
  { ref: () => notificationError, title: 'Notifications' },
]
const activeError = computed(() => {
  const channel = ERROR_CHANNELS.find((c) => c.ref().value)
  if (!channel) return { title: '', message: '', dismiss: () => {} }
  return {
    title: channel.title,
    message: channel.ref().value,
    dismiss: () => {
      channel.ref().value = ''
    },
  }
})
// The empty list has two opposite readings — "All bought" for a family that
// shops, "Nothing here yet" for one starting out — and picking the wrong one and
// correcting it a moment later is worse than waiting. Hold the empty state until
// the answer is actually known. There are no rows to delay in the meantime;
// this gates nothing but the message itself.
const emptyStateAnswerable = computed(() => productStatsLoaded.value || boughtThisSession.value)

// Mutations check this at call time: on a definite offline signal they queue
// the write instead of hitting the network. Mid-flight failures on a flaky
// connection keep the existing rollback paths. The Capacitor connectivity ref
// is authoritative on native; navigator.onLine is the web/test fallback.
function isOffline() {
  if (isCurrentlyOffline()) return true
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

let stopReconnect: (() => void) | null = null

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

// Picking a suggestion adds it outright rather than filling the input: the pick
// already says exactly which product was meant, so a second confirming tap is
// just friction. The typed text is dropped by addItem clearing the input.
function selectSuggestion(product: ProductSuggestion) {
  clearSuggestions()
  void addItem(product)
}

function openCustomProduct() {
  clearSuggestions()
  customProductOpen.value = true
}

// A custom product joins the list through exactly the same path as a catalog
// pick — it is simply a product the catalog does not have yet. The tag rides
// along so recordProductAdd knows to contribute it rather than bump it; it is
// dropped before the insert, which builds its row from named fields only.
function addCustomProduct(product: ProductSuggestion) {
  customProductOpen.value = false
  void addItem({ ...product, custom: true })
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

  // Clerk has not confirmed the session yet. A remembered user with a cached
  // snapshot still gets painted right now rather than staring at skeletons for
  // the whole Clerk warm-up: the router already vetted us here, and this is the
  // stale half of stale-while-revalidate. Offline that paint is the entire boot,
  // so we mark ourselves initialized and let reconnection reconcile; online it
  // is just the first frame, and the watch above re-enters below once Clerk
  // resolves.
  if (!isLoaded.value || !userId.value) {
    const uid = effectiveUserId.value
    if (uid && loadFamilySnapshot(localStorage, uid)) {
      sanitizeAuthCallbackUrl()
      hydrateFromCachedSnapshot()
      if (isOffline()) hasInitialized.value = true
    }
    return
  }

  // Clerk resolved to someone other than the remembered user we painted for:
  // that list belongs to the previous account, so drop it before going on.
  if (hydratedUserId && hydratedUserId !== userId.value) discardCachedPaint()

  // Confirmed signed in: remember this user so a later offline open can boot.
  rememberUser(localStorage, userId.value)
  // Keep our profile row (name + Clerk avatar) current, so a changed photo shows
  // up across every family. Best-effort and non-blocking: boot must not wait on
  // it, and the next load reconciles if it fails.
  void upsertOwnProfile(db, userId.value, user.value)
  sanitizeAuthCallbackUrl()
  hydrateFromCachedSnapshot()

  // Fetch every family the user belongs to (the switcher lists them), only once
  // Clerk has finished loading.
  const { error: mErr } = await loadFamilies()

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

  if (!families.value.length) {
    clearFamilySnapshot(localStorage)
    clearActiveFamilyId(localStorage)
    router.replace('/family-setup')
    return
  }

  // Restore the last active family if it is still one we belong to, else default
  // to the first; persist the choice so it survives reloads.
  const storedActiveId = loadActiveFamilyId(localStorage, userId.value)
  const activeFamily = families.value.find((f) => f.id === storedActiveId) || families.value[0]
  familyId.value = activeFamily.id
  saveActiveFamilyId(localStorage, effectiveUserId.value, activeFamily.id)
  // Writes queued during a previous offline session land before the first
  // fetch, so the list below already reflects them. No-op when the queue is empty.
  await flushOfflineQueue(localStorage, effectiveUserId.value, db)
  await loadFamilyHeader()
  await loadItems()
  // Not awaited: the list should paint without waiting on a ranking signal.
  // Until it lands, suggestions simply rank by the global catalog order.
  void loadFamilyProductStats()
  await setupRealtimeSubscriptions()
  hasInitialized.value = true
  persistSnapshot()
  startFirstRunGreeting()
}

// First run: teach the gestures with the tour, then (once it's dismissed) fall
// through to the notifications ask. A returning user who's already seen the tour
// skips straight to the notifications check.
// Which user the painted cache belongs to. We paint before Clerk can confirm the
// session, so if it then resolves to somebody else that paint is the wrong
// person's list and has to be dropped.
let hydratedUserId = ''

// Throw away a cache painted for a different user than the one Clerk confirmed.
function discardCachedPaint() {
  hydratedUserId = ''
  paintedFromCache.value = false
  items.value = []
  familyMembers.value = []
  familyId.value = ''
  familyName.value = ''
  familyInviteCode.value = ''
  familyOwnerId.value = ''
  familyEmoji.value = ''
}

// Paint the last known state immediately (stale-while-revalidate): a returning
// user sees their list instead of skeletons while the fresh fetches above run.
function hydrateFromCachedSnapshot() {
  if (items.value.length) return
  const snapshot = loadFamilySnapshot(localStorage, effectiveUserId.value)
  if (!snapshot) return
  hydratedUserId = effectiveUserId.value
  paintedFromCache.value = true
  familyId.value = snapshot.familyId
  familyName.value = snapshot.familyName
  familyInviteCode.value = snapshot.familyInviteCode
  familyOwnerId.value = snapshot.familyOwnerId
  familyItemLimit.value = snapshot.familyItemLimit
  familyEmoji.value = snapshot.familyEmoji || ''
  familyMembers.value = snapshot.familyMembers
  items.value = snapshot.items
  // Offline there is no purchase history to read, so the cached answer is the
  // only one available. Without it an empty list tells a family that shops every
  // week they have never started.
  cachedHasShopped.value = snapshot.hasShopped
}

function persistSnapshot() {
  if (!hasInitialized.value || !effectiveUserId.value || !familyId.value) return
  saveFamilySnapshot(localStorage, effectiveUserId.value, {
    familyId: familyId.value,
    familyName: familyName.value,
    familyInviteCode: familyInviteCode.value,
    familyOwnerId: familyOwnerId.value,
    familyItemLimit: familyItemLimit.value,
    familyEmoji: familyEmoji.value,
    familyMembers: familyMembers.value,
    items: items.value,
    hasShopped: hasShopped.value,
  })
}

// Keep the snapshot current as state changes (mutations, realtime events).
// Guarded by hasInitialized inside persistSnapshot, so hydration itself and
// partial init states are never written back.
watch([items, familyMembers, familyName, familyInviteCode, familyItemLimit, familyEmoji], persistSnapshot, {
  deep: true,
})

function sanitizeAuthCallbackUrl() {
  const cleanedUrl = cleanAuthCallbackUrl(window.location.href)
  if (cleanedUrl) window.history.replaceState({}, '', cleanedUrl)
}

async function loadFamilyHeader() {
  const [{ data: family, error: familyErr }, { data: members, error: membersErr }] = await Promise.all([
    db.from('families').select('name, invite_code, created_by, max_items_per_member').eq('id', familyId.value).single(),
    // Name/avatar live in profiles now; embed them so the roster keeps the same
    // { user_id, display_name, image_url, role } shape every consumer expects.
    db.from('family_members').select('user_id, role, profiles(display_name, image_url)').eq('family_id', familyId.value),
  ])

  if (!familyErr && family) {
    familyName.value = family.name
    familyInviteCode.value = family.invite_code || ''
    familyOwnerId.value = family.created_by || ''
    familyItemLimit.value = Math.min(50, Math.max(1, Number(family.max_items_per_member) || 50))
  }

  // Best-effort, on its own query: the emoji column may not be migrated yet, and
  // a missing-column error here must not take the family header down with it.
  try {
    const { data: emojiRow, error: emojiErr } = await db
      .from('families')
      .select('emoji')
      .eq('id', familyId.value)
      .maybeSingle()
    if (!emojiErr) familyEmoji.value = emojiRow?.emoji || ''
  } catch {
    // Column absent → the family simply has no emoji.
  }

  if (!membersErr && Array.isArray(members)) {
    familyMembers.value = (members as unknown as MemberRow[]).map((m) => ({
      user_id: m.user_id,
      role: m.role,
      display_name: m.profiles?.display_name || m.user_id,
      image_url: m.profiles?.image_url || null,
    }))
  }
}

// A family setting changed (name, item limit, emoji): refresh the active family's
// header and the switcher list together, so a new name or emoji shows up in the
// switcher right away rather than only after the next reload.
async function refreshFamilyAfterSettingsChange() {
  await loadFamilyHeader()
  await loadFamilies()
}

// Every family the user belongs to, with names for the switcher. Only refreshes
// the roster; the active family is chosen by the caller.
async function loadFamilies() {
  const { data, error } = await db
    .from('family_members')
    .select('family_id, families(name)')
    .eq('user_id', userId.value)
  if (error) return { error }
  // The switcher renders an emoji tile, a name and a tick, so that is all a row
  // carries. It used to fetch every family's full roster here to draw composite
  // member avatars; those are gone, and so is the extra round trip.
  const list = ((data ?? []) as unknown as MembershipRow[]).map((row) => ({
    id: row.family_id,
    name: row.families?.name ?? '',
    emoji: '',
  }))

  // Best-effort family emoji (its column may be unmigrated), keyed by family id.
  // RLS scopes families to this user, so one unfiltered select is enough.
  try {
    const { data: emojiRows, error: emojiErr } = await db.from('families').select('id, emoji')
    if (!emojiErr && Array.isArray(emojiRows)) {
      const emojiById = new Map(emojiRows.map((r) => [r.id, r.emoji || '']))
      for (const fam of list) fam.emoji = emojiById.get(fam.id) || ''
    }
  } catch {
    // Column absent → families just have no emoji.
  }

  // Stable, name-ordered so the switcher never reshuffles between loads.
  families.value = list.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  return { error: null }
}

// Switch which family is active: persist the choice, tear down the old realtime
// channels, and reload everything scoped to the new family.
async function switchFamily(id: string) {
  if (!id || id === familyId.value) return
  if (!families.value.some((f) => f.id === id)) return
  switchingFamily.value = true
  familyId.value = id
  saveActiveFamilyId(localStorage, effectiveUserId.value, id)
  cleanupRealtimeSubscriptions()
  // Drop the old family's data so none of it flashes under the new name.
  items.value = []
  // A filter belongs to the list it was chosen for. Carrying "Checked" into a
  // family whose cart is empty opens it on a blank list.
  listFilter.value = 'all'
  familyMembers.value = []
  familyProductStats.value = new Map()
  // The new family's history is unknown until it loads. Without this reset the
  // cleared Map reads as "never shopped" and an empty list flashes "Nothing here
  // yet" before the refetch turns it into "All bought".
  productStatsLoaded.value = false
  boughtThisSession.value = false
  // The cached answer belonged to the family we just left.
  cachedHasShopped.value = false
  loadError.value = ''
  // Show the new name straight away (we already know it from the switcher list);
  // only the roster is unknown until loadFamilyHeader returns, so that's all the
  // topbar skeletons.
  const next = families.value.find((f) => f.id === id)
  if (next) familyName.value = next.name
  try {
    await loadFamilyHeader()
    await loadItems()
  } finally {
    // The rows are on screen, so the skeleton has nothing left to stand in for.
    // Product stats and the realtime channel are background work; holding the
    // placeholder up behind a websocket handshake just delays the real list.
    switchingFamily.value = false
  }
  void loadFamilyProductStats()
  await setupRealtimeSubscriptions()
}

// The switcher's "add" action: the setup page handles join/create, and the guard
// allows it while under the family cap.
function openAddFamily() {
  router.push({ name: 'family-setup', query: { add: '1' } })
}

// The active family vanished (deleted, left, or we were removed): move to another
// family we still belong to, or fall back to setup when none remain.
async function reconcileActiveFamily() {
  const { error } = await loadFamilies()
  // A failed lookup (network drop, transient server error) must not be read as
  // "no membership" and eject the user — leave them where they are.
  if (error) return
  if (families.value.some((f) => f.id === familyId.value)) return
  if (families.value.length) {
    await switchFamily(families.value[0].id)
    return
  }
  cleanupRealtimeSubscriptions()
  clearFamilySnapshot(localStorage)
  clearActiveFamilyId(localStorage)
  router.replace('/family-setup')
}

// Called when a member-removal realtime event lands: if it was us being removed
// from the active family, reconcile moves us on.
async function refreshMembershipOrRedirect() {
  await reconcileActiveFamily()
}


</script>

<template>
  <div class="dashboard">
    <AppTopbar
      :family-id="familyId || ''"
      :family-name="familyName"
      :families="families"
      :loading="initialLoading"
      :members-loading="switchingFamily"
      :invite-code="familyInviteCode"
      :family-item-limit="familyItemLimit"
      :family-emoji="familyEmoji"
      :owner-user-id="familyOwnerId"
      :member-profiles="familyMembers"
      :current-user-id="effectiveUserId"
      @refresh-family="refreshFamilyAfterSettingsChange"
      @switch-family="switchFamily"
      @add-family="openAddFamily"
      @family-deleted="reconcileActiveFamily"
      @family-left="reconcileActiveFamily"
    />

    <main class="dashboard-main">
      <div class="dashboard-content">

        <!-- Add item form -->
        <AddItemForm
          v-model:name="newItem"
          v-model:quantity="newQty"
          v-model:expanded="searchExpanded"
          :max-length="ITEM_NAME_MAX_LENGTH"
          :suggestions="suggestions"
          :recents="recentProducts"
          :last-added="lastAdded"
          :suggestions-loading="suggestionsLoading"
          :can-add-custom="canAddCustomProduct"
          @submit="addItem"
          @select="selectSuggestion"
          @add-custom="openCustomProduct"
        />

        <ShoppingList
          :items="items"
          v-model:filter="listFilter"
          :member-profiles="memberProfileMap"
          :loading="listLoading"
          :show-empty="hasInitialized && !items.length && !loadError && !switchingFamily && emptyStateAnswerable"
          :has-shopped="hasShopped"
          :suggested-products="restartProducts"
          @add="selectSuggestion"
          @toggle="toggleItem"
          @delete="deleteItem"
          @checkout="checkoutItems"
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

    <CustomProductModal
      :open="customProductOpen"
      :initial-name="newItem"
      :name-max-length="ITEM_NAME_MAX_LENGTH"
      @submit="addCustomProduct"
      @cancel="customProductOpen = false"
    />

    <OnboardingTour
      :open="onboardingTourOpen"
      :invite-code="familyInviteCode"
      @close="closeOnboardingTour"
    />

    <NotificationPromptModal
      :open="notificationPromptOpen"
      @accept="acceptNotifications"
      @decline="declineNotifications"
    />

    <ErrorModal
      :title="activeError.title"
      :message="activeError.message"
      @dismiss="activeError.dismiss()"
    />
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

/* Desktop: a phone-width strip looks lost on a big screen. Widen to the shared
   column and add air under the bar; past that, item rows get too long to scan. */
@media (min-width: 900px) {
  .dashboard-main {
    padding-top: calc(72px + 2.5rem + var(--safe-top));
  }

  .dashboard-content {
    max-width: var(--desktop-column);
  }
}
</style>

