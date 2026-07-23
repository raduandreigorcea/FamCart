<script setup>
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
import {
  findActiveItemByName,
  countActiveItemsByMember,
  sortItemsForDisplay,
} from '../lib/shoppingList'
import {
  normalizeSearchText,
  escapeIlikePattern,
  buildFamilyProductStats,
  rankSuggestions,
} from '../lib/productSearch'
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
import { enqueueOfflineMutation, flushOfflineQueue, hasQueuedOfflineMutations, isOfflineError } from '../lib/offlineQueue'
import { isCurrentlyOffline, onReconnect } from '../lib/connectivity'
import { rememberUser, getRememberedUser } from '../lib/session'
import { hasSeenTour, markTourSeen } from '../lib/onboarding'
import {
  enablePushNotifications,
  getNotificationPreference,
  setNotificationPreference,
  getOneSignalAppId,
  isDesktopBrowser,
  isPushSupported,
} from '../lib/pushNotifications'

const { userId, isLoaded, getToken } = useAuth()
const { user } = useUser()
const router = useRouter()
const db = useSupabase()

// Offline, Clerk hasn't loaded and userId is null, but we may have booted from a
// remembered session. Fall back to that id so the cache, offline queue, and new
// rows' authorship all key to the right user until Clerk confirms it online.
const effectiveUserId = computed(() => userId.value || getRememberedUser(localStorage))

const items = ref([])
// Every family the user belongs to ({ id, name }), for the topbar switcher.
// familyId below is whichever one is currently active.
const families = ref([])
// Ids of items with an online write in flight (a toggle, so far). A background
// refetch — reconnect, focus, watchdog — reads the server's pre-write value, so
// loadItems keeps the local optimistic row for these ids instead of clobbering
// the change with a row the write hasn't reached yet. Not reactive: it only
// gates loadItems, which reads it synchronously. Offline writes go through the
// queue (ensureQueueFlushed) and need no entry here.
const pendingItemWrites = new Set()
const familyId = ref(null)
const familyName = ref('')
const familyInviteCode = ref('')
const familyOwnerId = ref('')
const familyItemLimit = ref(50)
const familyEmoji = ref('')
const familyMembers = ref([])
// Roster keyed by user id, so a list row can resolve its author's live avatar
// from added_by (the row no longer carries a copied name/photo).
const memberProfileMap = computed(
  () => new Map(familyMembers.value.map((m) => [m.user_id, m])),
)
const newItem = ref('')
const newQty = ref(1)
// Product-catalog matches for what's being typed, and the suggestion the user
// picked (its maker is stored on the item and shown as a subtitle).
const suggestions = ref([])
const suggestionsLoading = ref(false)
const selectedProduct = ref(null)
// What this family actually buys, folded from purchase_history — the primary
// ranking signal for suggestions (see rankSuggestions).
const familyProductStats = ref(new Map())
const loadError = ref('')
const addError = ref('')
const customProductOpen = ref(false)
const limitReachedPopupOpen = ref(false)
const notificationPromptOpen = ref(false)
const notificationError = ref('')
// One-time first-run tour (add / swipe / invite). Shown once per device before
// the notifications ask, so a new user learns the gestures first.
const onboardingTourOpen = ref(false)
const adding = ref(false)
const hasInitialized = ref(false)
// True while switchFamily is tearing down the old family and loading the new one.
// Drives the skeleton (instead of the "no items" empty state) so a switch never
// flashes the new family as empty.
const switchingFamily = ref(false)
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
  onFamilyDeleted: () => void reconcileActiveFamily(),
  // A realtime UPDATE must not clobber a row whose own write is still in flight
  // (its authoritative echo is still coming) — same guard as loadItems.
  hasPendingWrite: (id) => pendingItemWrites.has(id),
})

// Initial load: nothing fetched yet and no error to show instead. Items arriving
// (realtime or fetch) end the skeleton early even before hasInitialized flips.
const initialLoading = computed(() => !hasInitialized.value && !items.value.length && !loadError.value)
// The skeleton shows on the first-ever load and while switching families.
const listLoading = computed(() => initialLoading.value || switchingFamily.value)

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
  if (suggestTimer) clearTimeout(suggestTimer)
})

