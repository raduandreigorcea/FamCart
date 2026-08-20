// @vitest-environment happy-dom
//
// The household emoji arrived in 003_households_and_members.sql, but the client kept reading it
// through two "the column might not be migrated yet" fallbacks: a second
// `households` select per loadHouseholdHeader(), and an UNFILTERED `households` select
// per loadHouseholds(). loadHouseholdHeader runs on init, on focus, on reconnect, on
// every realtime household/member event and on every 30s watchdog tick while the
// socket is down — so the spare round trip was paid over and over for a column
// that has been there all along.
//
// These pin the query shape rather than the feature: the emoji still has to
// arrive, and it has to arrive inside the queries that were already being made.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import HomeView from '../src/views/HomeView.vue'
import AppTopbar from '../src/components/AppTopbar.vue'
import { createFakeDb } from './support/fakeSupabase.js'
import { markTourSeen } from '../src/lib/onboarding'
import { __setOnlineForTest } from '../src/lib/connectivity'

const mocks = vi.hoisted(() => ({ db: null, userId: null, isLoaded: null }))

vi.mock('../src/supabase', () => ({
  useSupabase: () => mocks.db,
  getCatalogSupabase: () => mocks.catalogDb ?? null,
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }))
vi.mock('../src/lib/householdRealtime', () => ({
  useHouseholdRealtime: () => ({
    realtimeHealthy: { value: false },
    setupRealtimeSubscriptions: async () => {},
    cleanupRealtimeSubscriptions: () => {},
  }),
}))

vi.mock('@clerk/vue', async () => {
  const { ref } = await import('vue')
  mocks.userId = ref('user-1')
  mocks.isLoaded = ref(true)
  return {
    useAuth: () => ({ userId: mocks.userId, isLoaded: mocks.isLoaded, getToken: ref(async () => 't') }),
    useUser: () => ({ user: ref(null) }),
  }
})

const wrappers = []

// One household, carrying an emoji, reachable only through the queries the view is
// allowed to make.
function seedHandlers(db) {
  db.handlers['profiles.upsert'] = () => ({ data: null, error: null })
  db.handlers['household_members.select'] = (q) =>
    q.filters.user_id
      ? // loadHouseholds: the membership list, with the household embedded.
        { data: [{ household_id: 'fam-1', households: { name: 'Gorcea', emoji: '🏠' } }], error: null }
      : // loadHouseholdHeader: the roster for the active household.
        { data: [{ user_id: 'user-1', role: 'moderator', profiles: { display_name: 'Radu' } }], error: null }
  db.handlers['households.select'] = () => ({
    data: {
      name: 'Gorcea',
      invite_code: 'ABCD2345',
      created_by: 'user-1',
      max_items_per_member: 50,
      emoji: '🏠',
    },
    error: null,
  })
  db.handlers['shopping_list_items.select'] = () => ({ data: [], error: null })
  db.handlers['purchase_history.select'] = () => ({ data: [], error: null })
}

const householdSelects = (db) => db.calls.filter((c) => c.table === 'households' && c.op === 'select')

beforeEach(() => {
  localStorage.clear()
  markTourSeen(localStorage)
  mocks.db = createFakeDb()
  seedHandlers(mocks.db)
  mocks.userId.value = 'user-1'
  mocks.isLoaded.value = true
  __setOnlineForTest(true)
})

afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
  vi.restoreAllMocks()
})

async function bootHome() {
  const wrapper = mount(HomeView, { shallow: true })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

describe('the household header and switcher queries', () => {
  it('reads the active household exactly once, emoji included', async () => {
    const db = mocks.db
    await bootHome()

    const selects = householdSelects(db)
    expect(selects).toHaveLength(1)
    expect(selects[0].columns).toContain('emoji')
  })

  it('never selects households unfiltered', async () => {
    const db = mocks.db
    await bootHome()

    // An unfiltered select leans entirely on RLS to scope the result; every
    // read here names the household it wants.
    for (const call of householdSelects(db)) {
      expect(call.filters.id).toBeTruthy()
    }
  })

  it('brings the switcher emoji back through the membership embed', async () => {
    const db = mocks.db
    await bootHome()

    const membership = db.calls.find(
      (c) => c.table === 'household_members' && c.op === 'select' && c.filters.user_id,
    )
    expect(membership.columns).toBe('household_id, households(name, emoji)')
  })

  it('still surfaces the emoji to the topbar', async () => {
    const wrapper = await bootHome()

    const topbar = wrapper.findComponent(AppTopbar)
    expect(topbar.props('householdEmoji')).toBe('🏠')
    expect(topbar.props('households')[0].emoji).toBe('🏠')
  })
})
