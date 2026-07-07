// @vitest-environment happy-dom
//
// Component tests for HomeView's optimistic mutation paths: the UI updates
// first, and every DB failure mode must either roll back or fold into the
// surviving row. These flows (insert races, 23505 handling, merge-on-uncheck)
// are the riskiest code in the app and regress silently without coverage.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import HomeView from '../src/views/HomeView.vue'
import AddItemForm from '../src/components/AddItemForm.vue'
import ShoppingList from '../src/components/ShoppingList.vue'
import ConfirmModal from '../src/components/ConfirmModal.vue'
import ErrorMessage from '../src/components/ErrorMessage.vue'
import { createFakeDb } from './support/fakeSupabase.js'
import { saveFamilySnapshot } from '../src/lib/familyCache'

const mocks = vi.hoisted(() => ({
  db: null,
  routerReplace: () => {},
}))

vi.mock('../src/supabase.js', () => ({
  useSupabase: () => mocks.db,
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: (...args) => mocks.routerReplace(...args) }),
}))

// Realtime lifecycle is owned by its own composable (tested separately); here
// it must simply not interfere.
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

function setDefaultHandlers(db, { items = [], maxItemsPerMember = 50 } = {}) {
  db.handlers['family_members.select'] = (q) =>
    q.wantSingle === 'maybe'
      ? { data: { family_id: 'fam-1' }, error: null }
      : {
          data: [{ user_id: 'user-1', display_name: 'Test User', image_url: null, role: 'moderator' }],
          error: null,
        }
  db.handlers['families.select'] = () => ({
    data: {
      name: 'Fam',
      invite_code: 'ABCDEFGH',
      created_by: 'user-1',
      max_items_per_member: maxItemsPerMember,
    },
    error: null,
  })
  db.handlers['shopping_list_items.select'] = (q) => ({
    data: items.filter((i) => i.checked === q.filters.checked),
    error: null,
  })
}

async function mountHome({ items = [], maxItemsPerMember = 50 } = {}) {
  mocks.db = createFakeDb()
  mocks.routerReplace = vi.fn()
  setDefaultHandlers(mocks.db, { items, maxItemsPerMember })
  const wrapper = mount(HomeView, { shallow: true })
  await flushPromises()
  await flushPromises()
  return wrapper
}

function listedItems(wrapper) {
  return wrapper.findComponent(ShoppingList).props('items')
}

async function submitAdd(wrapper, name, quantity = 1) {
  const form = wrapper.findComponent(AddItemForm)
  form.vm.$emit('update:name', name)
  form.vm.$emit('update:quantity', quantity)
  await wrapper.vm.$nextTick()
  form.vm.$emit('submit')
  await flushPromises()
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  // The snapshot cache persists across mounts; isolate each test.
  localStorage.clear()
})

describe('cached snapshot', () => {
  it('paints the cached list instantly while the real fetches are still in flight', async () => {
    saveFamilySnapshot(localStorage, 'user-1', {
      familyId: 'fam-1',
      familyName: 'Fam',
      familyInviteCode: 'ABCDEFGH',
      familyOwnerId: 'user-1',
      familyItemLimit: 50,
      familyMembers: [{ user_id: 'user-1', display_name: 'Me', image_url: null, role: 'moderator' }],
      items: [makeItem({ id: 'cached-1', name: 'Milk' })],
    })

    mocks.db = createFakeDb()
    mocks.routerReplace = vi.fn()
    // Simulate a cold, slow network: nothing ever resolves.
    const never = () => new Promise(() => {})
    mocks.db.handlers['family_members.select'] = never
    mocks.db.handlers['families.select'] = never
    mocks.db.handlers['shopping_list_items.select'] = never

    const wrapper = mount(HomeView, { shallow: true })
    await flushPromises()

    const list = wrapper.findComponent(ShoppingList)
    expect(list.props('items')).toHaveLength(1)
    expect(list.props('items')[0].id).toBe('cached-1')
    // Hydration must end the skeleton state even though no fetch completed.
    expect(list.props('loading')).toBe(false)
  })
})