// ── Product suggestions ───────────────────────────────────────────────────────
// Typing queries the read-only product catalog (debounced) and offers matches;
// picking one fills the input with the product name and remembers its maker.
// Best-effort: any failure just means no dropdown, never an error surface.
//
// The catalog is the only source of suggestions; this family's history only
// decides their order. History is not a catalog — it holds whatever anyone typed
// into the list, so a lazy "apa" entry would otherwise be offered as a product,
// outrank every real one, and entrench itself by being picked again.
//
// So the catalog is queried for a candidate pool wider than the six shown, and
// the final order is decided locally against familyProductStats.
let suggestTimer = null
let suggestRequestId = 0
const SUGGEST_MIN_CHARS = 2
const SUGGEST_LIMIT = 6
const SUGGEST_POOL = 50
// Long enough to mean "stopped typing" on a phone. Thumb-typing runs ~300-400ms
// per character, so a shorter pause than this elapses between ordinary
// keystrokes and every character would cost its own request.
const SUGGEST_DEBOUNCE_MS = 300

watch(newItem, (value) => {
  const query = value.trim()
  // Editing away from a picked suggestion drops its maker; retyping the exact
  // product name without re-picking keeps it (same product, same subtitle).
  if (selectedProduct.value && query !== selectedProduct.value.name) {
    selectedProduct.value = null
  }
  if (suggestTimer) clearTimeout(suggestTimer)
  if (query.length < SUGGEST_MIN_CHARS || selectedProduct.value) {
    suggestions.value = []
    suggestionsLoading.value = false
    return
  }
  // The last query's matches are not this query's answers, so drop them and show
  // the skeleton from the first keystroke — across the debounce as well as the
  // request, since both are time the user spends waiting. Without this the
  // dropdown would offer "Can't find it?" while the search is still running.
  suggestions.value = []
  suggestionsLoading.value = true
  suggestTimer = setTimeout(() => void fetchSuggestions(query), SUGGEST_DEBOUNCE_MS)
})

async function fetchSuggestions(query) {
  if (isOffline()) {
    suggestionsLoading.value = false
    return
  }
  const requestId = ++suggestRequestId
  try {
    const pattern = `%${escapeIlikePattern(normalizeSearchText(query))}%`
    let pool = db
      .from('product_catalog')
      .select('name, maker, popularity')
      .ilike('search_text', pattern)
    // Scope to the global catalog plus THIS family's own contributions. RLS
    // already blocks other families' rows, but a user in more than one family
    // would otherwise see (and, via recordProductAdd, bump) the products they
    // contributed elsewhere while shopping here. familyId is a server-issued
    // uuid, never typed input, so it is safe to interpolate into the filter.
    pool = familyId.value
      ? pool.or(`family_id.is.null,family_id.eq.${familyId.value}`)
      : pool.is('family_id', null)
    const { data, error } = await pool
      // Popularity decides which matches make the pool, then rankSuggestions
      // reorders it around this family. Ordering here (rather than only locally)
      // is what keeps the pool cap from cutting off globally-popular products.
      .order('popularity', { ascending: false })
      .order('name')
      .limit(SUGGEST_POOL)
    // Stale response: a newer keystroke queried already, and that request owns
    // the dropdown now — including when its skeleton stops.
    if (requestId !== suggestRequestId) return
    // Late response: the input was cleared or a product picked meanwhile, so
    // these matches must not reopen the list.
    if (error || selectedProduct.value || newItem.value.trim().length < SUGGEST_MIN_CHARS) return
    suggestions.value = rankSuggestions(data || [], familyProductStats.value, SUGGEST_LIMIT)
  } catch {
    // Suggestions are a convenience; a failed lookup changes nothing.
  } finally {
    // Only the newest request may stop the skeleton. A superseded one returning
    // early must leave it spinning for the request that replaced it, or the
    // dropdown would flash "Can't find it?" mid-search.
    if (requestId === suggestRequestId) suggestionsLoading.value = false
  }
}

// Fold this family's recent purchases into the ranking signal. Best-effort: on
// failure suggestions just fall back to the global catalog order. Retention
// (migration 019) already caps history at 60 checkouts / 30 days, so this is a
// small, naturally-recent window and can be fetched whole.
async function loadFamilyProductStats() {
  if (!familyId.value || isOffline()) return
  try {
    const { data, error } = await db
      .from('purchase_history')
      .select('name, maker, purchased_at')
      .eq('family_id', familyId.value)
    if (error) return
    familyProductStats.value = buildFamilyProductStats(data || [])
  } catch {
    // No stats just means suggestions rank globally, which is the old behaviour.
  }
}

