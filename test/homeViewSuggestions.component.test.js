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
import { setLocale } from '../src/lib/i18n'

// Mirrors SUGGEST_DEBOUNCE_MS in HomeView.
const DEBOUNCE_MS = 300

const mocks = vi.hoisted(() => ({ db: null, routerReplace: () => {}, timeZone: undefined }))

// Only deviceTimeZone is faked; resolveRegion and the timezone table stay real,
// so these tests exercise the actual lookup rather than a restatement of it.
// Faking just this one function is what keeps the suite from depending on the
// clock settings of whatever machine runs it — this developer's box says
// Europe/Bucharest and CI says UTC, and a test that asserts "no market is sent"
// must not pass or fail on that difference.
vi.mock('../src/lib/region', async (importOriginal) => ({
  ...(await importOriginal()),
  deviceTimeZone: () => mocks.timeZone,
}))

vi.mock('../src/supabase', () => ({
  useSupabase: () => mocks.db,
  getCatalogSupabase: () => mocks.catalogDb ?? null,
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

const CATALOG = [
  { name: 'Apa Plata 2L', maker: 'Dorna', popularity: 100 },
  { name: 'Apa Minerala 1.5L', maker: 'Perla Harghitei', popularity: 100 },
]

const mountedWrappers = []

// `catalog` opts a test into the second Supabase project. Left out,
// getCatalogSupabase() returns null and the app runs on household products
// alone -- which is a supported state, not a broken one, and is what every
// other test in this file exercises.
async function mountHome({ history = [], items = [], catalog } = {}) {
  mocks.db = createFakeDb()
  mocks.catalogDb = null
  if (catalog) {
    mocks.catalogDb = createFakeDb()
    mocks.catalogDb.handlers['rpc.search_catalog'] = () =>
      typeof catalog === 'function' ? catalog() : { data: catalog, error: null }
  }
  mocks.routerReplace = vi.fn()
  mocks.db.handlers['household_members.select'] = (q) =>
    q.filters.user_id
      ? { data: [{ household_id: 'fam-1', households: { id: 'fam-1', name: 'Fam' } }], error: null }
      : { data: [{ user_id: 'user-1', display_name: 'Test User', image_url: null, role: 'moderator' }], error: null }
  mocks.db.handlers['households.select'] = () => ({
    data: { name: 'Fam', invite_code: 'ABCDEFGH', created_by: 'user-1', max_items_per_member: 50 },
    error: null,
  })
  mocks.db.handlers['shopping_list_items.select'] = (q) => ({
    data: items.filter((i) => i.checked === q.filters.checked),
    error: null,
  })
  mocks.db.handlers['purchase_history.select'] = () => ({ data: history, error: null })

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
  mocks.db.handlers['rpc.search_catalog'] = () =>
    new Promise((resolve) => pending.push(resolve))
  return pending
}

// The catalog is searched through the search_catalog RPC rather than a
// product_catalog select: one query, every word matched separately, and the
// household membership check done server-side. See 006_product_catalog.sql.
const catalogQueries = () =>
  mocks.db.calls.filter((c) => c.table === 'rpc' && c.op === 'search_catalog')

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  localStorage.clear()
  // No detectable market unless a test asks for one.
  mocks.timeZone = undefined
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
    mocks.db.handlers['rpc.search_catalog'] = () => ({ data: null, error: { message: 'boom' } })

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
    // The raw query goes to the server now; tokenizing and folding are the
    // RPC's job, so there is no pattern built here to assert on.
    expect(catalogQueries()[0].params.p_query).toBe('apa pl')
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
    expect(catalogQueries()[1].params.p_query).toBe('apa plata')
  })

  it('never searches for a query too short to be worth one', async () => {
    const wrapper = await mountHome()
    deferCatalogQueries()

    await type(wrapper, 'a')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    await flushPromises()

    expect(loading(wrapper)).toBe(false)
    expect(catalogQueries()).toHaveLength(0)
  })
})

