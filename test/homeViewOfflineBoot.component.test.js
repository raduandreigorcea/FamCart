// @vitest-environment happy-dom
//
// Safety net: the session drops right after the router (while online) allowed us
// into home, but before Clerk finished loading (userId null, isLoaded false). A
// remembered user with a cached snapshot must still keep their list on screen —
// not a blank screen or a login page. A *cold* start with no connection never
// reaches here: the router sends it to OfflineView instead.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mount } from '@vue/test-utils'
import HomeView from '../src/views/HomeView.vue'
import ShoppingList from '../src/components/ShoppingList.vue'
import ErrorModal from '../src/components/ErrorModal.vue'
import { createFakeDb } from './support/fakeSupabase.js'
import { saveFamilySnapshot } from '../src/lib/familyCache'
import { rememberUser } from '../src/lib/session'
import { __setOnlineForTest } from '../src/lib/connectivity'

const mocks = vi.hoisted(() => ({ db: null, routerReplace: () => {} }))

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

// Clerk not loaded: the offline case where the session can't be verified.
vi.mock('@clerk/vue', async () => {
  const { ref } = await import('vue')
  return {
    useAuth: () => ({ userId: ref(null), isLoaded: ref(false), getToken: ref(async () => null) }),
    useUser: () => ({ user: ref(null) }),
  }
})

const wrappers = []
function trackMount(...args) {
  const w = mount(...args)
  wrappers.push(w)
  return w
}

beforeEach(() => {
  localStorage.clear()
  mocks.db = createFakeDb() // every query rejects (no handlers) — we're offline
  mocks.routerReplace = vi.fn()
})

afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
  __setOnlineForTest(true)
  vi.restoreAllMocks()
})

describe('offline boot with a cached session', () => {
  it('renders the cached list without redirecting to login or showing an error', async () => {
    rememberUser(localStorage, 'user-1')
    saveFamilySnapshot(localStorage, 'user-1', {
      familyId: 'fam-1',
      familyName: 'Fam',
      familyInviteCode: 'ABCDEFGH',
      familyOwnerId: 'user-1',
      familyItemLimit: 50,
      familyMembers: [{ user_id: 'user-1', display_name: 'Me', image_url: null, role: 'moderator' }],
      items: [
        { id: 'c1', family_id: 'fam-1', name: 'Milk', quantity: 1, checked: false, added_by: 'user-1', created_at: '2026-01-01T00:00:00.000Z' },
      ],
    })
    __setOnlineForTest(false)

    const wrapper = trackMount(HomeView, { shallow: true })
    await flushPromises()

    const items = wrapper.findComponent(ShoppingList).props('items')
    expect(items).toHaveLength(1)
    expect(items[0].name).toBe('Milk')
    expect(mocks.routerReplace).not.toHaveBeenCalled()
    expect(wrapper.findAllComponents(ErrorModal).some((m) => m.props('message'))).toBe(false)
  })

  it('does not boot into a stale list when there is no cached snapshot', async () => {
    rememberUser(localStorage, 'user-1')
    __setOnlineForTest(false)

    const wrapper = trackMount(HomeView, { shallow: true })
    await flushPromises()

    // Nothing to show and nothing to redirect to offline — just an empty,
    // non-erroring shell that reconciles once back online.
    expect(wrapper.findComponent(ShoppingList).props('items')).toHaveLength(0)
    expect(mocks.routerReplace).not.toHaveBeenCalled()
  })
})
