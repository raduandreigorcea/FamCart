// @vitest-environment happy-dom
//
// The snapshot cache exists so a returning user sees their real list instead of
// skeletons while Clerk and the first fetches warm up. That only ever worked
// offline: the online path returned before painting and left skeletons up for
// the whole Clerk warm-up, which is the common case. These pin the online
// behaviour, including the safety property that a paint made before Clerk
// confirms the session is dropped if it resolves to a different account.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import HomeView from '../src/views/HomeView.vue'
import ShoppingList from '../src/components/ShoppingList.vue'
import { createFakeDb } from './support/fakeSupabase.js'
import { saveFamilySnapshot } from '../src/lib/familyCache'
import { rememberUser } from '../src/lib/session'
import { markTourSeen } from '../src/lib/onboarding'
import { __setOnlineForTest } from '../src/lib/connectivity'

const mocks = vi.hoisted(() => ({ db: null, routerReplace: () => {}, userId: null, isLoaded: null }))

vi.mock('../src/supabase', () => ({ useSupabase: () => mocks.db }))
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: (...a) => mocks.routerReplace(...a) }),
}))
vi.mock('../src/lib/familyRealtime', () => ({
  useFamilyRealtime: () => ({
    realtimeHealthy: { value: false },
    setupRealtimeSubscriptions: async () => {},
    cleanupRealtimeSubscriptions: () => {},
  }),
}))

// Clerk starts unresolved, as it does on a real cold load. Tests drive it.
vi.mock('@clerk/vue', async () => {
  const { ref } = await import('vue')
  mocks.userId = ref(null)
  mocks.isLoaded = ref(false)
  return {
    useAuth: () => ({ userId: mocks.userId, isLoaded: mocks.isLoaded, getToken: ref(async () => 't') }),
    useUser: () => ({ user: ref(null) }),
  }
})

const snapshot = (items) => ({
  familyId: 'fam-1',
  familyName: 'Fam',
  familyInviteCode: 'ABCDEFGH',
  familyOwnerId: 'user-1',
  familyItemLimit: 50,
  familyEmoji: '🏠',
  familyMembers: [{ user_id: 'user-1', display_name: 'Me', image_url: null, role: 'moderator' }],
  items,
})

const cachedItem = {
  id: 'c1',
  family_id: 'fam-1',
  name: 'Milk',
  quantity: 1,
  checked: false,
  added_by: 'user-1',
  created_at: '2026-01-01T00:00:00.000Z',
}

const wrappers = []
function trackMount(...args) {
  const w = mount(...args)
  wrappers.push(w)
  return w
}

beforeEach(() => {
  localStorage.clear()
  markTourSeen(localStorage)
  mocks.db = createFakeDb()
  mocks.routerReplace = vi.fn()
  mocks.userId.value = null
  mocks.isLoaded.value = false
  __setOnlineForTest(true)
})

afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
  __setOnlineForTest(true)
  vi.restoreAllMocks()
})

describe('painting the cached list while Clerk warms up', () => {
  it('shows the cached list instead of skeletons when online', async () => {
    rememberUser(localStorage, 'user-1')
    saveFamilySnapshot(localStorage, 'user-1', snapshot([cachedItem]))

    const wrapper = trackMount(HomeView, { shallow: true })
    await flushPromises()

    const list = wrapper.findComponent(ShoppingList)
    expect(list.props('items')).toHaveLength(1)
    expect(list.props('items')[0].name).toBe('Milk')
    expect(list.props('loading')).toBe(false)
  })

  it('does not skeleton over a cached list that is legitimately empty', async () => {
    rememberUser(localStorage, 'user-1')
    saveFamilySnapshot(localStorage, 'user-1', snapshot([]))

    const wrapper = trackMount(HomeView, { shallow: true })
    await flushPromises()

    // Nothing to show, but "nothing" is a real answer we already have.
    expect(wrapper.findComponent(ShoppingList).props('loading')).toBe(false)
  })

  it('still skeletons when there is nothing cached to paint', async () => {
    rememberUser(localStorage, 'user-1')

    const wrapper = trackMount(HomeView, { shallow: true })
    await flushPromises()

    expect(wrapper.findComponent(ShoppingList).props('loading')).toBe(true)
  })

  it('drops the painted list when Clerk resolves to a different account', async () => {
    rememberUser(localStorage, 'user-1')
    saveFamilySnapshot(localStorage, 'user-1', snapshot([cachedItem]))

    const wrapper = trackMount(HomeView, { shallow: true })
    await flushPromises()
    expect(wrapper.findComponent(ShoppingList).props('items')).toHaveLength(1)

    // Somebody else's session resolves on this browser.
    mocks.userId.value = 'user-2'
    mocks.isLoaded.value = true
    await flushPromises()

    expect(wrapper.findComponent(ShoppingList).props('items')).toHaveLength(0)
  })

  it('keeps the painted list when Clerk resolves to the same account', async () => {
    rememberUser(localStorage, 'user-1')
    saveFamilySnapshot(localStorage, 'user-1', snapshot([cachedItem]))

    const wrapper = trackMount(HomeView, { shallow: true })
    await flushPromises()

    mocks.userId.value = 'user-1'
    mocks.isLoaded.value = true
    await flushPromises()

    expect(wrapper.findComponent(ShoppingList).props('items')).toHaveLength(1)
  })
})