describe('addItem', () => {
  it('shows the item optimistically, then swaps in the server row under the same id', async () => {
    const wrapper = await mountHome()

    let resolveInsert
    mocks.db.handlers['shopping_list_items.insert'] = (q) =>
      new Promise((resolve) => {
        resolveInsert = () =>
          resolve({ data: { ...q.payload, checked: false, created_at: '2026-02-02T00:00:00.000Z' }, error: null })
      })

    await submitAdd(wrapper, 'Milk', 2)

    // Optimistic row is visible while the insert is still in flight, and the
    // form has been cleared.
    let items = listedItems(wrapper)
    expect(items).toHaveLength(1)
    expect(items[0].name).toBe('Milk')
    expect(items[0].quantity).toBe(2)
    expect(wrapper.findComponent(AddItemForm).props('name')).toBe('')

    resolveInsert()
    await flushPromises()

    // Server row replaced the optimistic one in place: same id, server fields.
    items = listedItems(wrapper)
    expect(items).toHaveLength(1)
    expect(items[0].created_at).toBe('2026-02-02T00:00:00.000Z')
  })

  it('rolls back the optimistic row and restores the form when the insert fails', async () => {
    const wrapper = await mountHome()
    mocks.db.handlers['shopping_list_items.insert'] = () => ({
      data: null,
      error: { message: 'boom' },
    })

    await submitAdd(wrapper, 'Milk', 2)

    expect(listedItems(wrapper)).toHaveLength(0)
    const form = wrapper.findComponent(AddItemForm)
    expect(form.props('error')).toBe('boom')
    expect(form.props('name')).toBe('Milk')
    expect(form.props('quantity')).toBe(2)
  })

  it('bumps the quantity of an existing active item with the same name instead of inserting', async () => {
    const existing = makeItem({ id: 'item-1', name: 'Milk', quantity: 1 })
    const wrapper = await mountHome({ items: [existing] })
    mocks.db.handlers['shopping_list_items.update'] = () => ({ data: null, error: null })

    await submitAdd(wrapper, '  milk ', 3)

    const items = listedItems(wrapper)
    expect(items).toHaveLength(1)
    expect(items[0].quantity).toBe(4)
    const update = mocks.db.calls.find((q) => q.op === 'update')
    expect(update.payload).toEqual({ quantity: 4 })
    expect(update.filters.id).toBe('item-1')
    expect(mocks.db.calls.some((q) => q.op === 'insert')).toBe(false)
  })

  it('blocks adds past the per-member limit locally and opens the limit popup', async () => {
    const existing = makeItem({ id: 'item-1', name: 'Bread', added_by: 'user-1' })
    const wrapper = await mountHome({ items: [existing], maxItemsPerMember: 1 })

    await submitAdd(wrapper, 'Milk')

    expect(wrapper.findComponent(ConfirmModal).props('open')).toBe(true)
    expect(mocks.db.calls.some((q) => q.op === 'insert')).toBe(false)
    expect(listedItems(wrapper)).toHaveLength(1)
  })

  it('folds the quantity into the winning row after losing an insert race (23505)', async () => {
    const wrapper = await mountHome()
    const serverRow = makeItem({ id: 'srv-1', name: 'Milk', quantity: 2 })
    mocks.db.handlers['shopping_list_items.insert'] = () => ({
      data: null,
      error: { code: '23505', message: 'duplicate key value' },
    })
    // The reconciliation fetch finds the row the concurrent add created.
    mocks.db.handlers['shopping_list_items.select'] = () => ({ data: [serverRow], error: null })
    mocks.db.handlers['shopping_list_items.update'] = () => ({ data: null, error: null })

    await submitAdd(wrapper, 'Milk', 1)

    const items = listedItems(wrapper)
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('srv-1')
    expect(items[0].quantity).toBe(3)
    const update = mocks.db.calls.find((q) => q.op === 'update')
    expect(update.filters.id).toBe('srv-1')
  })
})

