// @vitest-environment happy-dom
//
// A brand-new account with no household lands on HomeView, because the router
// only pays for a membership lookup on the way to /household-setup. HomeView
// then discovers there is no household and replaces itself with onboarding.
// What it must NOT do in between is paint a list: the topbar and the shopping
// list skeleton describe a household this account does not have, so the very
// first thing a new user saw was a mock-up of somebody else's shopping list.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import HomeView from '../src/views/HomeView.vue'
import AppSplash from '../src/components/AppSplash.vue'
import AppTopbar from '../src/components/AppTopbar.vue'
import ShoppingList from '../src/components/ShoppingList.vue'
import { createFakeDb } from './support/fakeSupabase.js'
import { markTourSeen } from '../src/lib/onboarding'
import { __setOnlineForTest } from '../src/lib/connectivity'

const mocks = vi.hoisted(() => ({ db: null, routerReplace: () => {}, userId: null, isLoaded: null }))

vi.mock('../src/supabase', () => ({
  useSupabase: () => mocks.db,
  getCatalogSupabase: () => mocks.catalogDb ?? null,
}))
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: (...a) => mocks.routerReplace(...a), push: vi.fn() }),
}))
vi.mock('../src/lib/householdRealtime', () => ({
  useHouseholdRealtime: () => ({
    realtimeHealthy: { value: false },
    setupRealtimeSubscriptions: async () => {},
    cleanupRealtimeSubscriptions: () => {},
  }),
}))

vi.mock('@clerk/vue', async () => {
  const { ref } = await import('vue')
  mocks.userId = ref('user-new')
  mocks.isLoaded = ref(true)
  return {
    useAuth: () => ({ userId: mocks.userId, isLoaded: mocks.isLoaded, getToken: ref(async () => 't') }),
    useUser: () => ({ user: ref(null) }),
  }
})

const wrappers = []
function trackMount(...args) {
  const w = mount(...args)
  wrappers.push(w)
  return w
}

// The membership lookup answers, and answers "none" — the shape of a fresh
// account. Deferred so the test can look at the screen while it is in flight.
function seedNoHouseholds(db) {
  db.handlers['profiles.upsert'] = () => ({ data: null, error: null })
  let release
  const gate = new Promise((r) => { release = r })
  db.handlers['household_members.select'] = async () => {
    await gate
    return { data: [], error: null }
  }
  return release
}

beforeEach(() => {
  localStorage.clear()
  markTourSeen(localStorage)
  mocks.db = createFakeDb()
  mocks.routerReplace = vi.fn()
  mocks.userId.value = 'user-new'
  mocks.isLoaded.value = true
  __setOnlineForTest(true)
})

afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
  __setOnlineForTest(true)
  vi.restoreAllMocks()
})

describe('booting an account that has no household yet', () => {
  it('shows no list while it is still unknown whether there is one', async () => {
    const release = seedNoHouseholds(mocks.db)

    const wrapper = trackMount(HomeView, { shallow: true })
    await flushPromises()

    expect(wrapper.findComponent(AppSplash).exists()).toBe(true)
    expect(wrapper.findComponent(ShoppingList).exists()).toBe(false)
    expect(wrapper.findComponent(AppTopbar).exists()).toBe(false)

    release()
    await flushPromises()
    expect(mocks.routerReplace).toHaveBeenCalledWith('/household-setup')
  })

  it('draws the list the moment a household is known, skeletons and all', async () => {
    mocks.db.handlers['profiles.upsert'] = () => ({ data: null, error: null })
    mocks.db.handlers['household_members.select'] = (q) =>
      q.filters.user_id
        ? { data: [{ household_id: 'fam-1', households: { name: 'Gorcea', emoji: '🏠' } }], error: null }
        : { data: [], error: null }
    mocks.db.handlers['households.select'] = () => ({
      data: { name: 'Gorcea', invite_code: 'ABCD2345', created_by: 'user-new', max_items_per_member: 50, emoji: '🏠' },
      error: null,
    })
    mocks.db.handlers['shopping_list_items.select'] = () => ({ data: [], error: null })
    mocks.db.handlers['purchase_history.select'] = () => ({ data: [], error: null })

    const wrapper = trackMount(HomeView, { shallow: true })
    await flushPromises()

    expect(wrapper.findComponent(AppSplash).exists()).toBe(false)
    expect(wrapper.findComponent(ShoppingList).exists()).toBe(true)
  })
})