// Picking a suggestion adds it outright rather than filling the input: the pick
// already says exactly which product was meant, so a second confirming tap is
// just friction. The typed text is dropped by addItem clearing the input.
function selectSuggestion(product) {
  suggestions.value = []
  void addItem(product)
}

// The escape hatch, offered as soon as the query is long enough to have been
// searched for — including when nothing matched, which is when it matters most.
const canAddCustomProduct = computed(() => newItem.value.trim().length >= SUGGEST_MIN_CHARS)

function openCustomProduct() {
  suggestions.value = []
  customProductOpen.value = true
}

// A custom product joins the list through exactly the same path as a catalog
// pick — it is simply a product the catalog does not have yet. The tag rides
// along so recordProductAdd knows to contribute it rather than bump it; it is
// dropped before the insert, which builds its row from named fields only.
function addCustomProduct(product) {
  customProductOpen.value = false
  void addItem({ ...product, custom: true })
}

// Record that a product was added, so it ranks higher in future suggestions.
// A catalog product just gets its popularity bumped. A custom one is contributed
// to the catalog scoped to this family — suggested back to them straight away,
// and promoted to a global suggestion only once enough other families have added
// the same product (migration 022), so one family's spelling cannot leak into
// everyone else's dropdown.
//
// Best-effort either way: fire-and-forget, never blocks or errors the add, and
// skipped offline (neither is part of the offline queue).
function recordProductAdd(product) {
  if (!product || isOffline()) return
  const call = product.custom
    ? db.rpc('add_custom_product', {
        p_family_id: familyId.value,
        p_name: product.name,
        p_maker: product.maker ?? null,
      })
    : db.rpc('bump_product_popularity', {
        p_name: product.name,
        p_maker: product.maker ?? null,
        p_family_id: familyId.value,
      })
  void call.then(() => {}, () => {})
}

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
  saveActiveFamilyId(localStorage, userId.value, activeFamily.id)
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
  maybeStartOnboarding()
}

// First run: teach the gestures with the tour, then (once it's dismissed) fall
// through to the notifications ask. A returning user who's already seen the tour
// skips straight to the notifications check.
function maybeStartOnboarding() {
  if (!userId.value) return
  if (!hasSeenTour(localStorage)) {
    onboardingTourOpen.value = true
    return
  }
  maybePromptForNotifications()
}

function closeOnboardingTour() {
  onboardingTourOpen.value = false
  markTourSeen(localStorage)
  maybePromptForNotifications()
}

// First-login greeting: users who never answered the notifications question get
// asked once, right after their list is up. An unset preference is the signal —
// both prompt buttons store a decision, so it never re-appears.
function maybePromptForNotifications() {
  if (!userId.value) return
  if (getNotificationPreference(localStorage)) return
  // No point asking where accepting could do nothing: unsupported browser,
  // push not configured, or offline (the OneSignal subscription needs the
  // network). Leaving the preference unset re-asks on the next login instead.
  if (!isPushSupported() || !getOneSignalAppId() || isOffline()) return
  // Desktop browsers never get greeted with a permission ask; the preference
  // stays unset so the same account is still asked on a phone later.
  if (isDesktopBrowser()) return
  notificationPromptOpen.value = true
}

async function acceptNotifications() {
  notificationPromptOpen.value = false
  setNotificationPreference(localStorage, 'on')
  const result = await enablePushNotifications(userId.value)
  if (result === 'permission-denied') {
    // The browser said no — reflect reality instead of a preference that lies.
    setNotificationPreference(localStorage, 'off')
    notificationError.value = 'Notifications are blocked for FamCart in your device or browser settings.'
  } else if (result === 'error') {
    setNotificationPreference(localStorage, 'off')
    notificationError.value = 'Could not enable notifications. You can try again from Account Settings.'
  }
}