describe('toggleItem', () => {
  it('rolls the checkbox back when the update fails', async () => {
    const existing = makeItem({ id: 'item-1' })
    const wrapper = await mountHome({ items: [existing] })
    mocks.db.handlers['shopping_list_items.update'] = () => ({
      data: null,
      error: { message: 'nope' },
    })

    wrapper.findComponent(ShoppingList).vm.$emit('toggle', listedItems(wrapper)[0])
    await flushPromises()

    expect(listedItems(wrapper)[0].checked).toBe(false)
    expect(wrapper.findComponent(ErrorMessage).props('message')).toBe('nope')
  })

  it('merges an unchecked item into the existing active row with the same name', async () => {
    const checked = makeItem({ id: 'item-a', name: 'Milk', quantity: 2, checked: true })
    const active = makeItem({ id: 'item-b', name: 'Milk', quantity: 3 })
    const wrapper = await mountHome({ items: [active, checked] })
    mocks.db.handlers['shopping_list_items.update'] = () => ({ data: null, error: null })
    mocks.db.handlers['shopping_list_items.delete'] = () => ({ data: null, error: null })

    const source = listedItems(wrapper).find((i) => i.id === 'item-a')
    wrapper.findComponent(ShoppingList).vm.$emit('toggle', source)
    await flushPromises()

    const items = listedItems(wrapper)
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('item-b')
    expect(items[0].quantity).toBe(5)
    const del = mocks.db.calls.find((q) => q.op === 'delete')
    expect(del.filters.id).toBe('item-a')
  })

  it('restores both rows when the merge delete fails', async () => {
    const checked = makeItem({ id: 'item-a', name: 'Milk', quantity: 2, checked: true })
    const active = makeItem({ id: 'item-b', name: 'Milk', quantity: 3 })
    const wrapper = await mountHome({ items: [active, checked] })
    mocks.db.handlers['shopping_list_items.update'] = () => ({ data: null, error: null })
    mocks.db.handlers['shopping_list_items.delete'] = () => ({
      data: null,
      error: { message: 'delete failed' },
    })

    const source = listedItems(wrapper).find((i) => i.id === 'item-a')
    wrapper.findComponent(ShoppingList).vm.$emit('toggle', source)
    await flushPromises()

    const items = listedItems(wrapper)
    expect(items).toHaveLength(2)
    expect(items.find((i) => i.id === 'item-b').quantity).toBe(3)
    expect(items.find((i) => i.id === 'item-a')).toBeTruthy()
    expect(wrapper.findComponent(ErrorMessage).props('message')).toBe('delete failed')
  })
})

describe('deleteItem', () => {
  it('restores the row at its original position when the delete fails', async () => {
    const first = makeItem({ id: 'item-1', name: 'Milk' })
    const second = makeItem({ id: 'item-2', name: 'Eggs' })
    const wrapper = await mountHome({ items: [first, second] })
    mocks.db.handlers['shopping_list_items.delete'] = () => ({
      data: null,
      error: { message: 'cannot delete' },
    })

    wrapper.findComponent(ShoppingList).vm.$emit('delete', listedItems(wrapper)[0])
    await flushPromises()

    const items = listedItems(wrapper)
    expect(items.map((i) => i.id)).toEqual(['item-1', 'item-2'])
    expect(wrapper.findComponent(ErrorMessage).props('message')).toBe('cannot delete')
  })

  it('removes the row optimistically when the delete succeeds', async () => {
    const existing = makeItem({ id: 'item-1' })
    const wrapper = await mountHome({ items: [existing] })
    mocks.db.handlers['shopping_list_items.delete'] = () => ({ data: null, error: null })

    wrapper.findComponent(ShoppingList).vm.$emit('delete', listedItems(wrapper)[0])
    await flushPromises()

    expect(listedItems(wrapper)).toHaveLength(0)
  })
})
