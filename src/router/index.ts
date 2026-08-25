import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { watch } from 'vue'
import { useAuth } from '@clerk/vue'
import { ensureOnlineStatus } from '../lib/connectivity'
import { HOUSEHOLD_MEMBERSHIP_CAP } from '../lib/limits'
import { getSupabase, setSupabaseTokenResolver } from '../supabase'
import { whenLocaleReady } from '../lib/i18n'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('../views/HomeView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/LoginView.vue'),
    meta: { requiresGuest: true },
  },
  {
    path: '/household-setup',
    name: 'household-setup',
    component: () => import('../views/HouseholdSetupView.vue'),
    meta: { requiresAuth: true },
  },
  {
    // This route was /family-setup until the households rename. It is the URL a
    // half-finished signup sits on, so someone who was mid-flow across the
    // deploy — or who bookmarked it, or has it in a PWA shortcut — would
    // otherwise return to a dead address. The query string carries `add=1`, so
    // it is forwarded rather than dropped.
    path: '/family-setup',
    redirect: (to) => ({ name: 'household-setup', query: to.query }),
  },
  {
    path: '/sso-callback',
    name: 'sso-callback',
    component: () => import('../views/SSOCallbackView.vue'),
  },
  {
    // Opened in the phone's system browser, not the app: forwards the OAuth
    // result to the native app's famcart:// deep link (see nativeOAuth.ts).
    path: '/sso-native',
    name: 'sso-native',
    component: () => import('../views/SSONativeCallbackView.vue'),
  },
  {
    path: '/offline',
    name: 'offline',
    component: () => import('../views/OfflineView.vue'),
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

const CLERK_LOAD_TIMEOUT_MS = 6000

// Resolves as soon as Clerk finishes loading. The timeout only exists so
// navigation is never blocked forever (e.g. Clerk's script unreachable);
// on a slow connection the watcher fires the moment loading completes.
function waitForClerkLoad(isClerkLoaded: () => boolean): Promise<void> {
  if (isClerkLoaded()) return Promise.resolve()
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const stop = watch(isClerkLoaded, (loaded) => {
      if (!loaded) return
      if (timer !== null) clearTimeout(timer)
      stop()
      resolve()
    })
    timer = setTimeout(() => {
      stop()
      resolve()
    }, CLERK_LOAD_TIMEOUT_MS)
  })
}

// How many households this user belongs to, capped at the membership limit — enough
// to answer both "brand-new user with none" and "already at the cap". On any error
// we return 0 so the guard fails open: better to let a genuine new user reach setup
// than to strand them, and a member who slips through only sees a page that can do
// no harm.
//
// This used to hand-build the PostgREST URL and attach its own apikey and
// Authorization headers, because useSupabase() needs a component context the
// guard does not have. It now goes through the same client as everything else,
// which means it also gets fetchWithRetry — the guard runs on cold start, which
// is exactly when the first request tends to go out on a dead socket.
async function fetchMembershipCount(
  getToken: ReturnType<typeof useAuth>['getToken'],
  userId: ReturnType<typeof useAuth>['userId'],
): Promise<number> {
  try {
    if (!userId.value) return 0
    // The guard can run before any component has installed a resolver, so it
    // installs one from the Clerk instance it already holds. The plain session
    // token, matching useSupabase() -- see the comment there for why the
    // `supabase` JWT template is not used.
    setSupabaseTokenResolver(async () => getToken.value())
    // Count only THIS user's memberships. RLS lets a member see every co-member
    // of their households, so without the user_id filter this would count other
    // people too and falsely report the cap once your households hold 3+ members.
    const { data, error } = await getSupabase()
      .from('household_members')
      .select('household_id')
      .eq('user_id', userId.value)
      .limit(HOUSEHOLD_MEMBERSHIP_CAP)
    if (error) return 0
    return Array.isArray(data) ? data.length : 0
  } catch {
    return 0
  }
}

router.beforeEach(async (to) => {
  // useAuth() STAYS THE FIRST STATEMENT. It resolves the Clerk plugin through
  // Vue's inject(), which only works inside the synchronous window the router
  // holds the app context open for — the first `await` in this function throws
  // that context away. Putting anything awaited above this line does not delay
  // it, it breaks it: "useAuth can only be used when the Vue plugin is
  // installed", the guard rejects, and the app never leaves AppSplash.
  const { isLoaded, isSignedIn, getToken, userId } = useAuth()

  // Now the awaits are safe. The language catalog goes first among them, so no
  // view can render against the wrong one: main.ts starts that fetch pre-mount
  // and deliberately does not wait, and this is where the waiting happens,
  // behind the splash that is already on screen. Resolves immediately for
  // English and on every navigation after the first.
  await whenLocaleReady()

  // Decide connectivity first. Offline, Clerk can never verify the session, so
  // we must NOT wait on it (that 10s wait was the blank screen). A cold start
  // with no connection always goes to the offline screen — we deliberately do
  // NOT boot into a cached list. Offline editing is only supported once a
  // session is established online: a queue flushed before Clerk re-authenticates
  // is rejected by the server and dropped, silently losing the user's writes.
  // OfflineView retries and hands back to this guard, landing on the real list.
  const online = await ensureOnlineStatus()
  if (!online) {
    return to.name === 'offline' ? true : { name: 'offline' }
  }

  await waitForClerkLoad(() => isLoaded.value)

  // Clerk never loaded within the timeout — almost always a dead network that
  // getStatus didn't flag. Treat it like being offline (show the offline screen)
  // rather than a misleading bounce to a login that also can't work.
  if (!isLoaded.value) {
    return to.name === 'offline' ? true : { name: 'offline' }
  }

  // Back online while sitting on the offline screen: send them where they belong.
  if (to.name === 'offline') {
    return isSignedIn.value ? { name: 'home' } : { name: 'login' }
  }

  if (to.meta.requiresAuth && !isSignedIn.value) {
    return { name: 'login' }
  }

  if (to.meta.requiresGuest && isSignedIn.value) {
    return { name: 'home' }
  }

  // Guard the setup page by membership. A plain visit is meant only for a
  // brand-new user with no household, so anyone already in one is sent home — the
  // welcome/create flow isn't theirs to see again. `?add=1` (the account dialog's "join
  // or create a household" action) is the deliberate exception: it stays reachable until the
  // user hits the cap, where there is nothing left to add. Other views resolve
  // membership themselves (HomeView redirects to setup when there is none), so
  // ordinary navigations skip this round-trip.
  if (to.name === 'household-setup' && isSignedIn.value) {
    const memberships = await fetchMembershipCount(getToken, userId)
    const isAddingHousehold = to.query.add === '1'
    if (isAddingHousehold ? memberships >= HOUSEHOLD_MEMBERSHIP_CAP : memberships >= 1) {
      return { name: 'home' }
    }
  }

  return true
})

export default router
