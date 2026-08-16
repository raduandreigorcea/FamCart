<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed, provide, watch } from 'vue'
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
import BarcodeScannerModal from '../components/BarcodeScannerModal.vue'
import OnboardingTour from '../components/OnboardingTour.vue'
import UpdateAvailableModal from '../components/UpdateAvailableModal.vue'
import { useHouseholdRealtime } from '../lib/householdRealtime'
import { useProductSuggestions } from '../lib/productSuggestions'
import {
  canScanBarcodes,
  nativeScanAvailable,
  scanWithNativeScanner,
} from '../lib/barcodeScanner'
import type { ProductSuggestion } from '../lib/productSearch'
import type { HouseholdMemberProfile, ShoppingItemRow } from '../lib/householdRealtime'
import { useShoppingListActions, type AddedProduct } from '../lib/shoppingListActions'
import { upsertOwnProfile } from '../lib/profile'
import { cleanAuthCallbackUrl } from '../lib/authCallbackUrl'
import {
  loadHouseholdSnapshot,
  saveHouseholdSnapshot,
  clearHouseholdSnapshot,
  loadActiveHouseholdId,
  saveActiveHouseholdId,
  clearActiveHouseholdId,
} from '../lib/householdCache'
import { flushOfflineQueue, isOfflineError } from '../lib/offlineQueue'
import { captureException } from '../lib/errorReporting'
// isCurrentlyOffline is the app's one answer to "are we offline", handed to
// every composable below that has to choose between writing and queueing. The
// composite it computes (Capacitor status first, navigator.onLine as the
// definite-offline backstop) used to be re-derived here, which left realtime
// reading navigator directly — see the note in lib/connectivity.
import { isCurrentlyOffline, onReconnect } from '../lib/connectivity'
import { rememberUser, getRememberedUser } from '../lib/session'
import { useFirstRunGreeting } from '../lib/firstRunGreeting'
import { updateCheckKey, useUpdatePrompt } from '../lib/updatePrompt'
import { syncPushUser } from '../lib/pushNotifications'
import {
  clampItemLimit,
  ITEM_LIMIT_DEFAULT,
  ITEM_NAME_MAX_LENGTH,
} from '../lib/limits'

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

// Every household the user belongs to; the account dialog lists them to switch.
interface HouseholdRow { id: string; name: string; emoji?: string | null }

// PostgREST types an embedded to-one relation as an array, but these selects
// each return a single joined row; the casts at the two call sites say so once.
interface MemberRow {
  user_id: string
  role?: string | null
  profiles?: { display_name?: string | null; image_url?: string | null } | null
}
interface MembershipRow {
  household_id: string
  households?: { name?: string | null; emoji?: string | null } | null
}

