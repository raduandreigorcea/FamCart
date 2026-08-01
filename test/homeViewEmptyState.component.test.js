// @vitest-environment happy-dom
//
// The empty list has two opposite readings: "All bought" for a family that
// shops, "Nothing here yet" for one starting out. Which one is right depends on
// purchase history, and that query is deliberately not awaited so the rows can
// paint first. The cost was that an empty list rendered the beginner copy and
// then corrected itself to "All bought" a moment later — most reliably when
// switching families, where the stats are cleared and the skeleton comes down
// before the refetch is even issued.
//
// These pin the rule: never show the empty state until it can be answered, and
// never answer it wrongly.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import HomeView from '../src/views/HomeView.vue'
import ShoppingList from '../src/components/ShoppingList.vue'
import { createFakeDb } from './support/fakeSupabase.js'
import { saveFamilySnapshot } from '../src/lib/familyCache'
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

const BOUGHT = [{ name: 'Lapte', maker: null, purchased_at: '2026-07-01T10:00:00Z' }]

const mountedWrappers = []

// `history` is a function so each call to purchase_history can be answered
// differently — the point of most of these tests is the window before it lands.
async function mountHome({ items = [], history = () => ({ data: [], error: null }) } = {}) {
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
  mocks.db.handlers['shopping_list_items.select'] = () => ({ data: items, error: null })
  mocks.db.handlers['purchase_history.select'] = history

  const wrapper = mount(HomeView, { shallow: true })
  mountedWrappers.push(wrapper)
  await flushPromises()
  await flushPromises()
  return wrapper
}

const list = (wrapper) => wrapper.findComponent(ShoppingList)
const showEmpty = (wrapper) => list(wrapper).props('showEmpty')
const hasShopped = (wrapper) => list(wrapper).props('hasShopped')

// A history query that never settles, so the pre-answer window can be inspected.
const pending = () => () => new Promise(() => {})

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  localStorage.clear()
  __setOnlineForTest(true)
})

afterEach(() => {
  while (mountedWrappers.length) mountedWrappers.pop().unmount()
  __setOnlineForTest(null)
  vi.restoreAllMocks()
})

describe('the empty list', () => {
  it('says nothing at all while it still cannot tell which is true', async () => {
    const wrapper = await mountHome({ history: pending() })

    // This is the regression: before, showEmpty was already true here and the
    // list rendered "Nothing here yet" purely because the stats had not arrived.
    expect(showEmpty(wrapper)).toBe(false)
  })

  it('reads as finished once the history says the family has shopped', async () => {
    const wrapper = await mountHome({ history: () => ({ data: BOUGHT, error: null }) })

    expect(showEmpty(wrapper)).toBe(true)
    expect(hasShopped(wrapper)).toBe(true)
  })

  it('reads as a beginning once the history confirms there is none', async () => {
    const wrapper = await mountHome({ history: () => ({ data: [], error: null }) })

    expect(showEmpty(wrapper)).toBe(true)
    expect(hasShopped(wrapper)).toBe(false)
  })

  // A history we could not read is not a family that never shopped — but it is
  // not a reason to hold a blank screen forever either.
  it('gives up waiting when the history query fails', async () => {
    const wrapper = await mountHome({
      history: () => ({ data: null, error: { message: 'boom' } }),
    })

    expect(showEmpty(wrapper)).toBe(true)
  })

  it('gives up waiting when offline, where the answer is never coming', async () => {
    __setOnlineForTest(false)
    const wrapper = await mountHome({ history: pending() })

    expect(showEmpty(wrapper)).toBe(true)
  })

  // Offline the history cannot be fetched at all, so the cached snapshot holds
  // the only answer there is. Without it a family that shops every week opens
  // their empty list to "Nothing here yet" every time they lose signal.
  it('trusts the cached answer offline rather than claiming a fresh start', async () => {
    saveFamilySnapshot(localStorage, 'user-1', {
      familyId: 'fam-1',
      familyName: 'Fam',
      familyInviteCode: 'ABCDEFGH',
      familyOwnerId: 'user-1',
      familyItemLimit: 50,
      familyEmoji: '',
      familyMembers: [],
      items: [],
      hasShopped: true,
    })
    __setOnlineForTest(false)

    const wrapper = await mountHome({ history: pending() })

    expect(showEmpty(wrapper)).toBe(true)
    expect(hasShopped(wrapper)).toBe(true)
  })

  // The other half of the bug: a first-ever checkout empties the list while the
  // history refetch is still in flight, so the stats are momentarily empty and
  // the screen used to claim the family had never bought anything — right after
  // watching them buy something.
  it('says "all bought" the moment a checkout empties the list', async () => {
    let call = 0
    const wrapper = await mountHome({
      items: [{ id: 'i1', family_id: 'fam-1', name: 'Lapte', quantity: 1, checked: true, added_by: 'user-1' }],
      // First load: no history yet. The post-checkout refetch never settles, so
      // the assertion lands squarely inside the old flash window.
      history: () => (call++ === 0 ? { data: [], error: null } : new Promise(() => {})),
    })
    mocks.db.handlers['rpc.buy_items'] = () => ({ data: 1, error: null })

    expect(hasShopped(wrapper)).toBe(false)

    list(wrapper).vm.$emit('checkout', ['i1'])
    await flushPromises()

    expect(showEmpty(wrapper)).toBe(true)
    expect(hasShopped(wrapper)).toBe(true)
  })
})
