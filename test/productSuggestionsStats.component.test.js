// @vitest-environment happy-dom
//
// The purchase-history stats fetch spans a list switch: a request issued
// for list A can resolve after resetForList() has cleared everything
// for list B. Without a staleness guard, A's rows become B's ranking
// signal and A's `finally` marks B's still-pending answer as loaded — which is
// what decides between "All bought" and "Nothing here yet" on an empty list.
// The suggestions fetch has suggestRequestId for exactly this race; these tests
// are what keeps the stats fetch honest the same way.
import { describe, it, expect, beforeEach } from 'vitest'
import { defineComponent, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { useProductSuggestions } from '../src/lib/productSuggestions'
import { createFakeDb } from './support/fakeSupabase.js'

let db
// resolve function per list_id the query filtered on, so a test can land
// responses in whichever order the race needs.
let pendingStats

function mountSuggestions(listId) {
  let api
  const Harness = defineComponent({
    setup() {
      api = useProductSuggestions({
        db,
        listId,
        items: ref([]),
        query: ref(''),
        isOffline: () => false,
        // Required by the composable, which reads the market as soon as it is
        // created to ask for the shops of this country.
        region: () => 'RO',
        locale: () => 'ro',
      })
      return () => null
    },
  })
  const wrapper = mount(Harness)
  return { api, wrapper }
}

beforeEach(() => {
  db = createFakeDb()
  pendingStats = new Map()
  db.handlers['purchase_history.select'] = (query) =>
    new Promise((resolve) => {
      pendingStats.set(query.filters.list_id, resolve)
    })
})

describe('loadListProductStats across a list switch', () => {
  it('discards a stale response from the list that was switched away from', async () => {
    const listId = ref('hh-a')
    const { api, wrapper } = mountSuggestions(listId)

    // A's fetch goes out and stays in flight.
    const first = api.loadListProductStats()
    await flushPromises()

    // Switch to B, whose own fetch answers straight away: no history.
    api.resetForList()
    listId.value = 'hh-b'
    const second = api.loadListProductStats()
    await flushPromises()
    pendingStats.get('hh-b')({ data: [], error: null })
    await second

    // A's response arrives late, carrying purchases B never made.
    pendingStats.get('hh-a')({
      data: [{ name: 'Milk', maker: 'Zuzu', purchased_at: '2026-01-01T00:00:00.000Z' }],
      error: null,
    })
    await first

    expect(api.listProductStats.value.size).toBe(0)
    wrapper.unmount()
  })

  it('does not mark stats loaded for the new list off the old one’s response', async () => {
    const listId = ref('hh-a')
    const { api, wrapper } = mountSuggestions(listId)

    const first = api.loadListProductStats()
    await flushPromises()

    // Switch to B; B's fetch is still in flight when A's response lands.
    api.resetForList()
    listId.value = 'hh-b'
    void api.loadListProductStats()
    await flushPromises()

    pendingStats.get('hh-a')({ data: [], error: null })
    await first

    // B has not answered, so the empty state must keep waiting.
    expect(api.productStatsLoaded.value).toBe(false)
    wrapper.unmount()
  })
})