// The catalog query is capped and ordered by GLOBAL popularity, so a big
// imported catalog can fill the pool with strangers and leave this household's own
// staple out of it entirely — and ranking can only reorder what it is handed.
describe('a household product the catalog pool left out', () => {
  // Six globally-popular products, none of them the one this household actually
  // buys. Enough to fill the dropdown on their own.
  const STRANGERS = [
    { name: 'Apa Minerala 1.5L', maker: 'Perla Harghitei', popularity: 950 },
    { name: 'Apa Minerala 2L', maker: 'Borsec', popularity: 940 },
    { name: 'Apa de Izvor 5L', maker: 'Aqua Carpatica', popularity: 930 },
    { name: 'Apa Tonica 250ml', maker: 'Schweppes', popularity: 920 },
    { name: 'Apa de Gura 500ml', maker: 'Listerine', popularity: 910 },
    { name: 'Apa Plata 6x0.5L', maker: 'Bucovina', popularity: 900 },
  ]

  const BOUGHT_HERE = [
    { name: 'Apa Plata 2L', maker: 'Dorna', purchased_at: '2026-07-20T10:00:00Z' },
    { name: 'Apa Plata 2L', maker: 'Dorna', purchased_at: '2026-07-24T10:00:00Z' },
  ]

  it('is suggested anyway, from history already in memory', async () => {
    const wrapper = await mountHome({ history: BOUGHT_HERE })
    const pending = deferCatalogQueries()

    await type(wrapper, 'apa')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    pending[0]({ data: STRANGERS, error: null })
    await flushPromises()

    const names = form(wrapper).props('suggestions').map((p) => p.name)
    // Bought here twice, and the pool never returned it — without the merge it
    // would be unreachable no matter how often this household buys it.
    expect(names[0]).toBe('Apa Plata 2L')
    expect(names).toHaveLength(6)
  })

  it('appears once, in the catalog spelling, when the pool did return it', async () => {
    const wrapper = await mountHome({ history: BOUGHT_HERE })
    const pending = deferCatalogQueries()

    await type(wrapper, 'apa')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    pending[0]({
      data: [{ name: 'Apa Plata 2L', maker: 'Dorna', popularity: 100 }, ...STRANGERS],
      error: null,
    })
    await flushPromises()

    const suggestions = form(wrapper).props('suggestions')
    expect(suggestions.filter((p) => p.name === 'Apa Plata 2L')).toHaveLength(1)
    // The catalog row wins the dedupe, so the real popularity survives rather
    // than the zero the history copy carries.
    expect(suggestions[0]).toMatchObject({ name: 'Apa Plata 2L', popularity: 100 })
  })

  it('leaves the dropdown alone for a household with no history', async () => {
    const wrapper = await mountHome()
    const pending = deferCatalogQueries()

    await type(wrapper, 'apa')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    pending[0]({ data: STRANGERS, error: null })
    await flushPromises()

    expect(form(wrapper).props('suggestions').map((p) => p.name)).toEqual(
      STRANGERS.map((p) => p.name),
    )
  })
})

// The regulars the search screen opens on before anything is typed. They exclude
// what is already on the list — a shortcut to something you have already got is
// not much of a shortcut — but that answer belongs to the moment the screen
// opened, not to every keystroke after it.
describe('the regulars offered before anything is typed', () => {
  const HISTORY = [
    { name: 'Lapte 1L', maker: 'Zuzu', purchased_at: '2026-08-01T10:00:00.000Z' },
    { name: 'Paine Alba', maker: null, purchased_at: '2026-08-02T10:00:00.000Z' },
  ]

  const recents = (wrapper) => form(wrapper).props('recents').map((p) => p.name)

  async function openSearch(wrapper) {
    form(wrapper).vm.$emit('update:expanded', true)
    await flushPromises()
  }

  async function pick(wrapper, product) {
    form(wrapper).vm.$emit('select', product)
    await flushPromises()
  }

  it('offers what the household buys', async () => {
    const wrapper = await mountHome({ history: HISTORY })
    await openSearch(wrapper)

    expect(recents(wrapper)).toContain('Lapte 1L')
    expect(recents(wrapper)).toContain('Paine Alba')
  })

  // The bug this pins. Reading the exclusion live meant the row you had just
  // tapped stopped qualifying and vanished from under your finger — which also
  // took away the tick marking it added, and the second tap that asks for a
  // second one.
  it('keeps a row in place after it has been tapped', async () => {
    mocks.db.handlers['shopping_list_items.insert'] = (q) => ({
      data: { ...q.payload, checked: false, created_at: '2026-08-03T00:00:00.000Z' },
      error: null,
    })
    const wrapper = await mountHome({ history: HISTORY })
    await openSearch(wrapper)

    await pick(wrapper, { name: 'Lapte 1L', maker: 'Zuzu' })

    expect(recents(wrapper)).toContain('Lapte 1L')
    expect(recents(wrapper)).toHaveLength(HISTORY.length)
  })

  // The exclusion still applies — it is only frozen, not dropped. A product
  // already on the list when the screen opens is not offered at all.
  it('leaves out what was already on the list when it opened', async () => {
    const wrapper = await mountHome({
      history: HISTORY,
      items: [
        {
          id: 'item-1',
          household_id: 'fam-1',
          name: 'Lapte 1L',
          maker: 'Zuzu',
          quantity: 1,
          checked: false,
          added_by: 'user-1',
          created_at: '2026-08-01T00:00:00.000Z',
        },
      ],
    })
    await openSearch(wrapper)

    expect(recents(wrapper)).not.toContain('Lapte 1L')
    expect(recents(wrapper)).toContain('Paine Alba')
  })
})


