// @vitest-environment happy-dom
//
// The empty list has two opposite readings: "All bought" for a household that
// shops, "Nothing here yet" for one starting out. Which one is right depends on
// purchase history, and that query is deliberately not awaited so the rows can
// paint first. The cost was that an empty list rendered the beginner copy and
// then corrected itself to "All bought" a moment later — most reliably when
// switching households, where the stats are cleared and the skeleton comes down
// before the refetch is even issued.
//
// These pin the rule: never show the empty state until it can be answered, and
// never answer it wrongly.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import HomeView from '../src/views/HomeView.vue'
import ShoppingList from '../src/components/ShoppingList.vue'
import { createFakeDb } from './support/fakeSupabase.js'
import { saveHouseholdSnapshot } from '../src/lib/householdCache'
import { __setOnlineForTest } from '../src/lib/connectivity'

const mocks = vi.hoisted(() => ({ db: null, routerReplace: () => {} }))

vi.mock('../src/supabase', () => ({ useSupabase: () => mocks.db }))
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

const BOUGHT = [{ name: 'Lapte', maker: null, purchased_at: '2026-07-01T10:00:00Z' }]

const mountedWrappers = []

// `history` is a function so each call to purchase_history can be answered
// differently — the point of most of these tests is the window before it lands.
//
// `members` overrides the household lookup, so a test can hold the whole boot
// sequence open and inspect what a returning user sees before any of it lands.
async function mountHome({
  items = [],
  history = () => ({ data: [], error: null }),
  members = null,
} = {}) {
  mocks.db = createFakeDb()
  mocks.routerReplace = vi.fn()
  mocks.db.handlers['household_members.select'] =
    members ??
    ((q) =>
      q.filters.user_id
        ? { data: [{ household_id: 'fam-1', households: { id: 'fam-1', name: 'Fam' } }], error: null }
        : { data: [{ user_id: 'user-1', display_name: 'Test User', image_url: null, role: 'moderator' }], error: null })
  mocks.db.handlers['households.select'] = () => ({
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

  it('reads as finished once the history says the household has shopped', async () => {
    const wrapper = await mountHome({ history: () => ({ data: BOUGHT, error: null }) })

    expect(showEmpty(wrapper)).toBe(true)
    expect(hasShopped(wrapper)).toBe(true)
  })

  it('reads as a beginning once the history confirms there is none', async () => {
    const wrapper = await mountHome({ history: () => ({ data: [], error: null }) })

    expect(showEmpty(wrapper)).toBe(true)
    expect(hasShopped(wrapper)).toBe(false)
  })

  // A history we could not read is not a household that never shopped — but it is
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
  // the only answer there is. Without it a household that shops every week opens
  // their empty list to "Nothing here yet" every time they lose signal.
  it('trusts the cached answer offline rather than claiming a fresh start', async () => {
    saveHouseholdSnapshot(localStorage, 'user-1', {
      householdId: 'fam-1',
      householdName: 'Fam',
      householdInviteCode: 'ABCDEFGH',
      householdOwnerId: 'user-1',
      householdItemLimit: 50,
      householdEmoji: '',
      householdMembers: [],
      items: [],
      hasShopped: true,
    })
    __setOnlineForTest(false)

    const wrapper = await mountHome({ history: pending() })

    expect(showEmpty(wrapper)).toBe(true)
    expect(hasShopped(wrapper)).toBe(true)
  })

  // The cached answer is not an offline consolation prize. Online it is still the
  // answer, and waiting for purchase_history to restate it is what left a
  // returning user staring at a blank column on every cold open: the skeleton
  // comes down on the painted frame, and nothing replaced it until the query
  // landed several round trips later.
  it('answers from the cache online too, without waiting for the history', async () => {
    saveHouseholdSnapshot(localStorage, 'user-1', {
      householdId: 'fam-1',
      householdName: 'Fam',
      householdInviteCode: 'ABCDEFGH',
      householdOwnerId: 'user-1',
      householdItemLimit: 50,
      householdEmoji: '',
      householdMembers: [],
      items: [],
      hasShopped: true,
    })

    const wrapper = await mountHome({ history: pending() })

    expect(showEmpty(wrapper)).toBe(true)
    expect(hasShopped(wrapper)).toBe(true)
  })

  // And not only once the boot finishes. A painted snapshot is a real list and an
  // empty one is a real answer — the same reading the skeleton already goes by,
  // which is why holding the message back until hasInitialized left a gap with
  // nothing in it at all.
  it('says so on the painted frame, before the boot sequence has landed', async () => {
    saveHouseholdSnapshot(localStorage, 'user-1', {
      householdId: 'fam-1',
      householdName: 'Fam',
      householdInviteCode: 'ABCDEFGH',
      householdOwnerId: 'user-1',
      householdItemLimit: 50,
      householdEmoji: '',
      householdMembers: [],
      items: [],
      hasShopped: true,
    })

    // Nothing about the boot ever resolves: no households, no header, no items.
    const wrapper = await mountHome({ members: () => new Promise(() => {}), history: pending() })

    expect(showEmpty(wrapper)).toBe(true)
    expect(hasShopped(wrapper)).toBe(true)
    // And no skeleton over it, which would be the same blank screen wearing a
    // different coat.
    expect(list(wrapper).props('loading')).toBe(false)
  })

  // The snapshot is keyed to the USER, not the household. Creating or joining a
  // household makes it active immediately, but the snapshot still describes the
  // previous one — so its cached "this household has shopped" answer was being
  // applied to a household that has bought nothing, and a brand-new list opened on
  // "All bought". Switching households cleared it; arriving at a new one did not.
  it('does not carry the cached answer over to a different household', async () => {
    saveHouseholdSnapshot(localStorage, 'user-1', {
      householdId: 'fam-old',            // a household that HAS shopped
      householdName: 'Old Fam',
      householdInviteCode: 'ABCDEFGH',
      householdOwnerId: 'user-1',
      householdItemLimit: 50,
      householdEmoji: '',
      householdMembers: [],
      items: [],
      hasShopped: true,
    })

    // The active household resolves to fam-1, which has no purchase history.
    const wrapper = await mountHome({ history: () => ({ data: [], error: null }) })

    expect(showEmpty(wrapper)).toBe(true)
    expect(hasShopped(wrapper)).toBe(false)
  })

  // The words now arrive before the regulars do, so something has to stand in
  // the gap between them.
  describe('the regulars underneath', () => {
    const restartLoading = (wrapper) => list(wrapper).props('suggestedProductsLoading')

    it('holds their space while the history that ranks them is in flight', async () => {
      saveHouseholdSnapshot(localStorage, 'user-1', {
        householdId: 'fam-1',
        householdName: 'Fam',
        householdInviteCode: 'ABCDEFGH',
        householdOwnerId: 'user-1',
        householdItemLimit: 50,
        householdEmoji: '',
        householdMembers: [],
        items: [],
        hasShopped: true,
      })

      const wrapper = await mountHome({ history: pending() })

      expect(showEmpty(wrapper)).toBe(true)
      expect(restartLoading(wrapper)).toBe(true)
    })

    it('stops holding it once the history has answered', async () => {
      const wrapper = await mountHome({ history: () => ({ data: BOUGHT, error: null }) })

      expect(restartLoading(wrapper)).toBe(false)
      expect(list(wrapper).props('suggestedProducts').length).toBeGreaterThan(0)
    })

    // Nothing is coming for a household that has never bought anything, so there
    // is no space to hold.
    it('holds nothing for a household with no history at all', async () => {
      const wrapper = await mountHome({ history: pending() })

      expect(restartLoading(wrapper)).toBe(false)
    })
  })

  // The other half of the bug: a first-ever checkout empties the list while the
  // history refetch is still in flight, so the stats are momentarily empty and
  // the screen used to claim the household had never bought anything — right after
  // watching them buy something.
  it('says "all bought" the moment a checkout empties the list', async () => {
    let call = 0
    const wrapper = await mountHome({
      items: [{ id: 'i1', household_id: 'fam-1', name: 'Lapte', quantity: 1, checked: true, added_by: 'user-1' }],
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
