import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { watch } from 'vue'
import { useAuth } from '@clerk/vue'
import { ensureOnlineStatus } from '../lib/connectivity'

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
    path: '/family-setup',
    name: 'family-setup',
    component: () => import('../views/FamilySetupView.vue'),
    meta: { requiresAuth: true },
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

// A user can belong to at most this many families (migration 025). At the cap,
// the setup page has nothing to offer and redirects home; under it, the page is
// reachable so a user can join or create another family.
const FAMILY_MEMBERSHIP_CAP = 3

async function isAtFamilyCap(
  getToken: ReturnType<typeof useAuth>['getToken'],
  userId: ReturnType<typeof useAuth>['userId'],
) {
  try {
    const token = await getToken.value({ template: 'supabase' })
    if (!token || !userId.value) return false
    // Count only THIS user's memberships. RLS lets a member see every co-member
    // of their families, so without the user_id filter this would count other
    // people too and falsely report the cap once your families hold 3+ members.
    const resp = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/family_members` +
        `?select=family_id&user_id=eq.${encodeURIComponent(userId.value)}&limit=${FAMILY_MEMBERSHIP_CAP}`,
      {
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
        },
      },
    )
    if (!resp.ok) return false
    const data = await resp.json()
    return Array.isArray(data) && data.length >= FAMILY_MEMBERSHIP_CAP
  } catch {
    return false
  }
}

router.beforeEach(async (to) => {
  const { isLoaded, isSignedIn, getToken, userId } = useAuth()

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

  // Only the setup page needs a membership check in the guard: a user already at
  // the family cap has nowhere to add one, so send them home. Under the cap the
  // page stays reachable (a fresh user with none, or someone adding another).
  // Every other view resolves membership itself (HomeView redirects to setup
  // when there is none), so ordinary navigations skip this round-trip.
  if (to.name === 'family-setup' && isSignedIn.value) {
    if (await isAtFamilyCap(getToken, userId)) {
      return { name: 'home' }
    }
  }

  return true
})

export default router
