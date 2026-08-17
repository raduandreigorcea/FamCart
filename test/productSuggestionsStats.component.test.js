// @vitest-environment happy-dom
//
// The purchase-history stats fetch spans a household switch: a request issued
// for household A can resolve after resetForHousehold() has cleared everything
// for household B. Without a staleness guard, A's rows become B's ranking
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
// resolve function per household_id the query filtered on, so a test can land
// responses in whichever order the race needs.
let pendingStats

function mountSuggestions(householdId) {
  let api
  const Harness = defineComponent({
    setup() {
      api = useProductSuggestions({
        db,
        householdId,
        items: ref([]),
        query: ref(''),
        isOffline: () => false,
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
      pendingStats.set(query.filters.household_id, resolve)
    })
})

describe('loadHouseholdProductStats across a household switch', () => {
  it('discards a stale response from the household that was switched away from', async () => {
    const householdId = ref('hh-a')
    const { api, wrapper } = mountSuggestions(householdId)

    // A's fetch goes out and stays in flight.
    const first = api.loadHouseholdProductStats()
    await flushPromises()

    // Switch to B, whose own fetch answers straight away: no history.
    api.resetForHousehold()
    householdId.value = 'hh-b'
    const second = api.loadHouseholdProductStats()
    await flushPromises()
    pendingStats.get('hh-b')({ data: [], error: null })
    await second

    // A's response arrives late, carrying purchases B never made.
    pendingStats.get('hh-a')({
      data: [{ name: 'Milk', maker: 'Zuzu', purchased_at: '2026-01-01T00:00:00.000Z' }],
      error: null,
    })
    await first

    expect(api.householdProductStats.value.size).toBe(0)
    wrapper.unmount()
  })

  it('does not mark stats loaded for the new household off the old one’s response', async () => {
    const householdId = ref('hh-a')
    const { api, wrapper } = mountSuggestions(householdId)

    const first = api.loadHouseholdProductStats()
    await flushPromises()

    // Switch to B; B's fetch is still in flight when A's response lands.
    api.resetForHousehold()
    householdId.value = 'hh-b'
    void api.loadHouseholdProductStats()
    await flushPromises()

    pendingStats.get('hh-a')({ data: [], error: null })
    await first

    // B has not answered, so the empty state must keep waiting.
    expect(api.productStatsLoaded.value).toBe(false)
    wrapper.unmount()
  })
})
