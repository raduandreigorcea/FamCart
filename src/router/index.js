import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@clerk/vue'

const routes = [
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

async function hasFamilyMembership(getToken) {
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

  // Give Clerk up to 3 seconds to load
  if (!isLoaded.value) {
    await new Promise((resolve) => {
      const stop = setInterval(() => {
        if (isLoaded.value) {
          clearInterval(stop)
          resolve()
        }
      }, 50)
      setTimeout(() => { clearInterval(stop); resolve() }, 3000)
    })
  }

  if (to.meta.requiresAuth && !isSignedIn.value) {
    return { name: 'login' }
  }

  if (to.meta.requiresGuest && isSignedIn.value) {
    return { name: 'home' }
  }

  // Signed-in users: check family membership
  if (isSignedIn.value) {
    const hasFamily = await hasFamilyMembership(getToken)

    // No family yet → send to setup (unless already there)
    if (!hasFamily && to.name !== 'family-setup') {
      return { name: 'family-setup' }
    }

    // Already has a family → don't let them revisit setup
    if (hasFamily && to.name === 'family-setup') {
      return { name: 'home' }
    }
  }

  return true
})

export default router