function declineNotifications() {
  notificationPromptOpen.value = false
  setNotificationPreference(localStorage, 'off')
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
  familyEmoji.value = snapshot.familyEmoji || ''
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
    familyEmoji: familyEmoji.value,
    familyMembers: familyMembers.value,
    items: items.value,
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
    familyMembers.value = members.map((m) => ({
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
  const list = (data || []).map((row) => ({
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
async function switchFamily(id) {
  if (!id || id === familyId.value) return
  if (!families.value.some((f) => f.id === id)) return
  switchingFamily.value = true
  familyId.value = id
  saveActiveFamilyId(localStorage, userId.value, id)
  cleanupRealtimeSubscriptions()
  // Drop the old family's data so none of it flashes under the new name.
  items.value = []
  familyMembers.value = []
  familyProductStats.value = new Map()
  loadError.value = ''
  // Show the new name straight away (we already know it from the switcher list);
  // only the roster is unknown until loadFamilyHeader returns, so that's all the
  // topbar skeletons.
  const next = families.value.find((f) => f.id === id)
  if (next) familyName.value = next.name
  try {
    await loadFamilyHeader()
    await loadItems()
    void loadFamilyProductStats()
    await setupRealtimeSubscriptions()
  } finally {
    switchingFamily.value = false
  }
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
      // Most recently checked first, so the 30-row cap keeps the latest ticks.
      // This is a "which rows survive the cap" order, not a display order:
      // sortItemsForDisplay puts the merged list back into creation order.
      .order('checked_at', { ascending: false, nullsFirst: false })
      .limit(30)
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
  const fresh = [...uncheckedRes.data, ...checkedRes.data]
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
  items.value = sortItemsForDisplay(fresh)
}

// `product` is set when a suggestion was tapped, and that product is then the
// whole intent — name and maker both come from it, not from the input. A plain
// form submit passes nothing and adds whatever was typed.
async function addItem(product = null) {
  const name = (product?.name ?? newItem.value).trim()
  if (!name || adding.value) return
  if (name.length > ITEM_NAME_MAX_LENGTH) {
    addError.value = `Item name must be ${ITEM_NAME_MAX_LENGTH} characters or fewer.`
    return
  }
  addError.value = ''

  const quantity = newQty.value
  // The maker comes from a product rather than the typed text: the catalog
  // product just tapped, one restored after a failed add (the newItem watcher
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
      return
    }
    recordProductAdd(picked)
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
    maker,
    quantity,
    added_by: effectiveUserId.value,
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
    // Lost a race: the DB already has an unchecked item for this product (our
    // local check missed it). Fold this quantity into that row instead of erroring.
    if (error.code === '23505') {
      // The quantity still landed (folded into the existing row), so record the
      // add against the catalog just as the direct-insert path does.
      if (await incrementActiveItemByName(name, maker, quantity, id)) recordProductAdd(picked)
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
    items.value[index] = data
    // The server's created_at replaces the optimistic client timestamp — a
    // different sort key. Re-sort now so the row settles into its canonical spot
    // immediately, instead of sitting at the append position until the next
    // background sync abruptly moves it (the "rows jump on their own" bug).
    items.value = sortItemsForDisplay(items.value)
  }

  recordProductAdd(picked)
}

// Increment the existing active row for this product (used when a concurrent
// add beat us to it). Looks locally first, then fetches to reconcile stale state.
// Returns whether the quantity actually landed, so the caller knows whether to
// record the add against the catalog (a deferred offline update counts).
async function incrementActiveItemByName(name, maker, quantity, optimisticId) {
  items.value = items.value.filter((i) => i.id !== optimisticId)

  let target = findActiveItemByName(items.value, name, { maker })
  if (!target) {
    const { data } = await db
      .from('shopping_list_items')
      .select('*')
      .eq('family_id', familyId.value)
      .eq('checked', false)
    target = findActiveItemByName(data || [], name, { maker })
    if (target && !items.value.some((i) => i.id === target.id)) {
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
    if (deferIfOffline(error, { kind: 'update', id: target.id, patch: { quantity: target.quantity } })) return true
    target.quantity = previousQty
    addError.value = error.message ?? 'Could not update that item.'
    return false
  }
  return true
}

function closeLimitReachedPopup() {
  limitReachedPopupOpen.value = false
}

async function toggleItem(item) {
  const previous = item.checked
  const previousCheckedAt = item.checked_at ?? null
  const nextChecked = !previous

  // Unchecking: if another unchecked item with the same name already exists,
  // fold this one into it instead of leaving two active rows — same merge rule
  // as adding.
  if (!nextChecked) {
    const target = findActiveItemByName(items.value, item.name, {
      excludeId: item.id,
      maker: item.maker,
    })
    if (target) {
      await mergeItemInto(item, target)
      return
    }
  }

  // Optimistic: flip immediately, roll back if the write fails. checked_at is
  // mirrored because the refetch's 30-row cap is taken on it, not because it
  // affects position: display order is creation time, so a tick never moves the
  // row. The DB trigger (migration 024) is the authority on the stored value, so
  // we only send `checked` — the server stamps the time itself.
  item.checked = nextChecked
  item.checked_at = nextChecked ? new Date().toISOString() : null
  const patch = { checked: nextChecked }

  if (isOffline()) {
    enqueueOfflineMutation(localStorage, effectiveUserId.value, {
      kind: 'update',
      id: item.id,
      patch,
    })
    return
  }

  // Track the in-flight write so a background refetch that races it (reconnect,
  // focus, watchdog) keeps this flip rather than reading back the server's
  // pre-write value — see loadItems and pendingItemWrites.
  pendingItemWrites.add(item.id)
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
      // Unchecking would push the member over the active-item cap (migration 010
      // now enforces it on uncheck too): show the same friendly popup as adding.
      if (error.message?.includes('member_active_item_limit_exceeded')
        || error.message?.includes('limit of')) {
        limitReachedPopupOpen.value = true
        return
      }
      // Unique-violation while unchecking: an active same-name row appeared (race).
      // Merge into it rather than surfacing an error.
      if (!nextChecked && error.code === '23505') {
        let target = findActiveItemByName(items.value, item.name, {
          excludeId: item.id,
          maker: item.maker,
        })
        if (!target) {
          const { data } = await db
            .from('shopping_list_items')
            .select('*')
            .eq('family_id', familyId.value)
            .eq('checked', false)
          target = findActiveItemByName(data || [], item.name, {
            excludeId: item.id,
            maker: item.maker,
          })
          if (target && !items.value.some((i) => i.id === target.id)) {
            items.value = sortItemsForDisplay([...items.value, target])
          }
        }
        if (target) {
          await mergeItemInto(item, target)
          return
        }
      }
      loadError.value = error.message ?? 'Could not update that item.'
    }
  } finally {
    pendingItemWrites.delete(item.id)
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

// Check out every checked item: archive them to purchase history and drop them
// from the active list. The animation has already played in ShoppingList by the
// time this runs, so we just persist the outcome.
async function checkoutItems(ids) {
  const idSet = new Set(ids)
  const bought = items.value.filter((i) => idSet.has(i.id) && i.checked)
  if (!bought.length) return

  // Optimistic removal. Only drop the rows actually bought (checked) — never an
  // unchecked row that happened to be named in `ids` — mirroring the RPC's own
  // `checked = true` guard. Keep the pre-removal array so a hard failure can
  // restore the exact list, order included.
  const boughtIds = new Set(bought.map((i) => i.id))
  const snapshot = items.value
  items.value = items.value.filter((i) => !boughtIds.has(i.id))

  // Offline (or a WebView that lies about connectivity): there is no multi-table
  // transaction to run here, so queue plain deletes. The rows leave the list but
  // an offline checkout is not recorded in history — it is archived only when the
  // checkout runs against the server.
  if (isOffline()) {
    for (const it of bought) {
      enqueueOfflineMutation(localStorage, effectiveUserId.value, { kind: 'delete', id: it.id })
    }
    return
  }

  const { error } = await db.rpc('buy_items', { p_item_ids: bought.map((i) => i.id) })
  if (error) {
    // Never reached the server: keep them off the list and fall back to queued
    // deletes, same as the offline path.
    if (isOfflineError(error)) {
      for (const it of bought) {
        enqueueOfflineMutation(localStorage, effectiveUserId.value, { kind: 'delete', id: it.id })
      }
      return
    }
    items.value = snapshot
    loadError.value = error.message ?? 'Could not complete the checkout.'
    return
  }

  // The checkout just became history, which is the ranking signal — fold it in
  // so what was bought ranks higher on the very next keystroke.
  void loadFamilyProductStats()
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
          :adding="adding"
          :max-length="ITEM_NAME_MAX_LENGTH"
          :suggestions="suggestions"
          :suggestions-loading="suggestionsLoading"
          :can-add-custom="canAddCustomProduct"
          @submit="addItem"
          @select="selectSuggestion"
          @add-custom="openCustomProduct"
        />

        <ShoppingList
          :items="items"
          :member-profiles="memberProfileMap"
          :loading="listLoading"
          :show-empty="hasInitialized && !items.length && !loadError && !switchingFamily"
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

    <ErrorModal :message="loadError" @dismiss="loadError = ''" />
    <ErrorModal :message="addError" @dismiss="addError = ''" />
    <ErrorModal title="Notifications" :message="notificationError" @dismiss="notificationError = ''" />
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

