// @vitest-environment happy-dom
//
// The cold search, wired into the add-item box.
//
// `search_catalog` answers almost every keystroke out of rows that already
// exist. When it cannot, the composable asks the `discover` edge function to go
// and find the product, and appends whatever comes back. That is the whole
// growth mechanism of the catalog (spec §24), and three things about it are easy
// to break without any test noticing:
//
//   1. IT MUST NOT ASK WHEN THE LOCAL ANSWER WAS GOOD. Every unnecessary call is
//      an outbound request per keystroke, against a third-party database.
//   2. IT MUST NOT DELAY OR REPLACE THE LOCAL ANSWER. Rows already on screen
//      keep their place; discoveries fill the room that is left.
//   3. A LATE ANSWER MUST NOT LAND. This resolves seconds after the keystroke
//      that started it — far longer than the local search — so the dropdown has
//      usually moved on. A stale discovery would show products for a word the
//      person has finished deleting.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createFakeDb } from './support/fakeSupabase.js'

const mocks = vi.hoisted(() => ({
  catalogDb: null,
  discover: null,
}))

// The catalog project's client. Null is a supported state everywhere else in
// this file's subject, so it is set explicitly per test.
vi.mock('../src/supabase', () => ({
  getCatalogSupabase: () => mocks.catalogDb,
}))

vi.mock('../src/lib/catalogDiscovery', async (importOriginal) => ({
  ...(await importOriginal()),
  // The delay is real in production and pointless here: the guards are what is
  // under test, not setTimeout.
  DISCOVER_DELAY_MS: 0,
  discoverProducts: (...args) => mocks.discover(...args),
}))

const { useProductSuggestions } = await import('../src/lib/productSuggestions')

let db
let catalogRows

function mountSuggestions(query, { region = () => 'RO', locale = () => 'ro' } = {}) {
  let api
  const Harness = defineComponent({
    setup() {
      api = useProductSuggestions({
        db,
        householdId: ref('hh-1'),
        items: ref([]),
        query,
        isOffline: () => false,
        region,
        locale,
      })
      return () => null
    },
  })
  const wrapper = mount(Harness)
  return { api, wrapper }
}

// The composable is driven by a WATCHER on the query, behind a 300ms debounce.
// There is no fetch to call directly, and that is the right shape to test
// through: typing is what really happens, and the debounce is part of what stops
// every keystroke becoming an outbound request.
async function type(query, text) {
  query.value = text
  await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS)
  await flushPromises()
  // The discovery delay sits on top of the debounce, mocked to zero above.
  await vi.advanceTimersByTimeAsync(1)
  await flushPromises()
}

const SUGGEST_DEBOUNCE_MS = 300