// ── The two-project split ────────────────────────────────────────────────────
// The global catalog is its own Supabase project, shared live by production and
// development; a household's contributed products and anything promoted out of
// them stay in the app database. So a full answer is the union of two searches,
// and the failure modes worth pinning are about what happens when only one of
// them answers.
describe('searching both catalogs', () => {
  const GLOBAL_ROWS = [{ name: 'Apa Plata 2L', maker: 'Dorna', popularity: 500 }]
  const LOCAL_ROWS = [{ name: 'Apa De La Bunica', maker: null, popularity: 2 }]

  function answerLocal(rows) {
    mocks.db.handlers['rpc.search_catalog'] = () => ({ data: rows, error: null })
  }

  it('offers products from both projects at once', async () => {
    const wrapper = await mountHome({ catalog: GLOBAL_ROWS })
    answerLocal(LOCAL_ROWS)

    await type(wrapper, 'apa')
    vi.advanceTimersByTime(DEBOUNCE_MS)
    await flushPromises()

    const names = form(wrapper).props('suggestions').map((p) => p.name)
    expect(names).toContain('Apa Plata 2L')
    expect(names).toContain('Apa De La Bunica')
  })

  it('shows a product present in both exactly once', async () => {
    // The same product can exist as an imported row in the catalog project and
    // as a promoted row in the app database -- the promotion rule runs entirely
    // in the app database and knows nothing about the import.
    const wrapper = await mountHome({ catalog: GLOBAL_ROWS })
    answerLocal([{ name: 'Apa Plata 2L', maker: 'Dorna', popularity: 3 }])

    await type(wrapper, 'apa')
    vi.advanceTimersByTime(DEBOUNCE_MS)
    await flushPromises()

    const names = form(wrapper).props('suggestions').map((p) => p.name)
    expect(names.filter((n) => n === 'Apa Plata 2L')).toHaveLength(1)
  })

  // The reason the merge uses allSettled rather than Promise.all. Production
  // search now depends on a third project being reachable, and an unreachable
  // one must cost only its own rows.
  it('still offers household products when the catalog project fails', async () => {
    const wrapper = await mountHome({
      catalog: () => ({ data: null, error: { message: 'unreachable' } }),
    })
    answerLocal(LOCAL_ROWS)

    await type(wrapper, 'apa')
    vi.advanceTimersByTime(DEBOUNCE_MS)
    await flushPromises()

    expect(form(wrapper).props('suggestions').map((p) => p.name)).toEqual(['Apa De La Bunica'])
    expect(loading(wrapper)).toBe(false)
  })

  it('still offers catalog products when the app database search fails', async () => {
    const wrapper = await mountHome({ catalog: GLOBAL_ROWS })
    mocks.db.handlers['rpc.search_catalog'] = () => ({ data: null, error: { message: 'boom' } })

    await type(wrapper, 'apa')
    vi.advanceTimersByTime(DEBOUNCE_MS)
    await flushPromises()

    expect(form(wrapper).props('suggestions').map((p) => p.name)).toEqual(['Apa Plata 2L'])
  })

  // A bump has to reach the database holding the row: the two projects carry
  // copies of the RPC with different signatures, and neither can touch the
  // other's rows.
  it('bumps popularity in the project the picked product came from', async () => {
    const wrapper = await mountHome({ catalog: GLOBAL_ROWS })
    answerLocal(LOCAL_ROWS)
    // The bump only fires once the add itself succeeded, so the insert needs an
    // answer here -- unhandled, the fake returns an error and nothing downstream
    // of the add runs at all.
    mocks.db.handlers['shopping_list_items.insert'] = (q) => ({
      data: { ...q.payload, checked: false },
      error: null,
    })

    await type(wrapper, 'apa')
    vi.advanceTimersByTime(DEBOUNCE_MS)
    await flushPromises()

    // Selecting a suggestion is the add: the form emits once and HomeView does
    // the rest. Same shape as the catalog-vs-contribution test in
    // homeViewCustomProduct.
    form(wrapper).vm.$emit('select', { name: 'Apa Plata 2L', maker: 'Dorna' })
    await flushPromises()

    const catalogBumps = mocks.catalogDb.calls.filter(
      (c) => c.table === 'rpc' && c.op === 'bump_product_popularity',
    )
    const localBumps = mocks.db.calls.filter(
      (c) => c.table === 'rpc' && c.op === 'bump_product_popularity',
    )
    expect(catalogBumps).toHaveLength(1)
    // The catalog's copy has no household to scope by, so it is not passed one.
    expect(catalogBumps[0].params.p_household_id).toBeUndefined()
    expect(localBumps).toHaveLength(0)
  })
})

