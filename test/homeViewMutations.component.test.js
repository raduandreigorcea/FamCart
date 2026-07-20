// @vitest-environment happy-dom
//
// Component tests for HomeView's optimistic mutation paths: the UI updates
// first, and every DB failure mode must either roll back or fold into the
// surviving row. These flows (insert races, 23505 handling, merge-on-uncheck)
// are the riskiest code in the app and regress silently without coverage.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import HomeView from '../src/views/HomeView.vue'
import AddItemForm from '../src/components/AddItemForm.vue'
import CustomProductModal from '../src/components/CustomProductModal.vue'
import ShoppingList from '../src/components/ShoppingList.vue'
import ConfirmModal from '../src/components/ConfirmModal.vue'
import ErrorModal from '../src/components/ErrorModal.vue'
import { createFakeDb } from './support/fakeSupabase.js'
import { saveFamilySnapshot } from '../src/lib/familyCache'
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

const mountedWrappers = []

function trackMount(...args) {
  const wrapper = mount(...args)
  mountedWrappers.push(wrapper)
  return wrapper
}

async function mountHome({ items = [], maxItemsPerMember = 50 } = {}) {
  mocks.db = createFakeDb()
  mocks.routerReplace = vi.fn()
  setDefaultHandlers(mocks.db, { items, maxItemsPerMember })
  const wrapper = trackMount(HomeView, { shallow: true })
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

afterEach(() => {
  // Unmount so each HomeView's window 'online' listener is removed; a leaked
  // listener from an earlier test would flush the offline queue against that
  // test's stale fake db.
  while (mountedWrappers.length) mountedWrappers.pop().unmount()
  // Reset the connectivity singleton to online (after unmount, so no detached
  // reconnect handler fires) — otherwise an offline test would leak into the
  // next, whose isOffline() would then always report offline.
  __setOnlineForTest(true)
  vi.restoreAllMocks()
})

function goOffline() {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
}

function goOnline() {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true)
  window.dispatchEvent(new Event('online'))
}

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

    const wrapper = trackMount(HomeView, { shallow: true })
    await flushPromises()

    const list = wrapper.findComponent(ShoppingList)
    expect(list.props('items')).toHaveLength(1)
    expect(list.props('items')[0].id).toBe('cached-1')
    // Hydration must end the skeleton state even though no fetch completed.
    expect(list.props('loading')).toBe(false)
  })
})

