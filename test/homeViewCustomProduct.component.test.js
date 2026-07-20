// @vitest-environment happy-dom
//
// HomeView's half of the catalog contribution flow (migration 022). The modal
// only builds a product; HomeView decides what reaches the database, and the two
// mistakes that matter are invisible from the UI: contributing a product the user
// never confirmed, and letting the internal `custom` tag ride into the item row.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import HomeView from '../src/views/HomeView.vue'
import AddItemForm from '../src/components/AddItemForm.vue'
import CustomProductModal from '../src/components/CustomProductModal.vue'
import ShoppingList from '../src/components/ShoppingList.vue'
import ErrorModal from '../src/components/ErrorModal.vue'
import { createFakeDb } from './support/fakeSupabase.js'
import { __setOnlineForTest } from '../src/lib/connectivity'

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

const mountedWrappers = []

async function mountHome() {
  mocks.db = createFakeDb()
  mocks.routerReplace = vi.fn()
  mocks.db.handlers['family_members.select'] = (q) =>
    q.wantSingle === 'maybe'
      ? { data: { family_id: 'fam-1' }, error: null }
      : {
          data: [{ user_id: 'user-1', display_name: 'Test User', image_url: null, role: 'moderator' }],
          error: null,
        }
  mocks.db.handlers['families.select'] = () => ({
    data: { name: 'Fam', invite_code: 'ABCDEFGH', created_by: 'user-1', max_items_per_member: 50 },
    error: null,
  })
  mocks.db.handlers['shopping_list_items.select'] = () => ({ data: [], error: null })
  mocks.db.handlers['purchase_history.select'] = () => ({ data: [], error: null })
  mocks.db.handlers['shopping_list_items.insert'] = (q) => ({ data: { ...q.payload, checked: false }, error: null })
  mocks.db.handlers['rpc.add_custom_product'] = () => ({ data: null, error: null })
  mocks.db.handlers['rpc.bump_product_popularity'] = () => ({ data: null, error: null })

  const wrapper = mount(HomeView, { shallow: true })
  mountedWrappers.push(wrapper)
  await flushPromises()
  await flushPromises()
  return wrapper
}

const rpcCalls = (fn) => mocks.db.calls.filter((c) => c.table === 'rpc' && c.op === fn)
const insertedRows = () =>
  mocks.db.calls.filter((c) => c.table === 'shopping_list_items' && c.op === 'insert').map((c) => c.payload)
const listedItems = (wrapper) => wrapper.findComponent(ShoppingList).props('items')

// Type enough to unlock the escape hatch, then submit the modal the way the user
// would: through "Add your own" rather than the plain add form.
async function addCustomProduct(wrapper, product) {
  wrapper.findComponent(AddItemForm).vm.$emit('update:name', product.name)
  await wrapper.vm.$nextTick()
  wrapper.findComponent(CustomProductModal).vm.$emit('submit', product)
  await flushPromises()
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  localStorage.clear()
})

afterEach(() => {
  while (mountedWrappers.length) mountedWrappers.pop().unmount()
  __setOnlineForTest(true)
  vi.restoreAllMocks()
})

describe('contributing a custom product to the catalog', () => {
  it('contributes the product against the family that added it', async () => {
    const wrapper = await mountHome()

    await addCustomProduct(wrapper, { name: 'Olive Oil 500ml', maker: 'Bertolli' })

    const calls = rpcCalls('add_custom_product')
    expect(calls).toHaveLength(1)
    expect(calls[0].params).toEqual({
      p_family_id: 'fam-1',
      p_name: 'Olive Oil 500ml',
      p_maker: 'Bertolli',
    })
  })

  it('sends a null maker rather than omitting it when none was given', async () => {
    const wrapper = await mountHome()

    await addCustomProduct(wrapper, { name: 'Olive Oil 500ml', maker: null })

    expect(rpcCalls('add_custom_product')[0].params.p_maker).toBeNull()
  })

  it('keeps the internal custom tag out of the item row', async () => {
    const wrapper = await mountHome()

    await addCustomProduct(wrapper, { name: 'Olive Oil 500ml', maker: 'Bertolli' })

    // The row is built from named fields, so the tag must not survive into it —
    // shopping_list_items has no such column and the insert would fail.
    const [row] = insertedRows()
    expect(row).not.toHaveProperty('custom')
    expect(row.name).toBe('Olive Oil 500ml')
    expect(row.maker).toBe('Bertolli')
  })

  it('bumps popularity instead of contributing when the product came from the catalog', async () => {
    const wrapper = await mountHome()

    wrapper.findComponent(AddItemForm).vm.$emit('select', {
      name: 'Apa Plata 2L',
      maker: 'Dorna',
    })
    await flushPromises()

    expect(rpcCalls('bump_product_popularity')).toHaveLength(1)
    expect(rpcCalls('add_custom_product')).toHaveLength(0)
  })

  it('contributes nothing while offline, and still adds the item', async () => {
    const wrapper = await mountHome()
    __setOnlineForTest(false)

    await addCustomProduct(wrapper, { name: 'Olive Oil 500ml', maker: 'Bertolli' })

    // The contribution is not part of the offline queue: the item is what the
    // user asked for, and the catalog can wait for the next add.
    expect(rpcCalls('add_custom_product')).toHaveLength(0)
    expect(listedItems(wrapper).map((i) => i.name)).toEqual(['Olive Oil 500ml'])
  })

  it('adds the item even when the contribution fails', async () => {
    const wrapper = await mountHome()
    mocks.db.handlers['rpc.add_custom_product'] = () => ({
      data: null,
      error: { message: 'nope', code: 'P0001' },
    })

    await addCustomProduct(wrapper, { name: 'Olive Oil 500ml', maker: 'Bertolli' })

    // Contributing is a side benefit; failing it must never cost the user the
    // add, nor raise an error modal over an add that worked.
    expect(listedItems(wrapper).map((i) => i.name)).toEqual(['Olive Oil 500ml'])
    const shown = wrapper.findAllComponents(ErrorModal).map((m) => m.props('message'))
    expect(shown.filter(Boolean)).toEqual([])
  })
})