// ── Scoping suggestions to where somebody shops ──────────────────────────────
// The catalog holds 191,394 products and 190,394 of them name a market. Until
// the app started sending one, a household in Romania ranked 37,008 French
// products against its own 9,011 Romanian ones on a popularity measured across
// all of Europe, and lost every time.
//
// What is pinned here is which project hears about it and in what form. The
// ORDERING itself belongs to search_catalog and is tested in the catalog
// project's pgTAP suite; these tests only prove the app asks the question.
describe('what the reference catalog is told about this person', () => {
  const catalogParams = () =>
    mocks.catalogDb.calls.find((c) => c.table === 'rpc' && c.op === 'search_catalog').params

  async function search(wrapper) {
    await type(wrapper, 'apa')
    vi.advanceTimersByTime(DEBOUNCE_MS)
    await flushPromises()
  }

  // The signal that replaced the Shopping Region picker, and the one that
  // matters more. p_markets says whether a product is on a nearby shelf;
  // p_langs says whether its name can be read at all, which is the question
  // somebody typing into a search box is really asking.
  it('sends the language the app is in', async () => {
    const wrapper = await mountHome({ catalog: CATALOG })

    await search(wrapper)

    expect(catalogParams().p_langs).toEqual(['en'])
  })

  it('follows a language switch on the very next search', async () => {
    const wrapper = await mountHome({ catalog: CATALOG })
    await setLocale('ro')

    await search(wrapper)

    expect(catalogParams().p_langs).toEqual(['ro'])
    await setLocale('en')
  })

  // Detected, never chosen. The picker that used to override this is gone, so
  // the timezone is the whole of the market signal now.
  it('sends the market the timezone implies', async () => {
    mocks.timeZone = 'Europe/Bucharest'
    const wrapper = await mountHome({ catalog: CATALOG })

    await search(wrapper)

    expect(catalogParams().p_markets).toEqual(['RO'])
  })

  // Omitted, not sent as null. PostgREST resolves an RPC by the argument names
  // in the request body, so leaving the key out is what keeps a no-market
  // search byte-identical to the one that shipped before this existed.
  it('omits the market entirely for a timezone the catalog does not cover', async () => {
    mocks.timeZone = 'Europe/Warsaw'
    const wrapper = await mountHome({ catalog: CATALOG })

    await search(wrapper)

    expect('p_markets' in catalogParams()).toBe(false)
    // The language still goes: not covering Poland says nothing about what the
    // person reads, and demoting nothing is the wrong answer to a missing zone.
    expect(catalogParams().p_langs).toEqual(['en'])
  })

  // The app database has no markets or name_lang column and wants none: its
  // rows are this household's own contributions plus the curated seed, and
  // nothing there should ever be demoted for being foreign. Sending either
  // argument would fail the call outright, since that function has neither
  // parameter.
  it('tells the app database neither', async () => {
    mocks.timeZone = 'Europe/Bucharest'
    const wrapper = await mountHome({ catalog: CATALOG })

    await search(wrapper)

    for (const call of catalogQueries()) {
      expect('p_markets' in call.params).toBe(false)
      expect('p_langs' in call.params).toBe(false)
    }
  })
})