// Tapping a suggestion is a complete statement of intent — which product, which
// maker — so it adds straight away instead of filling the input and waiting for
// a confirming tap.
describe('picking a suggestion', () => {
  async function pick(wrapper, product, { typed = '', quantity = 1 } = {}) {
    const form = wrapper.findComponent(AddItemForm)
    form.vm.$emit('update:name', typed)
    form.vm.$emit('update:quantity', quantity)
    await wrapper.vm.$nextTick()
    form.vm.$emit('select', product)
    await flushPromises()
  }

  it('adds the product immediately instead of putting it in the input', async () => {
    const wrapper = await mountHome()
    mocks.db.handlers['shopping_list_items.insert'] = (q) => ({
      data: { ...q.payload, checked: false, created_at: '2026-02-02T00:00:00.000Z' },
      error: null,
    })

    await pick(wrapper, { name: 'Apa Plata 2L', maker: 'Dorna' }, { typed: 'apa' })

    const items = listedItems(wrapper)
    expect(items).toHaveLength(1)
    expect(items[0].name).toBe('Apa Plata 2L')
    // The maker comes from the pick, not from what was typed.
    expect(items[0].maker).toBe('Dorna')
    // The half-typed "apa" is gone rather than left behind or added as an item.
    expect(wrapper.findComponent(AddItemForm).props('name')).toBe('')
  })

  it('adds the picked product, not the text already in the input', async () => {
    const wrapper = await mountHome()
    const inserted = []
    mocks.db.handlers['shopping_list_items.insert'] = (q) => {
      inserted.push(q.payload)
      return { data: { ...q.payload, checked: false, created_at: '2026-02-02T00:00:00.000Z' }, error: null }
    }

    await pick(wrapper, { name: 'Lapte 3.5% 1L', maker: 'Napolact' }, { typed: 'lap' })

    expect(inserted).toHaveLength(1)
    expect(inserted[0].name).toBe('Lapte 3.5% 1L')
  })

  it('keeps the quantity chosen on the form', async () => {
    const wrapper = await mountHome()
    mocks.db.handlers['shopping_list_items.insert'] = (q) => ({
      data: { ...q.payload, checked: false, created_at: '2026-02-02T00:00:00.000Z' },
      error: null,
    })

    await pick(wrapper, { name: 'Banane 1kg', maker: null }, { typed: 'ban', quantity: 3 })

    expect(listedItems(wrapper)[0].quantity).toBe(3)
  })

  it('merges into the existing active row instead of duplicating it', async () => {
    const existing = makeItem({ id: 'item-1', name: 'Apa Plata 2L', maker: 'Dorna', quantity: 1 })
    const wrapper = await mountHome({ items: [existing] })
    mocks.db.handlers['shopping_list_items.update'] = () => ({ data: null, error: null })

    await pick(wrapper, { name: 'Apa Plata 2L', maker: 'Dorna' }, { typed: 'apa' })

    const items = listedItems(wrapper)
    expect(items).toHaveLength(1)
    expect(items[0].quantity).toBe(2)
  })

  it('restores the product into the form when the add fails', async () => {
    const wrapper = await mountHome()
    mocks.db.handlers['shopping_list_items.insert'] = () => ({
      data: null,
      error: { message: 'boom' },
    })

    await pick(wrapper, { name: 'Apa Plata 2L', maker: 'Dorna' }, { typed: 'apa' })

    // Nothing added, and the full product name (not the typed "apa") is put back
    // so the add can simply be retried.
    expect(listedItems(wrapper)).toHaveLength(0)
    expect(wrapper.findComponent(AddItemForm).props('name')).toBe('Apa Plata 2L')
  })
})

