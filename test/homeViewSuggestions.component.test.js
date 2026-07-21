// @vitest-environment happy-dom
//
// The suggestion search's loading lifecycle. The skeleton has two failure modes
// that both look like bugs to a user: stopping too early (the dropdown offers
// "Can't find it?" while the search is still running) and never stopping at all
// (a request that was superseded, failed, or ran offline strands it spinning).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import HomeView from '../src/views/HomeView.vue'
import AddItemForm from '../src/components/AddItemForm.vue'
import { createFakeDb } from './support/fakeSupabase.js'
import { __setOnlineForTest } from '../src/lib/connectivity'

// Mirrors SUGGEST_DEBOUNCE_MS in HomeView.
const DEBOUNCE_MS = 300

const mocks = vi.hoisted(() => ({ db: null, routerReplace: () => {} }))

vi.mock('../src/supabase', () => ({ useSupabase: () => mocks.db }))

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: (...args) => mocks.routerReplace(...args) }),
}))

vi.mock('../src/lib/familyRealtime', () => ({
  useFamilyRealtime: () => ({
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

const CATALOG = [
  { name: 'Apa Plata 2L', maker: 'Dorna', popularity: 100 },
  { name: 'Apa Minerala 1.5L', maker: 'Perla Harghitei', popularity: 100 },
]

const mountedWrappers = []

async function mountHome() {
  mocks.db = createFakeDb()
  mocks.routerReplace = vi.fn()
  mocks.db.handlers['family_members.select'] = (q) =>
    q.filters.user_id
      ? { data: [{ family_id: 'fam-1', families: { id: 'fam-1', name: 'Fam' } }], error: null }
      : { data: [{ user_id: 'user-1', display_name: 'Test User', image_url: null, role: 'moderator' }], error: null }
  mocks.db.handlers['families.select'] = () => ({
    data: { name: 'Fam', invite_code: 'ABCDEFGH', created_by: 'user-1', max_items_per_member: 50 },
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

const form = (wrapper) => wrapper.findComponent(AddItemForm)
const loading = (wrapper) => form(wrapper).props('suggestionsLoading')

async function type(wrapper, text) {
  form(wrapper).vm.$emit('update:name', text)
  await wrapper.vm.$nextTick()
}

// Hands back a resolve() per in-flight catalog query, so responses can be
// settled out of order.
function deferCatalogQueries() {
  const pending = []
  mocks.db.handlers['product_catalog.select'] = () =>
    new Promise((resolve) => pending.push(resolve))
  return pending
}

const catalogQueries = () => mocks.db.calls.filter((c) => c.table === 'product_catalog')

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  localStorage.clear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  while (mountedWrappers.length) mountedWrappers.pop().unmount()
  __setOnlineForTest(true)
  vi.restoreAllMocks()
})

describe('suggestion loading state', () => {
  it('shows the skeleton from the first keystroke, before the debounce even fires', async () => {
    const wrapper = await mountHome()
    deferCatalogQueries()

    await type(wrapper, 'apa')

    // The debounce is time the user spends waiting too, so it counts as loading.
    expect(loading(wrapper)).toBe(true)
    expect(form(wrapper).props('suggestions')).toEqual([])
  })

  it('stops the skeleton and shows the matches once the search returns', async () => {
    const wrapper = await mountHome()
    const pending = deferCatalogQueries()

    await type(wrapper, 'apa')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(loading(wrapper)).toBe(true)

    pending[0]({ data: CATALOG, error: null })
    await flushPromises()

    expect(loading(wrapper)).toBe(false)
    expect(form(wrapper).props('suggestions').map((p) => p.name)).toEqual([
      'Apa Minerala 1.5L',
      'Apa Plata 2L',
    ])
  })

  it('drops the previous query matches the moment the query changes', async () => {
    const wrapper = await mountHome()
    const pending = deferCatalogQueries()

    await type(wrapper, 'apa')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    pending[0]({ data: CATALOG, error: null })
    await flushPromises()
    expect(form(wrapper).props('suggestions')).toHaveLength(2)

    await type(wrapper, 'apax')

    // Water is not the answer to "apax"; showing it while searching would be a
    // stale answer dressed as a fresh one.
    expect(form(wrapper).props('suggestions')).toEqual([])
    expect(loading(wrapper)).toBe(true)
  })

  it('leaves the skeleton running when a superseded response lands first', async () => {
    const wrapper = await mountHome()
    const pending = deferCatalogQueries()

    await type(wrapper, 'apa')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    await type(wrapper, 'apax')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(pending).toHaveLength(2)

    // The first query answers late. It must not stop the skeleton: its answer is
    // for a query the user has already moved past, and the live one is pending.
    pending[0]({ data: CATALOG, error: null })
    await flushPromises()

    expect(loading(wrapper)).toBe(true)
    expect(form(wrapper).props('suggestions')).toEqual([])

    // The live query settles the dropdown.
    pending[1]({ data: [CATALOG[0]], error: null })
    await flushPromises()

    expect(loading(wrapper)).toBe(false)
    expect(form(wrapper).props('suggestions').map((p) => p.name)).toEqual(['Apa Plata 2L'])
  })

  it('stops the skeleton when the query is cleared mid-search', async () => {
    const wrapper = await mountHome()
    deferCatalogQueries()

    await type(wrapper, 'apa')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(loading(wrapper)).toBe(true)

    await type(wrapper, '')

    expect(loading(wrapper)).toBe(false)
    expect(form(wrapper).props('suggestions')).toEqual([])
  })

  it('stops the skeleton when the search fails', async () => {
    const wrapper = await mountHome()
    mocks.db.handlers['product_catalog.select'] = () => ({ data: null, error: { message: 'boom' } })

    await type(wrapper, 'apa')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    await flushPromises()

    // A failed lookup means no matches — and the escape hatch, not a skeleton
    // spinning forever over an error the user never sees.
    expect(loading(wrapper)).toBe(false)
    expect(form(wrapper).props('suggestions')).toEqual([])
    expect(form(wrapper).props('canAddCustom')).toBe(true)
  })

  it('stops the skeleton offline instead of stranding it', async () => {
    const wrapper = await mountHome()
    deferCatalogQueries()
    __setOnlineForTest(false)

    await type(wrapper, 'apa')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    await flushPromises()

    expect(loading(wrapper)).toBe(false)
  })

  // The server is asked only once the typing stops. Every keystroke restarts the
  // debounce, so a burst costs one request rather than one per character.
  it('asks the server nothing until the typing pauses', async () => {
    const wrapper = await mountHome()
    deferCatalogQueries()

    // Four keystrokes at a brisk-but-ordinary 200ms apart: each gap is under the
    // debounce, so each one restarts it.
    await type(wrapper, 'ap')
    await vi.advanceTimersByTimeAsync(200)
    await type(wrapper, 'apa')
    await vi.advanceTimersByTimeAsync(200)
    await type(wrapper, 'apa p')
    await vi.advanceTimersByTimeAsync(200)
    await type(wrapper, 'apa pl')

    // 600ms of typing has passed — twice the debounce — and still nothing has
    // been asked, because the user never actually stopped. This is the whole
    // point: without the restart, this burst would have cost three requests.
    expect(catalogQueries()).toHaveLength(0)
    // ...though the skeleton is already running: waiting is waiting, whether the
    // request has left yet or not.
    expect(loading(wrapper)).toBe(true)

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    // One request for the whole burst, for the final query only.
    expect(catalogQueries()).toHaveLength(1)
    expect(catalogQueries()[0].filters['ilike:search_text']).toBe('%apa pl%')
  })

  it('searches again once typing resumes and pauses again', async () => {
    const wrapper = await mountHome()
    const pending = deferCatalogQueries()

    await type(wrapper, 'apa')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    pending[0]({ data: CATALOG, error: null })
    await flushPromises()
    expect(catalogQueries()).toHaveLength(1)

    await type(wrapper, 'apa plata')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    expect(catalogQueries()).toHaveLength(2)
    expect(catalogQueries()[1].filters['ilike:search_text']).toBe('%apa plata%')
  })

  it('never searches for a query too short to be worth one', async () => {
    const wrapper = await mountHome()
    deferCatalogQueries()

    await type(wrapper, 'a')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    await flushPromises()

    expect(loading(wrapper)).toBe(false)
    expect(mocks.db.calls.some((c) => c.table === 'product_catalog')).toBe(false)
  })
})
