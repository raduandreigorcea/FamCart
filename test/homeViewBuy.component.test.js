// @vitest-environment happy-dom
//
// Component tests for HomeView's "buy" path: checked items are archived via the
// buy_items RPC and removed from the list, with an offline fallback to queued
// deletes and a rollback when the server rejects the purchase.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import HomeView from '../src/views/HomeView.vue'
import ShoppingList from '../src/components/ShoppingList.vue'
import ErrorModal from '../src/components/ErrorModal.vue'
import { createFakeDb } from './support/fakeSupabase.js'
import { loadOfflineQueue } from '../src/lib/offlineQueue'
import { __setOnlineForTest } from '../src/lib/connectivity'

const mocks = vi.hoisted(() => ({
  db: null,
  routerReplace: () => {},
}))

vi.mock('../src/supabase', () => ({
  useSupabase: () => mocks.db,
}))

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
    useUser: () => ({
      user: ref({ fullName: 'Test User', imageUrl: null }),
    }),
  }
})

function makeItem(overrides = {}) {
  return {
    id: overrides.id ?? `item-${Math.random().toString(36).slice(2)}`,
    family_id: 'fam-1',
    name: 'Milk',
    quantity: 1,
    checked: false,
    added_by: 'user-1',
    added_by_name: 'Test User',
    added_by_image_url: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function setDefaultHandlers(db, { items = [] } = {}) {
  db.handlers['family_members.select'] = (q) =>
    q.wantSingle === 'maybe'
      ? { data: { family_id: 'fam-1' }, error: null }
      : {
          data: [{ user_id: 'user-1', display_name: 'Test User', image_url: null, role: 'moderator' }],
          error: null,
        }
  db.handlers['families.select'] = () => ({
    data: { name: 'Fam', invite_code: 'ABCDEFGH', created_by: 'user-1', max_items_per_member: 50 },
    error: null,
  })
  db.handlers['shopping_list_items.select'] = (q) => ({
    data: items.filter((i) => i.checked === q.filters.checked),
    error: null,
  })
}

const mountedWrappers = []

async function mountHome({ items = [] } = {}) {
  mocks.db = createFakeDb()
  mocks.routerReplace = vi.fn()
  setDefaultHandlers(mocks.db, { items })
  const wrapper = mount(HomeView, { shallow: true })
  mountedWrappers.push(wrapper)
  await flushPromises()
  await flushPromises()
  return wrapper
}

function listedItems(wrapper) {
  return wrapper.findComponent(ShoppingList).props('items')
}

async function emitBuy(wrapper, ids) {
  wrapper.findComponent(ShoppingList).vm.$emit('checkout', ids)
  await flushPromises()
}

function rpcCalls(db) {
  return db.calls.filter((c) => c.table === 'rpc' && c.op === 'buy_items')
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  localStorage.clear()
  __setOnlineForTest(true)
})

afterEach(() => {
  while (mountedWrappers.length) mountedWrappers.pop().unmount()
  __setOnlineForTest(true)
  vi.restoreAllMocks()
})

describe('buyCheckedItems', () => {
  it('archives the checked items via the RPC and drops them from the list', async () => {
    const items = [
      makeItem({ id: 'a', name: 'Milk', checked: true }),
      makeItem({ id: 'b', name: 'Bread', checked: true }),
      makeItem({ id: 'c', name: 'Eggs', checked: false }),
    ]
    const wrapper = await mountHome({ items })
    mocks.db.handlers['rpc.buy_items'] = (q) => ({ data: q.params.p_item_ids.length, error: null })

    await emitBuy(wrapper, ['a', 'b'])

    // Only the unchecked item survives.
    const remaining = listedItems(wrapper)
    expect(remaining.map((i) => i.id)).toEqual(['c'])

    // The RPC was called once with exactly the checked ids.
    const calls = rpcCalls(mocks.db)
    expect(calls).toHaveLength(1)
    expect(calls[0].params.p_item_ids).toEqual(['a', 'b'])
  })

  it('never buys an unchecked item even if its id is passed', async () => {
    const items = [
      makeItem({ id: 'a', name: 'Milk', checked: true }),
      makeItem({ id: 'c', name: 'Eggs', checked: false }),
    ]
    const wrapper = await mountHome({ items })
    mocks.db.handlers['rpc.buy_items'] = (q) => ({ data: q.params.p_item_ids.length, error: null })

    await emitBuy(wrapper, ['a', 'c'])

    // The unchecked item stays and was not sent to the RPC.
    expect(listedItems(wrapper).map((i) => i.id)).toEqual(['c'])
    expect(rpcCalls(mocks.db)[0].params.p_item_ids).toEqual(['a'])
  })

  it('offline: removes the items and queues deletes instead of calling the RPC', async () => {
    const items = [makeItem({ id: 'a', name: 'Milk', checked: true })]
    const wrapper = await mountHome({ items })
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)

    await emitBuy(wrapper, ['a'])

    expect(listedItems(wrapper)).toHaveLength(0)
    expect(rpcCalls(mocks.db)).toHaveLength(0)
    const queued = loadOfflineQueue(localStorage, 'user-1')
    expect(queued).toEqual([{ kind: 'delete', id: 'a' }])
  })

  it('restores the list and surfaces an error when the RPC is rejected', async () => {
    const items = [
      makeItem({ id: 'a', name: 'Milk', checked: true }),
      makeItem({ id: 'c', name: 'Eggs', checked: false }),
    ]
    const wrapper = await mountHome({ items })
    mocks.db.handlers['rpc.buy_items'] = () => ({ data: null, error: { message: 'nope', code: 'P0001' } })

    await emitBuy(wrapper, ['a'])

    // Rolled back: both items are back on the list.
    expect(listedItems(wrapper).map((i) => i.id).sort()).toEqual(['a', 'c'])
    // No delete was queued for a genuine (non-connectivity) rejection.
    expect(loadOfflineQueue(localStorage, 'user-1')).toEqual([])
    const errorModal = wrapper.findAllComponents(ErrorModal).find((m) => m.props('message') === 'nope')
    expect(errorModal).toBeTruthy()
  })
})