beforeEach(() => {
  vi.useFakeTimers()
  db = createFakeDb()
  catalogRows = []
  mocks.discover = vi.fn(async () => [])
  // The catalog project answers through the same RPC name as the app database.
  mocks.catalogDb = {
    rpc: async () => ({ data: catalogRows, error: null }),
  }
  db.handlers['rpc.search_catalog'] = () => ({ data: [], error: null })
  db.handlers['purchase_history.select'] = () => ({ data: [], error: null })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('when the local catalog already answered', () => {
  it('does not ask anyone', async () => {
    // A row that contains every word typed IS the answer.
    catalogRows = [{ name: 'Lapte 1.5% 1L', maker: 'Zuzu', popularity: 40 }]

    const query = ref('')
    const { api, wrapper } = mountSuggestions(query)
    await type(query, 'lapte')

    expect(mocks.discover).not.toHaveBeenCalled()
    expect(api.suggestions.value.map((s) => s.name)).toContain('Lapte 1.5% 1L')
    wrapper.unmount()
  })
})

describe('when it did not', () => {
  it('asks, and appends what comes back below what was already there', async () => {
    // Non-empty, and about something else: the case a result COUNT gets wrong.
    catalogRows = [{ name: 'Apa Plata 2L', maker: 'Dorna', popularity: 90 }]
    mocks.discover = vi.fn(async () => [
      { name: 'Pepsi Zero 500ml', maker: 'Pepsi', popularity: 0 },
    ])

    const query = ref('')
    const { api, wrapper } = mountSuggestions(query)
    await type(query, 'pepsi zero')

    expect(mocks.discover).toHaveBeenCalledTimes(1)
    const names = api.suggestions.value.map((s) => s.name)
    // Appended, not substituted: what was on screen keeps its place.
    expect(names[0]).toBe('Apa Plata 2L')
    expect(names).toContain('Pepsi Zero 500ml')
    wrapper.unmount()
  })

  it('passes the market and language the search itself used', async () => {
    const query = ref('')
    const { api, wrapper } = mountSuggestions(query, {
      region: () => 'DE',
      locale: () => 'de',
    })
    await type(query, 'pepsi')

    expect(mocks.discover.mock.calls[0][1]).toMatchObject({
      query: 'pepsi',
      market: 'DE',
      language: 'de',
    })
    wrapper.unmount()
  })

  it('tells it what the local search already found, so it can skip those', async () => {
    catalogRows = [{ name: 'Apa Plata 2L', maker: 'Dorna', popularity: 90 }]
    const query = ref('')
    const { api, wrapper } = mountSuggestions(query)
    await type(query, 'pepsi')

    expect(mocks.discover.mock.calls[0][1].local.map((r) => r.name)).toContain('Apa Plata 2L')
    wrapper.unmount()
  })

  it('does not ask when there is no catalog project configured', async () => {
    mocks.catalogDb = null
    const query = ref('')
    const { api, wrapper } = mountSuggestions(query)
    await type(query, 'pepsi')

    expect(mocks.discover).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('a late answer', () => {
  it('is discarded when a newer keystroke has taken over', async () => {
    let release
    mocks.discover = vi.fn(
      () => new Promise((resolve) => { release = () => resolve([
        { name: 'Pepsi Zero 500ml', maker: 'Pepsi', popularity: 0 },
      ]) }),
    )

    const query = ref('')
    const { api, wrapper } = mountSuggestions(query)

    // The search that started the discovery.
    await type(query, 'pepsi zero')
    expect(mocks.discover).toHaveBeenCalledTimes(1)

    // The person carries on typing; that keystroke owns the dropdown now and
    // will do its own asking.
    catalogRows = [{ name: 'Pepsi Max', maker: 'Pepsi', popularity: 5 }]
    await type(query, 'pepsi max')

    // ...and only now does the first discovery come back.
    release()
    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()

    expect(api.suggestions.value.map((s) => s.name)).not.toContain('Pepsi Zero 500ml')
    wrapper.unmount()
  })

  it('is discarded when the person has already picked something', async () => {
    let release
    mocks.discover = vi.fn(
      () => new Promise((resolve) => { release = () => resolve([
        { name: 'Pepsi Zero 500ml', maker: 'Pepsi', popularity: 0 },
      ]) }),
    )

    const query = ref('')
    const { api, wrapper } = mountSuggestions(query)
    await type(query, 'pepsi zero')

    api.selectedProduct.value = { name: 'Something else', maker: null, popularity: 1 }
    release()
    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()

    expect(api.suggestions.value.map((s) => s.name)).not.toContain('Pepsi Zero 500ml')
    wrapper.unmount()
  })

  it('changes nothing when it finds nothing', async () => {
    catalogRows = [{ name: 'Apa Plata 2L', maker: 'Dorna', popularity: 90 }]
    mocks.discover = vi.fn(async () => [])

    const query = ref('')
    const { api, wrapper } = mountSuggestions(query)
    await type(query, 'pepsi zero')
    const before = api.suggestions.value.map((s) => s.name)

    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()
    expect(api.suggestions.value.map((s) => s.name)).toEqual(before)
    wrapper.unmount()
  })
})
