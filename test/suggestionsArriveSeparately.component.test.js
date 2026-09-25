// @vitest-environment happy-dom
//
// The dropdown used to wait for BOTH databases before showing anything, so every
// search was as slow as the slower one -- and the slower one is the catalog
// project, on a small instance that swaps (measured 2026-09-13: 230-870ms of
// server time for a word nobody had searched yet, on top of ~280ms of network).
// Nothing a list typed in needs that wait.
//
// So each source lands on its own. What this pins is the part that is easy to
// get wrong while doing that: a late answer from a superseded search must not
// land, and the skeleton must not give way to an empty list while a source that
// might still answer is outstanding.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createFakeDb } from './support/fakeSupabase.js'

const catalog = vi.hoisted(() => ({ db: null }))

vi.mock('../src/supabase', () => ({
  getCatalogSupabase: () => catalog.db,
}))

const { useProductSuggestions } = await import('../src/lib/productSuggestions')

const CATALOG_ROW = { name: 'Lapte Zuzu 1L', maker: 'Zuzu', popularity: 10, retailers: ['lidl'] }
const LOCAL_ROW = { name: 'Lapte de casa', maker: null, popularity: 3 }

let db
// One entry per catalog search, resolved by the test when it chooses.
let pending

beforeEach(() => {
  localStorage.clear()
  pending = []
  db = createFakeDb()
  db.handlers['rpc.search_catalog'] = () => ({ data: [LOCAL_ROW], error: null })
  db.handlers['purchase_history.select'] = () => ({ data: [], error: null })
  catalog.db = {
    rpc: (fn, args) =>
      fn === 'search_catalog'
        ? new Promise((resolve) => pending.push({ args, resolve }))
        : Promise.resolve({ data: [], error: null }),
    from: () => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
    }),
  }
})

function mountSuggestions() {
  const query = ref('')
  let api
  mount(
    defineComponent({
      setup() {
        api = useProductSuggestions({
          db,
          listId: ref('hh-a'),
          items: ref([]),
          query,
          isOffline: () => false,
          region: () => 'RO',
          locale: () => 'ro',
        })
        return () => null
      },
    }),
  )
  return { api, query }
}

/** Type and wait out the debounce, leaving the catalog unanswered. */
async function type(query, text) {
  vi.useFakeTimers()
  query.value = text
  await flushPromises()
  await vi.advanceTimersByTimeAsync(400)
  vi.useRealTimers()
  await flushPromises()
}

const names = (api) => api.suggestions.value.map((s) => s.name)

describe('each database answers on its own', () => {
  it('shows the list rows without waiting for the catalog', async () => {
    const { api, query } = mountSuggestions()
    await type(query, 'lapte')

    expect(pending).toHaveLength(1)
    expect(names(api)).toEqual(['Lapte de casa'])
    expect(api.suggestionsLoading.value).toBe(false)

    pending[0].resolve({ data: [CATALOG_ROW], error: null })
    await flushPromises()
    expect(names(api)).toContain('Lapte Zuzu 1L')
    expect(names(api)).toContain('Lapte de casa')
  })

  it('keeps the skeleton while the only answer so far is empty', async () => {
    // An empty list with "Can't find it?" under it, replaced a moment later by
    // the catalog's matches, would be a claim the search had not yet earned.
    db.handlers['rpc.search_catalog'] = () => ({ data: [], error: null })
    const { api, query } = mountSuggestions()
    await type(query, 'lapte')

    expect(api.suggestionsLoading.value).toBe(true)

    pending[0].resolve({ data: [CATALOG_ROW], error: null })
    await flushPromises()
    expect(api.suggestionsLoading.value).toBe(false)
    expect(names(api)).toEqual(['Lapte Zuzu 1L'])
  })

  it('stops the skeleton when both answered with nothing', async () => {
    db.handlers['rpc.search_catalog'] = () => ({ data: [], error: null })
    const { api, query } = mountSuggestions()
    await type(query, 'xyzzy')

    pending[0].resolve({ data: [], error: null })
    await flushPromises()
    expect(api.suggestionsLoading.value).toBe(false)
    expect(names(api)).toEqual([])
  })

  it('drops a catalog answer that belongs to an earlier search', async () => {
    const { api, query } = mountSuggestions()
    await type(query, 'lapte')
    await type(query, 'paine')

    pending[0].resolve({ data: [CATALOG_ROW], error: null })
    await flushPromises()
    expect(names(api)).not.toContain('Lapte Zuzu 1L')
  })

  it('still shows the catalog when the list database fails', async () => {
    db.handlers['rpc.search_catalog'] = () => ({ data: null, error: { message: 'boom' } })
    const { api, query } = mountSuggestions()
    await type(query, 'lapte')

    pending[0].resolve({ data: [CATALOG_ROW], error: null })
    await flushPromises()
    expect(names(api)).toEqual(['Lapte Zuzu 1L'])
    expect(api.suggestionsLoading.value).toBe(false)
  })
})

// A catalog that errored answers with nothing, and "nothing" is also what a
// product no shop sells looks like. The note is what tells the two apart.
describe('saying when the answer is partial', () => {
  it('flags a search whose catalog leg errored', async () => {
    const { api, query } = mountSuggestions()
    await type(query, 'lapte')
    pending[0].resolve({ data: null, error: { message: 'timeout' } })
    await flushPromises()

    expect(api.searchNote.value).toBe('degraded')
    expect(api.suggestions.value.map((s) => s.name)).toEqual(['Lapte de casa'])
  })

  it('carries no note when every source answered', async () => {
    const { api, query } = mountSuggestions()
    await type(query, 'lapte')
    pending[0].resolve({ data: [CATALOG_ROW], error: null })
    await flushPromises()

    expect(api.searchNote.value).toBeNull()
  })
})
