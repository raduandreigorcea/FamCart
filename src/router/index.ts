import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { watch } from 'vue'
import { useAuth } from '@clerk/vue'

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
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

const CLERK_LOAD_TIMEOUT_MS = 10000

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

async function hasFamilyMembership(getToken: ReturnType<typeof useAuth>['getToken']) {
  try {
    const token = await getToken.value({ template: 'supabase' })
    if (!token) return false
    const resp = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/family_members?select=family_id&limit=1`,
      {
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
        },
      },
    )
    if (!resp.ok) return false
    const data = await resp.json()
    return Array.isArray(data) && data.length > 0
  } catch {
    return false
  }
}

router.beforeEach(async (to) => {
  const { isLoaded, isSignedIn, getToken } = useAuth()

  await waitForClerkLoad(() => isLoaded.value)

  if (to.meta.requiresAuth && !isSignedIn.value) {
    return { name: 'login' }
  }

  if (to.meta.requiresGuest && isSignedIn.value) {
    return { name: 'home' }
  }

  // Only the setup page needs a membership check in the guard: a user who
  // already has a family must not create or join a second one. Every other
  // view resolves membership itself (HomeView redirects to setup when there
  // is none), so ordinary navigations skip this network round-trip.
  if (to.name === 'family-setup' && isSignedIn.value) {
    if (await hasFamilyMembership(getToken)) {
      return { name: 'home' }
    }
  }

  return true
})

export default router