const items = ref<ShoppingItemRow[]>([])
// Which rows the list shows: 'all' | 'active' | 'checked'. A view of `items`,
// never a filter on what is fetched -- every other path (realtime, offline
// queue, the item cap) keeps working on the whole list.
//
// Deliberately not persisted. Opening the app to a filtered list, with no memory
// of having set one, is how items get declared missing.
const listFilter = ref<'all' | 'active' | 'checked'>('all')
// Every household the user belongs to ({ id, name }), listed in the account
// dialog. householdId below is whichever one is currently active.
const households = ref<HouseholdRow[]>([])
const householdId = ref<string | null>(null)
const householdName = ref('')
const householdInviteCode = ref('')
const householdOwnerId = ref('')
const householdItemLimit = ref(ITEM_LIMIT_DEFAULT)
const householdEmoji = ref('')
const householdMembers = ref<HouseholdMemberProfile[]>([])
// Roster keyed by user id, so a list row can resolve its author's live avatar
// from added_by (the row no longer carries a copied name/photo).
const memberProfileMap = computed(
  () => new Map(householdMembers.value.map((m) => [m.user_id, m])),
)
const newItem = ref('')
// What one add puts on the list. No longer picked before the product it counts:
// the add form got you to name a number before you had named the thing, and then
// reset it after every add. Adding is one tap now, and the row's own stepper is
// where a quantity is set — so this stays 1, and addItem's merge (same product
// again sums the quantities) is what turns two taps into two.
const newQty = ref(1)
// Everything behind the search box: the catalog query, this household's purchase
// habits (which rank it), and the regulars offered before anything is typed.
// householdProductStats comes back out because the empty state reads it too — the
// same numbers answer "what does this household buy" and "have they ever shopped".
const {
  suggestions,
  suggestionsLoading,
  selectedProduct,
  searchExpanded,
  canAddCustomProduct,
  householdProductStats,
  productStatsLoaded,
  loadHouseholdProductStats,
  resetForHousehold,
  recentProducts,
  restartProducts,
  lookupBarcode,
  lastAdded,
  reportAdded,
  clearLastAdded,
  recordProductAdd,
  clearSuggestions,
} = useProductSuggestions({ db, householdId, items, query: newItem, isOffline: isCurrentlyOffline })
// A checkout that just succeeded is proof this household has shopped, available
// immediately rather than after the stats refetch lands.
const boughtThisSession = ref(false)
// Which household the cached snapshot said had shopped, or '' for none. Offline
// this is the only answer there is, since purchase history cannot be fetched.
//
// The household id rather than a bare boolean, because the snapshot is keyed to the
// USER: after creating or joining a household, that household is active immediately
// while the painted snapshot still describes the previous one. A boolean carried
// the old household's answer straight onto the new household's empty list, which then
// opened on "All bought" having bought nothing. Storing what the answer is ABOUT
// makes it self-invalidating — no path can forget to clear it.
const cachedShoppedHouseholdId = ref('')
const loadError = ref('')
const customProductOpen = ref(false)
// Whether this device has a camera the app can reach and something to decode
// with. Asked once at setup rather than per render: it cannot change while the
// view is mounted, and the answer decides whether the add form offers the button
// at all. A browser that cannot scan is never shown a control that would fail.
const canScan = canScanBarcodes()
const scannerOpen = ref(false)
// A barcode is being looked up. Holds the scanner still so one code cannot start
// a second lookup over its own.
const scanBusy = ref(false)
// The last code the catalog had no product for, and every code that has missed
// while this scanner has been open. The set is what keeps a barcode lying in
// frame from re-querying every couple of seconds for an answer that has not
// changed.
const scannedUnknown = ref('')
const unknownCodes = new Set<string>()
// The code the custom-product modal is naming, carried from the scan that missed
// so the contributed catalog row can keep it.
const pendingBarcode = ref('')
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
} = useFirstRunGreeting({
  userId,
  isOffline: isCurrentlyOffline,
  // The update offer goes last, after the one-time greeting has had its say.
  onSettled: () => void startUpdateCheck(),
})
// The Android app cannot update itself the way the web app does, so it has to be
// told. A no-op everywhere else — see lib/nativeUpdate.
const appVersion = __APP_VERSION__
const {
  updateOpen,
  updatePhase,
  updateVersion,
  updateProgress,
  start: startUpdateCheck,
  checkNow: checkForUpdateNow,
  install: installUpdate,
  openInstallSettings,
  openReleasesPage,
  dismiss: dismissUpdate,
} = useUpdatePrompt({ currentVersion: appVersion })
// Settings → About runs the same check on demand; see updateCheckKey.
provide(updateCheckKey, checkForUpdateNow)
const hasInitialized = ref(false)
// True while switchHousehold is tearing down the old household and loading the new one.
// Drives the skeleton (instead of the "no items" empty state) so a switch never
// flashes the new household as empty.
const switchingHousehold = ref(false)

// Every write the list can make, with the optimistic bookkeeping around them.
// It owns the in-flight write set and the offline-queue flush, because both
// exist only to keep those writes honest against a racing refetch.
const {
  pendingItemWrites,
  addError,
  limitReachedPopupOpen,
  closeLimitReachedPopup,
  ensureQueueFlushed,
  flushQuantityWrites,
  loadItems,
  addItem,
  toggleItem,
  setItemQuantity,
  deleteItem,
  checkoutItems,
} = useShoppingListActions({
  db,
  items,
  householdId,
  userId: effectiveUserId,
  itemLimit: householdItemLimit,
  isOffline: isCurrentlyOffline,
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
    void loadHouseholdProductStats()
  },
})

