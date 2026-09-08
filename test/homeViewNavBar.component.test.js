// @vitest-environment happy-dom
//
// HomeView and the bottom action bar, which on a phone is the only chrome the
// list screen has.
//
// Its own file because it pins WIRING rather than behaviour, and the wiring is
// the part with no visible failure. appNavBarBar covers the bar emitting `add`;
// addItemForm covers the sheet opening when its model goes true. Between the two
// sits one attribute in HomeView's template, and nothing was watching it: delete
// `@add="searchExpanded = true"` and the only way to add an item on a phone
// stops working with the whole suite still green.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import HomeView from '../src/views/HomeView.vue'
import AppNavBar from '../src/components/AppNavBar.vue'
import AddItemForm from '../src/components/AddItemForm.vue'
import { createFakeDb } from './support/fakeSupabase.js'
import { __setOnlineForTest } from '../src/lib/connectivity'

const mocks = vi.hoisted(() => ({ db: null, routerReplace: () => {} }))

vi.mock('../src/supabase', () => ({
  useSupabase: () => mocks.db,
  getCatalogSupabase: () => null,
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: (...args) => mocks.routerReplace(...args) }),
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
  return {
    useAuth: () => ({
      userId: ref('user-1'),
      isLoaded: ref(true),
      getToken: ref(async () => 'token'),
    }),
    useUser: () => ({ user: ref({ fullName: 'Test User', imageUrl: null }) }),
  }
})

const mountedWrappers = []

async function mountHome() {
  mocks.db = createFakeDb()
  mocks.routerReplace = vi.fn()
  mocks.db.handlers['household_members.select'] = (q) =>
    q.filters.user_id
      ? { data: [{ household_id: 'fam-1', households: { id: 'fam-1', name: 'Fam' } }], error: null }
      : {
          data: [
            { user_id: 'user-1', display_name: 'Test User', image_url: null, role: 'moderator' },
          ],
          error: null,
        }
  mocks.db.handlers['households.select'] = () => ({
    data: {
      name: 'Fam',
      invite_code: 'ABCDEFGH',
      created_by: 'user-1',
      max_items_per_member: 50,
      emoji: '\u{1F3E1}',
    },
    error: null,
  })
  mocks.db.handlers['shopping_list_items.select'] = () => ({ data: [], error: null })
  mocks.db.handlers['purchase_history.select'] = () => ({ data: [], error: null })

  const wrapper = mount(HomeView, { shallow: true })
  mountedWrappers.push(wrapper)
  await flushPromises()
  await flushPromises()
  return wrapper
}

const bar = (wrapper) => wrapper.findComponent(AppNavBar)
const form = (wrapper) => wrapper.findComponent(AddItemForm)

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  localStorage.clear()
})

afterEach(() => {
  while (mountedWrappers.length) mountedWrappers.pop().unmount()
  __setOnlineForTest(true)
  vi.restoreAllMocks()
})

describe('HomeView and the action bar', () => {
  // The bar shell, not the header one. HouseholdSetupView renders the same
  // component with the default and must not get a bar; this is the other half
  // of that contract.
  it('asks for the bar shell, not the header', async () => {
    const wrapper = await mountHome()

    expect(bar(wrapper).props('layout')).toBe('bar')
  })

  it('opens the search when the bar says its centre button was pressed', async () => {
    const wrapper = await mountHome()
    expect(form(wrapper).props('expanded')).toBe(false)

    bar(wrapper).vm.$emit('add')
    await wrapper.vm.$nextTick()

    expect(form(wrapper).props('expanded')).toBe(true)
  })

  // The form owns closing (back button, Escape, Android Back) and reports it
  // through the model. If HomeView stopped listening to that, the search would
  // open once and the bar could never raise it again.
  it('takes the search back down when the form reports it closed', async () => {
    const wrapper = await mountHome()
    bar(wrapper).vm.$emit('add')
    await wrapper.vm.$nextTick()
    expect(form(wrapper).props('expanded')).toBe(true)

    form(wrapper).vm.$emit('update:expanded', false)
    await wrapper.vm.$nextTick()

    expect(form(wrapper).props('expanded')).toBe(false)

    // And the bar can raise it again, which is the whole reason the model goes
    // false the moment it is dismissed rather than when the exit finishes.
    bar(wrapper).vm.$emit('add')
    await wrapper.vm.$nextTick()
    expect(form(wrapper).props('expanded')).toBe(true)
  })

  // The emoji is what the bar's first slot draws, and it identifies WHICH
  // household. It reaches the bar as a prop, so a rename on either side is
  // silent without this.
  it('hands the bar the household it is about', async () => {
    const wrapper = await mountHome()

    expect(bar(wrapper).props('householdName')).toBe('Fam')
    expect(bar(wrapper).props('householdEmoji')).toBe('\u{1F3E1}')
  })
})