// The way out when the catalog has nothing: describe the product yourself. It
// lands on the list like any other add — and never in product_catalog, which is
// global and read-only to clients.
describe('adding a custom product', () => {
  it('offers the escape hatch once the query is long enough to have been searched', async () => {
    const wrapper = await mountHome()
    const form = wrapper.findComponent(AddItemForm)

    expect(form.props('canAddCustom')).toBe(false)

    form.vm.$emit('update:name', 'a')
    await wrapper.vm.$nextTick()
    expect(form.props('canAddCustom')).toBe(false)

    form.vm.$emit('update:name', 'Branza de burduf')
    await wrapper.vm.$nextTick()
    expect(form.props('canAddCustom')).toBe(true)
  })

  it('opens the modal prefilled with what was typed', async () => {
    const wrapper = await mountHome()
    const form = wrapper.findComponent(AddItemForm)
    form.vm.$emit('update:name', 'Branza de burduf')
    await wrapper.vm.$nextTick()

    form.vm.$emit('add-custom')
    await wrapper.vm.$nextTick()

    const modal = wrapper.findComponent(CustomProductModal)
    expect(modal.props('open')).toBe(true)
    expect(modal.props('initialName')).toBe('Branza de burduf')
  })

  it('adds the described product with its maker attached', async () => {
    const wrapper = await mountHome()
    const inserted = []
    mocks.db.handlers['shopping_list_items.insert'] = (q) => {
      inserted.push(q.payload)
      return { data: { ...q.payload, checked: false, created_at: '2026-02-02T00:00:00.000Z' }, error: null }
    }

    const form = wrapper.findComponent(AddItemForm)
    form.vm.$emit('update:name', 'Branza')
    await wrapper.vm.$nextTick()
    form.vm.$emit('add-custom')
    await wrapper.vm.$nextTick()

    wrapper.findComponent(CustomProductModal).vm.$emit('submit', {
      name: 'Branza de burduf',
      maker: 'Piata Obor',
    })
    await flushPromises()

    expect(inserted).toHaveLength(1)
    expect(inserted[0].name).toBe('Branza de burduf')
    // A maker on a hand-typed item is only reachable through this modal.
    expect(inserted[0].maker).toBe('Piata Obor')

    const items = listedItems(wrapper)
    expect(items).toHaveLength(1)
    expect(items[0].maker).toBe('Piata Obor')
    // The modal closed and the half-typed text is gone.
    expect(wrapper.findComponent(CustomProductModal).props('open')).toBe(false)
    expect(wrapper.findComponent(AddItemForm).props('name')).toBe('')
  })

  it('reaches the catalog only through the RPC, never the table directly', async () => {
    const wrapper = await mountHome()
    mocks.db.handlers['shopping_list_items.insert'] = (q) => ({
      data: { ...q.payload, checked: false, created_at: '2026-02-02T00:00:00.000Z' },
      error: null,
    })

    const form = wrapper.findComponent(AddItemForm)
    form.vm.$emit('update:name', 'Branza')
    await wrapper.vm.$nextTick()
    form.vm.$emit('add-custom')
    await wrapper.vm.$nextTick()
    wrapper.findComponent(CustomProductModal).vm.$emit('submit', {
      name: 'Branza de burduf',
      maker: 'Piata Obor',
    })
    await flushPromises()

    // The add really happened...
    expect(mocks.db.calls.some((c) => c.table === 'shopping_list_items' && c.op === 'insert')).toBe(true)
    // ...and the catalog itself saw nothing but reads. Contributing goes through
    // add_custom_product (see homeViewCustomProduct.component.test.js), which is
    // what scopes the product to this family and checks membership. RLS grants
    // SELECT and nothing else (migration 022), so a direct write here would be
    // rejected by the database anyway — this catches it at the source instead.
    expect(mocks.db.calls.filter((c) => c.table === 'product_catalog' && c.op !== 'select')).toEqual([])
  })

  it('closes without adding anything when cancelled', async () => {
    const wrapper = await mountHome()
    const form = wrapper.findComponent(AddItemForm)
    form.vm.$emit('update:name', 'Branza')
    await wrapper.vm.$nextTick()
    form.vm.$emit('add-custom')
    await wrapper.vm.$nextTick()

    wrapper.findComponent(CustomProductModal).vm.$emit('cancel')
    await flushPromises()

    expect(wrapper.findComponent(CustomProductModal).props('open')).toBe(false)
    expect(listedItems(wrapper)).toHaveLength(0)
    // The typed text survives a cancel: nothing happened, so nothing is lost.
    expect(wrapper.findComponent(AddItemForm).props('name')).toBe('Branza')
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
    // Second ErrorModal is the add-item one (first is the load error).
    expect(wrapper.findAllComponents(ErrorModal)[1].props('message')).toBe('boom')
    const form = wrapper.findComponent(AddItemForm)
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
    expect(wrapper.findComponent(ErrorModal).props('message')).toBe('nope')
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
    expect(wrapper.findComponent(ErrorModal).props('message')).toBe('delete failed')
  })

  it('moves a newly checked item to the top of the checked section', async () => {
    const older = makeItem({ id: 'older', name: 'Milk', checked: true, checked_at: '2026-01-01T00:00:00.000Z' })
    const active = makeItem({ id: 'active', name: 'Bread', checked: false })
    const wrapper = await mountHome({ items: [active, older] })
    mocks.db.handlers['shopping_list_items.update'] = () => ({ data: null, error: null })

    wrapper.findComponent(ShoppingList).vm.$emit('toggle', listedItems(wrapper).find((i) => i.id === 'active'))
    await flushPromises()

    // Bread was just checked (now), so it sits above the older checked Milk.
    const checkedOrder = listedItems(wrapper).filter((i) => i.checked).map((i) => i.id)
    expect(checkedOrder).toEqual(['active', 'older'])
  })

  it('shows the limit popup (not a raw error) when unchecking would exceed the cap', async () => {
    const item = makeItem({ id: 'item-1', name: 'Milk', checked: true, checked_at: '2026-01-01T00:00:00.000Z' })
    const wrapper = await mountHome({ items: [item] })
    // The DB trigger (migration 010) now rejects an uncheck that breaks the cap.
    mocks.db.handlers['shopping_list_items.update'] = () => ({
      data: null,
      error: { message: 'You reached your limit of 50 active items.', detail: 'member_active_item_limit_exceeded' },
    })

    wrapper.findComponent(ShoppingList).vm.$emit('toggle', listedItems(wrapper)[0])
    await flushPromises()

    // Rolled back to checked, friendly popup instead of an error modal.
    expect(listedItems(wrapper)[0].checked).toBe(true)
    expect(wrapper.findComponent(ConfirmModal).props('open')).toBe(true)
    expect(wrapper.findComponent(ErrorModal).props('message')).toBeFalsy()
  })

  // Regression: the same tap that checks an item also wakes a reconnect/refetch.
  // While the checked=true write is still in flight, that refetch reads the
  // server's pre-write row (still unchecked) and used to overwrite the flip,
  // bouncing the item straight back to the active list. The in-flight write must
  // hold its ground.
  it('keeps a just-checked item checked when a refetch races the in-flight write', async () => {
    const server = [makeItem({ id: 'item-1', name: 'Milk', checked: false })]
    const wrapper = await mountHome({ items: server })

    // Refetches now hand back clones, so the view's optimistic flip cannot leak
    // into the "server" state the next select reads back — the real client/server
    // split this bug lives in.
    mocks.db.handlers['shopping_list_items.select'] = (q) => ({
      data: server.filter((i) => i.checked === q.filters.checked).map((i) => ({ ...i })),
      error: null,
    })
    goOnline()
    await flushPromises()

    // The checked=true write never lands (stays in flight), so the server row
    // stays unchecked — exactly the race window.
    let resolveUpdate
    mocks.db.handlers['shopping_list_items.update'] = () =>
      new Promise((resolve) => {
        resolveUpdate = () => resolve({ data: null, error: null })
      })

    wrapper.findComponent(ShoppingList).vm.$emit('toggle', listedItems(wrapper).find((i) => i.id === 'item-1'))
    await flushPromises()
    expect(listedItems(wrapper).find((i) => i.id === 'item-1').checked).toBe(true)

    // A background refetch fires mid-write, as a reconnect/focus/watchdog would.
    // Without the guard this reverts the item to the server's unchecked row.
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(listedItems(wrapper).find((i) => i.id === 'item-1').checked).toBe(true)

    resolveUpdate()
    await flushPromises()
  })
})