// Realtime sync (channels, reconnects, watchdog) lives in the composable; it
// registers its own lifecycle listeners and calls back into the loaders below.
const { setupRealtimeSubscriptions, cleanupRealtimeSubscriptions } = useHouseholdRealtime({
  db,
  householdId,
  hasInitialized,
  items,
  householdMembers,
  loadItems,
  loadHouseholdHeader,
  onHouseholdDeleted: () => void reconcileActiveHousehold(),
  // Being removed from the active household is the same question as the active
  // household vanishing: which household are we in now? Passed directly rather
  // than through a wrapper that only forwarded it.
  refreshMembershipOrRedirect: reconcileActiveHousehold,
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
// The skeleton shows on the first-ever load and while switching households.
const listLoading = computed(() => initialLoading.value || switchingHousehold.value)

// Has this household ever bought anything? Purchase history is the record, but a
// checkout in this session counts before the refetch confirms it.
const hasShopped = computed(
  () =>
    householdProductStats.value.size > 0
    || boughtThisSession.value
    // Only while the cached answer is about the household currently on screen.
    || (!!householdId.value && cachedShoppedHouseholdId.value === householdId.value),
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
// The empty list has two opposite readings — "All bought" for a household that
// shops, "Nothing here yet" for one starting out — and picking the wrong one and
// correcting it a moment later is worse than waiting. Hold the empty state until
// the answer is actually known. There are no rows to delay in the meantime;
// this gates nothing but the message itself.
//
// But "known" is not the same as "fetched". The cached snapshot carries the answer
// for the household it describes, and hasShopped above already trusts it — so a
// returning user whose list is empty has no reason to sit in front of a blank
// column for the length of a purchase_history query. That wait was the whole
// delay: the skeleton comes down on the first painted frame and nothing replaced
// it until the fourth round trip of boot landed.
//
// Only ever unblocks the "yes" — cachedShoppedHouseholdId is set only when the
// snapshot said this household has shopped, so the genuinely ambiguous case
// still waits for the query, which is what the paragraph above asks for.
const emptyStateAnswerable = computed(
  () =>
    productStatsLoaded.value
    || boughtThisSession.value
    || (!!householdId.value && cachedShoppedHouseholdId.value === householdId.value),
)

// Whether to say the list is empty at all, as opposed to which of the two
// sentences to say.
//
// paintedFromCache counts alongside hasInitialized for the reason initialLoading
// gives above: a painted snapshot is a real list, and an empty one is a real
// answer. Waiting for hasInitialized instead meant waiting for the whole boot
// sequence — households, header, items, realtime — with the skeleton already
// down, which is a blank column for as long as that takes. The stale reading can
// be wrong (someone added something since the snapshot), and then the rows
// arrive over it; that is the same bargain the cached list itself is already
// making, and it is a better one than showing nothing.
const showEmptyState = computed(
  () =>
    (hasInitialized.value || paintedFromCache.value)
    && !items.value.length
    && !loadError.value
    && !switchingHousehold.value
    && emptyStateAnswerable.value,
)

// The regulars on the empty state are ranked from purchase history, so they
// arrive a beat after the words do now that the words come from the cache. Only
// a household we already know has shopped gets placeholders held for it: one that
// has not is not waiting for anything, and pills that resolve to nothing would be
// a promise the screen cannot keep.
const restartProductsLoading = computed(() => hasShopped.value && !productStatsLoaded.value)

let stopReconnect: (() => void) | null = null

onMounted(() => {
  // Two reconnect signals: the reliable native one, plus the web 'online' event
  // for the browser and tests. Both funnel into the same idempotent sync.
  window.addEventListener('online', handleBackOnline)
  stopReconnect = onReconnect(handleBackOnline)
  // The snapshot write is deferred to coalesce bursts, so it can still be
  // outstanding when the app goes away — which on a phone is most of the time,
  // and is exactly the moment the next cold boot depends on it. pagehide is the
  // one teardown event that fires reliably on mobile Safari and in a WebView.
  window.addEventListener('pagehide', flushPendingWork)
  document.addEventListener('visibilitychange', flushPendingWorkIfHidden)
  void initializeHome()
})

onBeforeUnmount(() => {
  window.removeEventListener('online', handleBackOnline)
  window.removeEventListener('pagehide', flushPendingWork)
  document.removeEventListener('visibilitychange', flushPendingWorkIfHidden)
  if (stopReconnect) stopReconnect()
  // Only the snapshot here: the quantity writes are flushed by the actions
  // composable's own unmount hook, which runs alongside this one.
  flushSnapshot()
})

// Picking a suggestion adds it outright rather than filling the input: the pick
// already says exactly which product was meant, so a second confirming tap is
// just friction.
//
// The query stays, and so do its matches. Adding used to empty the field and
// drop the suggestions with it, which is right when one search means one item
// and wrong the rest of the time -- "milk" is usually two kinds of milk, and
// getting the second one meant typing the word again. Clearing the matches here
// while the text remained would be worse than either: the search is debounced on
// the text changing, so an unchanged query would never fetch them back.
function selectSuggestion(product: ProductSuggestion) {
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
//
// A barcode rides along the same way when the modal was opened from a scan the
// catalog could not answer. That is what turns naming it into a one-time cost:
// the contributed row carries the code, so the next scan of the same package —
// by anyone in the household — finds it.
// The barcode now arrives in the payload rather than being held here: the dialog
// shows it as an optional field, so the user can correct a misread one, clear it,
// or type one in for a product they never scanned at all. This only has to stop
// holding its own copy.
function addCustomProduct(product: ProductSuggestion & { barcode?: string | null }) {
  customProductOpen.value = false
  pendingBarcode.value = ''
  void addItem({ ...product, custom: true } as AddedProduct)
}

function cancelCustomProduct() {
  customProductOpen.value = false
  pendingBarcode.value = ''
}

// ─── Scanning ────────────────────────────────────────────────────────────────
// A scan is a suggestion arrived at with the camera instead of the keyboard, so
// a hit takes selectSuggestion's path exactly and lands the same confirmation.
// Only the miss is new, and it is handed to the "add your own" modal that
// already exists for the typed version of the same problem.
//
// Two ways to obtain the code, one way to act on it. In the app that is Google's
// scanner: auto-zoom, and no camera permission of our own (see
// lib/barcodeScanner). In a browser, where that does not exist, it is our own
// camera screen. Everything from the code onwards — resolveScannedCode below —
// is shared, so the two differ only in how the barcode is read.

async function openScanner() {
  clearSuggestions()
  // Codes that missed are only remembered for the length of one scanning
  // session. Naming one makes it findable, so the next session must ask the
  // catalog again rather than trusting an answer from before it was told.
  unknownCodes.clear()
  scannedUnknown.value = ''

  if (nativeScanAvailable()) {
    const result = await scanWithNativeScanner()
    // Its UI is already gone by now: one scan, then it closes itself. Which is
    // why a miss goes straight to the naming dialog rather than to the row our
    // own screen shows — there is no screen left to show it on.
    if (result.ok) {
      if (result.code) await resolveScannedCode(result.code, 'native')
      return
    }
    // No Play Services, or the module would not install. Our own camera screen
    // is the fallback, and it reports its own failures if it cannot start
    // either.
  }

  scannerOpen.value = true
}

function closeScanner() {
  scannerOpen.value = false
  scanBusy.value = false
  scannedUnknown.value = ''
}

// What a barcode means, whichever scanner read it.
//
// `source` is not cosmetic: it decides where a miss goes, and whether the user
// can still walk away mid-lookup. Our own screen stays open and reads
// continuously, so it can be closed while a lookup is in flight and a miss has
// somewhere to be shown. The native scanner has already closed itself by the
// time we have a code, so neither is true of it.
async function resolveScannedCode(code: string, source: 'screen' | 'native') {
  const reportMiss = () => {
    unknownCodes.add(code)
    if (source === 'screen') scannedUnknown.value = code
    else nameUnknownBarcode(code)
  }

  // Already asked about, and the answer does not change within a session.
  // Re-asserting it rather than querying again is what stops a barcode lying in
  // front of our own camera from firing a lookup every couple of seconds.
  if (unknownCodes.has(code)) {
    reportMiss()
    return
  }

  scanBusy.value = true
  scannedUnknown.value = ''
  const product = await lookupBarcode(code)
  scanBusy.value = false
  // Left our camera screen while the lookup ran. Adding behind a screen they
  // have closed is not what they asked for.
  if (source === 'screen' && !scannerOpen.value) return

  if (product) {
    // The scan IS the add. It used to fill the form and hand the screen back so
    // the name and the quantity picker could be corrected before committing --
    // but the picker has moved onto the list row, and a barcode is an exact key,
    // so this was the one action in the app asking for a confirming tap while
    // tapping a fuzzy search result committed outright.
    //
    // Same call a tapped suggestion makes, so the maker rides onto the row by
    // the same route. The add form is not touched at all: writing the name into
    // it left the query sitting there afterwards, suppressing suggestions until
    // it was edited by hand.
    //
    // Then the screen goes, and the list behind it is the confirmation -- the row
    // is there with its own stepper on it. One code per scan, on both scanners:
    // ours could have kept reading and Google's could have been reopened, but a
    // camera that comes back on its own after every item is a thing to dismiss
    // rather than a thing to use.
    void addItem(product as AddedProduct)
    closeScanner()
    return
  }

  reportMiss()
}


// From our own camera screen, which reads continuously.
async function onBarcodeDetected(code: string) {
  if (!scannerOpen.value) return
  await resolveScannedCode(code, 'screen')
}

// Naming it is a detour off the camera, so the camera goes away: the item lands
// on the list, which is where the answer belongs and where the user ends up.
function nameUnknownBarcode(code: string) {
  pendingBarcode.value = code
  closeScanner()
  customProductOpen.value = true
}

// Back online: replay writes queued while offline, then re-fetch so local state
// converges on the server's. Reentrancy-safe: reconnect and Clerk-ready can both
// fire, and a trigger arriving mid-sync reruns once more so nothing is missed.
let syncInFlight = false
let syncAgain = false
async function handleBackOnline() {
  if (!hasInitialized.value || !effectiveUserId.value || !householdId.value) return
  if (syncInFlight) { syncAgain = true; return }
  syncInFlight = true
  try {
    do {
      syncAgain = false
      const { failed } = await ensureQueueFlushed()
      if (failed) loadError.value = 'Some changes made offline could not be synced.'
      await loadHouseholdHeader()
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

// hasInitialized is only set once the whole sequence below has finished, so it
// cannot keep a second run out while the first is still awaiting. Both entry
// points (onMounted and the Clerk watcher) can fire inside that window — a
// session resolving in another tab is enough — and two overlapping runs mean
// duplicate loadHouseholds/loadItems calls and two sets of realtime channels.
let initializing = false

async function initializeHome() {
  if (hasInitialized.value || initializing) return
  initializing = true
  try {
    await runInitializeHome()
  } finally {
    initializing = false
  }
}

async function runInitializeHome() {
  // Clerk has not confirmed the session yet. A remembered user with a cached
  // snapshot still gets painted right now rather than staring at skeletons for
  // the whole Clerk warm-up: the router already vetted us here, and this is the
  // stale half of stale-while-revalidate. Offline that paint is the entire boot,
  // so we mark ourselves initialized and let reconnection reconcile; online it
  // is just the first frame, and the watch above re-enters below once Clerk
  // resolves.
  if (!isLoaded.value || !userId.value) {
    const uid = effectiveUserId.value
    if (uid && loadHouseholdSnapshot(localStorage, uid)) {
      sanitizeAuthCallbackUrl()
      hydrateFromCachedSnapshot()
      if (isCurrentlyOffline()) hasInitialized.value = true
    }
    return
  }

  // Clerk resolved to someone other than the remembered user we painted for:
  // that list belongs to the previous account, so drop it before going on.
  if (hydratedUserId && hydratedUserId !== userId.value) discardCachedPaint()

  // Confirmed signed in: remember this user so a later offline open can boot.
  rememberUser(localStorage, userId.value)
  // Keep our profile row (name + Clerk avatar) current, so a changed photo shows
  // up across every household. Best-effort and non-blocking: boot must not wait on
  // it, and the next load reconciles if it fails.
  void upsertOwnProfile(db, userId.value, user.value)
  // Re-bind this device to the account in OneSignal. Signing out detaches it and
  // nothing used to put it back, so a device could stay subscribed while
  // belonging to nobody and silently receive nothing. No-op unless notifications
  // were actually turned on. See syncPushUser.
  void syncPushUser(userId.value, localStorage)
  sanitizeAuthCallbackUrl()
  hydrateFromCachedSnapshot()

  // Fetch every household the user belongs to (the account dialog lists them),
  // only once Clerk has finished loading.
  const { error: mErr } = await loadHouseholds()

  if (mErr) {
    // Offline with a cached snapshot already painted: run from local state and
    // let the reconnect handler flush queued writes and reconcile. Realtime is
    // still set up so its reconnect logic takes over once connectivity returns.
    // isOfflineError also catches the WebView case where navigator.onLine lies.
    if (isOfflineError(mErr) && householdId.value) {
      await setupRealtimeSubscriptions()
      hasInitialized.value = true
      return
    }
    loadError.value = isOfflineError(mErr)
      ? 'You appear to be offline. Check your connection and try again.'
      : 'Could not load your household.'
    return
  }

  if (!households.value.length) {
    clearHouseholdSnapshot(localStorage, effectiveUserId.value)
    clearActiveHouseholdId(localStorage)
    router.replace('/household-setup')
    return
  }

  // Restore the last active household if it is still one we belong to, else default
  // to the first; persist the choice so it survives reloads.
  const storedActiveId = loadActiveHouseholdId(localStorage, userId.value)
  const activeHousehold = households.value.find((f) => f.id === storedActiveId) || households.value[0]
  householdId.value = activeHousehold.id
  saveActiveHouseholdId(localStorage, effectiveUserId.value, activeHousehold.id)
  // Started here, the moment householdId exists, rather than after the three
  // awaits below. Not awaited either way — the list must paint without waiting on
  // a ranking signal, and until it lands suggestions just rank by the global
  // catalog order. But issued last it was the fourth serial round trip of boot,
  // and an empty list has nothing to say until it answers (emptyStateAnswerable).
  // Run alongside the others it is usually back before the items are.
  void loadHouseholdProductStats()
  // Writes queued during a previous offline session land before the first
  // fetch, so the list below already reflects them. No-op when the queue is empty.
  await flushOfflineQueue(localStorage, effectiveUserId.value, db)
  await loadHouseholdHeader()
  await loadItems()
  await setupRealtimeSubscriptions()
  hasInitialized.value = true
  persistSnapshot()
  // The update offer is not called here: it hangs off this sequence's onSettled,
  // so it lands after the tour and the notifications ask rather than racing them.
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
// Clears exactly what hydrateFromCachedSnapshot below sets — the two have to
// stay a matched pair, or a field the paint wrote survives into the next
// account. householdItemLimit and the cached shopping answer were the two that did:
// the previous user's item cap governed the add form until loadHouseholdHeader
// returned, and their shopping history decided whether a new user's empty list
// read "All bought" or "Nothing here yet".
function discardCachedPaint() {
  hydratedUserId = ''
  paintedFromCache.value = false
  items.value = []
  householdMembers.value = []
  householdId.value = ''
  householdName.value = ''
  householdInviteCode.value = ''
  householdOwnerId.value = ''
  householdItemLimit.value = ITEM_LIMIT_DEFAULT
  householdEmoji.value = ''
  cachedShoppedHouseholdId.value = ''
}

// Paint the last known state immediately (stale-while-revalidate): a returning
// user sees their list instead of skeletons while the fresh fetches above run.
function hydrateFromCachedSnapshot() {
  if (items.value.length) return
  const snapshot = loadHouseholdSnapshot(localStorage, effectiveUserId.value)
  if (!snapshot) return
  hydratedUserId = effectiveUserId.value
  paintedFromCache.value = true
  householdId.value = snapshot.householdId
  householdName.value = snapshot.householdName
  householdInviteCode.value = snapshot.householdInviteCode
  householdOwnerId.value = snapshot.householdOwnerId
  householdItemLimit.value = snapshot.householdItemLimit
  householdEmoji.value = snapshot.householdEmoji || ''
  householdMembers.value = snapshot.householdMembers
  items.value = snapshot.items
  // Offline there is no purchase history to read, so the cached answer is the
  // only one available. Without it an empty list tells a household that shops every
  // week they have never started.
  cachedShoppedHouseholdId.value = snapshot.hasShopped ? snapshot.householdId : ''
}

// Writing the snapshot means JSON-stringifying the whole list and handing it to
// localStorage, which is synchronous and blocks the main thread. The watcher
// below is deep, so a quantity bump fires it per change — during a checkout,
// once per row. Coalesce into one write on the next tick: nothing reads the
// snapshot until a future page load, so it only has to be right when the dust
// settles, not on every intermediate state.
let snapshotTimer: ReturnType<typeof setTimeout> | null = null

function schedulePersistSnapshot() {
  if (snapshotTimer) return
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null
    persistSnapshot()
  }, 0)
}

// Write now if a write is owed. Called on the way out, where "next tick" may
// never come.
function flushSnapshot() {
  if (!snapshotTimer) return
  clearTimeout(snapshotTimer)
  snapshotTimer = null
  persistSnapshot()
}

// Everything owed to somewhere durable when the app goes away. On a phone that
// is most of the time, and is exactly when the next cold boot depends on it.
//
// Two different kinds of debt, both deferred for the same reason (coalescing a
// burst) and both settled here. The snapshot goes to localStorage and is
// synchronous, so it always lands. A quantity write goes to the server and
// cannot be guaranteed — but issuing it now, rather than leaving it to a 300ms
// timer the page may not survive, is the difference between usually landing and
// never landing.
function flushPendingWork() {
  flushSnapshot()
  void flushQuantityWrites()
}

function flushPendingWorkIfHidden() {
  if (document.visibilityState === 'hidden') flushPendingWork()
}

function persistSnapshot() {
  if (!hasInitialized.value || !effectiveUserId.value || !householdId.value) return
  saveHouseholdSnapshot(localStorage, effectiveUserId.value, {
    householdId: householdId.value,
    householdName: householdName.value,
    householdInviteCode: householdInviteCode.value,
    householdOwnerId: householdOwnerId.value,
    householdItemLimit: householdItemLimit.value,
    householdEmoji: householdEmoji.value,
    householdMembers: householdMembers.value,
    items: items.value,
    hasShopped: hasShopped.value,
  })
}

// Keep the snapshot current as state changes (mutations, realtime events).
// Guarded by hasInitialized inside persistSnapshot, so hydration itself and
// partial init states are never written back.
watch(
  [items, householdMembers, householdName, householdInviteCode, householdItemLimit, householdEmoji],
  schedulePersistSnapshot,
  { deep: true },
)

function sanitizeAuthCallbackUrl() {
  const cleanedUrl = cleanAuthCallbackUrl(window.location.href)
  if (cleanedUrl) window.history.replaceState({}, '', cleanedUrl)
}

async function loadHouseholdHeader() {
  const [{ data: household, error: householdErr }, { data: members, error: membersErr }] = await Promise.all([
    db.from('households').select('name, invite_code, created_by, max_items_per_member, emoji').eq('id', householdId.value).single(),
    // Name/avatar live in profiles now; embed them so the roster keeps the same
    // { user_id, display_name, image_url, role } shape every consumer expects.
    db.from('household_members').select('user_id, role, profiles(display_name, image_url)').eq('household_id', householdId.value),
  ])

  // Neither failure reaches the screen, and that is deliberate: this runs from
  // the watchdog every 30 seconds while the socket is down, and a dialog per
  // tick over a header that is merely stale would be worse than the staleness.
  // But silence is not the same as ignoring it — dropped entirely, a household
  // read that has started failing (a revoked membership, a transient 500) leaves
  // a stale header up indefinitely with no trace anywhere. Offline is the
  // expected case and is not a fault.
  for (const err of [householdErr, membersErr]) {
    if (err && !isOfflineError(err)) captureException(err)
  }

  if (!householdErr && household) {
    householdName.value = household.name
    householdInviteCode.value = household.invite_code || ''
    householdOwnerId.value = household.created_by || ''
    householdItemLimit.value = clampItemLimit(household.max_items_per_member)
    householdEmoji.value = household.emoji || ''
  }

  if (!membersErr && Array.isArray(members)) {
    householdMembers.value = (members as unknown as MemberRow[]).map((m) => ({
      user_id: m.user_id,
      role: m.role,
      display_name: m.profiles?.display_name || m.user_id,
      image_url: m.profiles?.image_url || null,
    }))
  }
}

// A household setting changed (name, item limit, emoji): refresh the active household's
// header and the household list together, so a new name or emoji shows up
// everywhere right away rather than only after the next reload.
async function refreshHouseholdAfterSettingsChange() {
  await loadHouseholdHeader()
  await loadHouseholds()
}

// Every household the user belongs to, with names for the account dialog's list.
// Only refreshes the roster; the active household is chosen by the caller.
async function loadHouseholds() {
  const { data, error } = await db
    .from('household_members')
    .select('household_id, households(name, emoji)')
    .eq('user_id', userId.value)
  if (error) return { error }
  // A household row renders an emoji tile, a name and a marker, so that is all it
  // carries, and the embed brings all of it back in this one query. It used to
  // fetch every household's full roster here to draw composite member avatars;
  // those are gone, and so is the extra round trip.
  const list = ((data ?? []) as unknown as MembershipRow[]).map((row) => ({
    id: row.household_id,
    name: row.households?.name ?? '',
    emoji: row.households?.emoji ?? '',
  }))

  // Stable, name-ordered so the list never reshuffles between loads.
  households.value = list.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  return { error: null }
}

// Switch which household is active: persist the choice, tear down the old realtime
// channels, and reload everything scoped to the new household.
async function switchHousehold(id: string) {
  if (!id || id === householdId.value) return
  if (!households.value.some((f) => f.id === id)) return
  switchingHousehold.value = true
  householdId.value = id
  saveActiveHouseholdId(localStorage, effectiveUserId.value, id)
  cleanupRealtimeSubscriptions()
  // Drop the old household's data so none of it flashes under the new name.
  items.value = []
  // A filter belongs to the list it was chosen for. Carrying "Checked" into a
  // household whose cart is empty opens it on a blank list.
  listFilter.value = 'all'
  householdMembers.value = []
  // Everything the suggestions composable holds about the household being left,
  // cleared by the composable itself — it is the only thing that can see all of
  // it. See the note on resetForHousehold.
  resetForHousehold()
  boughtThisSession.value = false
  loadError.value = ''
  // Show the new name straight away (we already know it from the household list);
  // only the roster is unknown until loadHouseholdHeader returns, so that's all the
  // topbar skeletons.
  const next = households.value.find((f) => f.id === id)
  if (next) householdName.value = next.name
  // Alongside the two fetches below rather than after them, for the reason given
  // in runInitializeHome: the new household's empty list stays blank until this
  // answers, and issued last it answered a round trip after the skeleton came
  // down.
  void loadHouseholdProductStats()
  try {
    await loadHouseholdHeader()
    await loadItems()
  } finally {
    // The rows are on screen, so the skeleton has nothing left to stand in for.
    // Product stats and the realtime channel are background work; holding the
    // placeholder up behind a websocket handshake just delays the real list.
    switchingHousehold.value = false
  }
  await setupRealtimeSubscriptions()
}

// The account dialog's "join or create" action: the setup page handles both, and
// the guard allows it while under the household cap.
function openAddHousehold() {
  router.push({ name: 'household-setup', query: { add: '1' } })
}

// The active household vanished (deleted, left, or we were removed): move to another
// household we still belong to, or fall back to setup when none remain.
async function reconcileActiveHousehold() {
  const { error } = await loadHouseholds()
  // A failed lookup (network drop, transient server error) must not be read as
  // "no membership" and eject the user — leave them where they are.
  if (error) return
  if (households.value.some((f) => f.id === householdId.value)) return
  if (households.value.length) {
    await switchHousehold(households.value[0].id)
    return
  }
  cleanupRealtimeSubscriptions()
  clearHouseholdSnapshot(localStorage, effectiveUserId.value)
  clearActiveHouseholdId(localStorage)
  router.replace('/household-setup')
}


</script>

<template>
  <div class="dashboard">
    <AppTopbar
      :household-id="householdId || ''"
      :household-name="householdName"
      :households="households"
      :loading="initialLoading"
      :members-loading="switchingHousehold"
      :invite-code="householdInviteCode"
      :household-item-limit="householdItemLimit"
      :household-emoji="householdEmoji"
      :owner-user-id="householdOwnerId"
      :member-profiles="householdMembers"
      :current-user-id="effectiveUserId"
      @refresh-household="refreshHouseholdAfterSettingsChange"
      @switch-household="switchHousehold"
      @add-household="openAddHousehold"
      @household-deleted="reconcileActiveHousehold"
      @household-left="reconcileActiveHousehold"
    />

    <main class="dashboard-main">
      <div class="dashboard-content">

        <!-- Add item form -->
        <AddItemForm
          v-model:name="newItem"
          v-model:expanded="searchExpanded"
          :max-length="ITEM_NAME_MAX_LENGTH"
          :suggestions="suggestions"
          :recents="recentProducts"
          :last-added="lastAdded"
          :suggestions-loading="suggestionsLoading"
          :can-add-custom="canAddCustomProduct"
          :can-scan="canScan"
          @submit="addItem"
          @select="selectSuggestion"
          @add-custom="openCustomProduct"
          @scan="openScanner"
        />

        <ShoppingList
          :items="items"
          v-model:filter="listFilter"
          :member-profiles="memberProfileMap"
          :loading="listLoading"
          :show-empty="showEmptyState"
          :has-shopped="hasShopped"
          :suggested-products="restartProducts"
          :suggested-products-loading="restartProductsLoading"
          @add="selectSuggestion"
          @toggle="toggleItem"
          @delete="deleteItem"
          @set-quantity="setItemQuantity($event.item, $event.quantity)"
          @checkout="checkoutItems"
        />

      </div>
    </main>

    <ConfirmModal
      :open="limitReachedPopupOpen"
      title="Limit reached"
      :message="`You reached your limit of ${householdItemLimit} active items. Check or delete items before adding more.`"
      confirm-text="Got it"
      :show-cancel="false"
      @confirm="closeLimitReachedPopup"
      @cancel="closeLimitReachedPopup"
    />

    <!-- Mounted only once it has been asked for: it holds a camera, and the
         WebView should not be handed one on the way to a shopping list. -->
    <BarcodeScannerModal
      v-if="scannerOpen"
      :open="scannerOpen"
      :busy="scanBusy"
      :unknown-code="scannedUnknown"
      @detected="onBarcodeDetected"
      @name-unknown="nameUnknownBarcode"
      @close="closeScanner"
    />

    <CustomProductModal
      :open="customProductOpen"
      :initial-name="newItem"
      :name-max-length="ITEM_NAME_MAX_LENGTH"
      :initial-barcode="pendingBarcode"
      @submit="addCustomProduct"
      @cancel="cancelCustomProduct"
    />

    <OnboardingTour
      :open="onboardingTourOpen"
      :invite-code="householdInviteCode"
      @close="closeOnboardingTour"
    />

    <NotificationPromptModal
      :open="notificationPromptOpen"
      @accept="acceptNotifications"
      @decline="declineNotifications"
    />

    <UpdateAvailableModal
      :open="updateOpen"
      :phase="updatePhase"
      :version="updateVersion"
      :current-version="appVersion"
      :progress="updateProgress"
      @install="installUpdate"
      @later="dismissUpdate"
      @open-settings="openInstallSettings"
      @open-releases="openReleasesPage"
      @close="updateOpen = false"
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