describe('list ordering', () => {
  // Regression: the optimistic row is appended with a client-clock created_at,
  // then the server echo swaps in the authoritative created_at. Without a re-sort
  // the row keeps its append position until some later background refetch suddenly
  // moves it — items appearing to "change rows on their own". The echo must settle
  // the canonical order right away.
  it('re-sorts a newly added item into created_at order once the server row lands', async () => {
    const existing = makeItem({ id: 'item-late', name: 'Zucchini', created_at: '2026-01-02T00:00:00.000Z' })
    const wrapper = await mountHome({ items: [existing] })
    // The server stamps the new row EARLIER than the existing one, so canonical
    // order puts it first — not at the append position.
    mocks.db.handlers['shopping_list_items.insert'] = (q) => ({
      data: { ...q.payload, checked: false, created_at: '2026-01-01T00:00:00.000Z' },
      error: null,
    })

    await submitAdd(wrapper, 'Apple')

    expect(listedItems(wrapper).map((i) => i.name)).toEqual(['Apple', 'Zucchini'])
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
    expect(wrapper.findComponent(ErrorModal).props('message')).toBe('cannot delete')
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

describe('offline queue', () => {
  it('queues the add locally when offline instead of calling the network', async () => {
    const wrapper = await mountHome()
    goOffline()

    await submitAdd(wrapper, 'Milk', 2)

    const items = listedItems(wrapper)
    expect(items).toHaveLength(1)
    expect(items[0].name).toBe('Milk')
    expect(items[0].quantity).toBe(2)
    expect(mocks.db.calls.some((q) => q.op === 'insert')).toBe(false)
    const queue = loadOfflineQueue(localStorage, 'user-1')
    expect(queue).toHaveLength(1)
    expect(queue[0].kind).toBe('insert')
  })

  it('cancels the queued insert when the item is deleted while still offline', async () => {
    const wrapper = await mountHome()
    goOffline()

    await submitAdd(wrapper, 'Milk')
    wrapper.findComponent(ShoppingList).vm.$emit('delete', listedItems(wrapper)[0])
    await flushPromises()

    expect(listedItems(wrapper)).toHaveLength(0)
    expect(loadOfflineQueue(localStorage, 'user-1')).toHaveLength(0)
    // The row never existed on the server, so nothing must go over the wire.
    expect(mocks.db.calls.some((q) => q.op === 'insert' || q.op === 'delete')).toBe(false)
  })

  it('flushes queued writes and re-fetches when connectivity returns', async () => {
    const wrapper = await mountHome()
    goOffline()
    await submitAdd(wrapper, 'Milk', 2)
    wrapper.findComponent(ShoppingList).vm.$emit('toggle', listedItems(wrapper)[0])
    await flushPromises()
    expect(loadOfflineQueue(localStorage, 'user-1')).toHaveLength(1)

    const serverRow = makeItem({ id: 'ignored', name: 'Milk', quantity: 2, checked: true })
    mocks.db.handlers['shopping_list_items.insert'] = (q) => {
      serverRow.id = q.payload.id
      return { data: { ...q.payload, checked: true }, error: null }
    }
    mocks.db.handlers['shopping_list_items.select'] = (q) => ({
      data: [serverRow].filter((i) => i.checked === q.filters.checked),
      error: null,
    })
    goOnline()
    await flushPromises()

    // The queued insert (with the offline toggle folded into it) was replayed...
    const insert = mocks.db.calls.find((q) => q.op === 'insert')
    expect(insert.payload.name).toBe('Milk')
    expect(insert.payload.checked).toBe(true)
    expect(loadOfflineQueue(localStorage, 'user-1')).toHaveLength(0)
    // ...and the re-fetch converged the list on the server's state.
    const items = listedItems(wrapper)
    expect(items).toHaveLength(1)
    expect(items[0].checked).toBe(true)
  })

  it('runs from the cached snapshot without an error banner when opened offline', async () => {
    saveFamilySnapshot(localStorage, 'user-1', {
      familyId: 'fam-1',
      familyName: 'Fam',
      familyInviteCode: 'ABCDEFGH',
      familyOwnerId: 'user-1',
      familyItemLimit: 50,
      familyMembers: [{ user_id: 'user-1', display_name: 'Me', image_url: null, role: 'moderator' }],
      items: [makeItem({ id: 'cached-1', name: 'Milk' })],
    })
    goOffline()

    mocks.db = createFakeDb()
    mocks.routerReplace = vi.fn()
    // The membership fetch dies at the network layer, like a dead connection.
    mocks.db.handlers['family_members.select'] = () => ({
      data: null,
      error: { message: 'TypeError: Failed to fetch' },
    })

    const wrapper = trackMount(HomeView, { shallow: true })
    await flushPromises()
    await flushPromises()

    expect(wrapper.findComponent(ErrorModal).props('message')).toBe('')
    expect(listedItems(wrapper)).toHaveLength(1)
    expect(listedItems(wrapper)[0].id).toBe('cached-1')
    expect(mocks.routerReplace).not.toHaveBeenCalled()
  })
})

// The device can lose connectivity while navigator.onLine still reports true
// (common in the Android WebView). A live write then fails with a raw
// "TypeError: Failed to fetch"; these must be treated exactly like offline —
// keep the optimistic state, queue the write, show no error modal. These tests
// deliberately stay in the default online state (no goOnline(): that dispatches
// an 'online' event whose handleBackOnline reload would clobber the optimistic
// row we are asserting on) — only the DB handler fails.
describe('network failure while reported online', () => {
  const fetchError = () => ({ data: null, error: { message: 'TypeError: Failed to fetch' } })

  function anyErrorModalShown(wrapper) {
    return wrapper.findAllComponents(ErrorModal).some((m) => m.props('message'))
  }

  it('keeps the added item and queues it when the insert fails at the network layer', async () => {
    const wrapper = await mountHome()
    mocks.db.handlers['shopping_list_items.insert'] = fetchError

    await submitAdd(wrapper, 'Milk', 2)

    expect(listedItems(wrapper)).toHaveLength(1)
    expect(anyErrorModalShown(wrapper)).toBe(false)
    const queue = loadOfflineQueue(localStorage, 'user-1')
    expect(queue).toHaveLength(1)
    expect(queue[0].kind).toBe('insert')
  })

  it('keeps the checkbox flipped and queues it when the toggle fails at the network layer', async () => {
    const existing = makeItem({ id: 'item-1' })
    const wrapper = await mountHome({ items: [existing] })
    mocks.db.handlers['shopping_list_items.update'] = fetchError

    wrapper.findComponent(ShoppingList).vm.$emit('toggle', listedItems(wrapper)[0])
    await flushPromises()

    expect(listedItems(wrapper)[0].checked).toBe(true)
    expect(anyErrorModalShown(wrapper)).toBe(false)
    const queue = loadOfflineQueue(localStorage, 'user-1')
    expect(queue).toEqual([{ kind: 'update', id: 'item-1', patch: { checked: true } }])
  })

  it('keeps the row removed and queues it when the delete fails at the network layer', async () => {
    const existing = makeItem({ id: 'item-1' })
    const wrapper = await mountHome({ items: [existing] })
    mocks.db.handlers['shopping_list_items.delete'] = fetchError

    wrapper.findComponent(ShoppingList).vm.$emit('delete', listedItems(wrapper)[0])
    await flushPromises()

    expect(listedItems(wrapper)).toHaveLength(0)
    expect(anyErrorModalShown(wrapper)).toBe(false)
    const queue = loadOfflineQueue(localStorage, 'user-1')
    expect(queue).toEqual([{ kind: 'delete', id: 'item-1' }])
  })

  it('shows no error modal when the initial list fetch fails at the network layer', async () => {
    mocks.db = createFakeDb()
    mocks.routerReplace = vi.fn()
    // Membership and header resolve, but the items fetch dies at the network.
    mocks.db.handlers['family_members.select'] = (q) =>
      q.wantSingle === 'maybe'
        ? { data: { family_id: 'fam-1' }, error: null }
        : { data: [{ user_id: 'user-1', display_name: 'Me', image_url: null, role: 'moderator' }], error: null }
    mocks.db.handlers['families.select'] = () => ({
      data: { name: 'Fam', invite_code: 'ABCDEFGH', created_by: 'user-1', max_items_per_member: 50 },
      error: null,
    })
    mocks.db.handlers['shopping_list_items.select'] = fetchError

    const wrapper = trackMount(HomeView, { shallow: true })
    await flushPromises()
    await flushPromises()

    expect(anyErrorModalShown(wrapper)).toBe(false)
  })
})

// On native, the window 'online' event can fail to fire; the Capacitor
// connectivity signal is what reliably reports reconnection. Queued writes must
// flush on that signal alone — otherwise (the reported bug) they only sync on an
// app restart, so other clients never see them.
describe('reliable reconnect via connectivity signal', () => {
  it('flushes queued writes on the connectivity reconnect edge, with no window online event', async () => {
    const wrapper = await mountHome()

    // Reliable native offline (navigator may still claim online).
    __setOnlineForTest(false)
    await submitAdd(wrapper, 'Milk', 2)
    expect(loadOfflineQueue(localStorage, 'user-1')).toHaveLength(1)
    expect(mocks.db.calls.some((q) => q.op === 'insert')).toBe(false)

    // Server accepts the replayed insert; the refetch converges the list.
    const serverRow = makeItem({ id: 'srv', name: 'Milk', quantity: 2 })
    mocks.db.handlers['shopping_list_items.insert'] = (q) => {
      serverRow.id = q.payload.id
      return { data: q.payload, error: null }
    }
    mocks.db.handlers['shopping_list_items.select'] = (q) => ({
      data: [serverRow].filter((i) => i.checked === q.filters.checked),
      error: null,
    })

    // Connectivity restored — the native edge, not a window 'online' event.
    __setOnlineForTest(true)
    await flushPromises()

    expect(mocks.db.calls.some((q) => q.op === 'insert')).toBe(true)
    expect(loadOfflineQueue(localStorage, 'user-1')).toHaveLength(0)
  })
})
