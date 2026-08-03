// @vitest-environment happy-dom
//
// The snapshot is what a returning user sees before the network answers, so it
// has to be written back as the list changes. Writing it means stringifying the
// whole list into localStorage synchronously, and the watcher behind it is
// deep — so it used to run once per changed row, which during a checkout is
// once per item.
//
// It is coalesced onto the next tick now. That is only safe if the pending
// write still lands when the app goes away, which on a phone is the common
// case and is precisely when the next cold boot depends on it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import HomeView from '../src/views/HomeView.vue'
import ShoppingList from '../src/components/ShoppingList.vue'
import { createFakeDb } from './support/fakeSupabase.js'
import { loadFamilySnapshot } from '../src/lib/familyCache'
import { markTourSeen } from '../src/lib/onboarding'
import { __setOnlineForTest } from '../src/lib/connectivity'

const mocks = vi.hoisted(() => ({ db: null }))

vi.mock('../src/supabase', () => ({ useSupabase: () => mocks.db }))
vi.mock('vue-router', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }))
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
    useAuth: () => ({ userId: ref('user-1'), isLoaded: ref(true), getToken: ref(async () => 't') }),
    useUser: () => ({ user: ref(null) }),
  }
})

const item = (over = {}) => ({
  id: 'a',
  family_id: 'fam-1',
  name: 'Milk',
  quantity: 1,
  checked: false,
  added_by: 'user-1',
  created_at: '2026-01-01T00:00:00.000Z',
  ...over,
})

function seed(db, items) {
  db.handlers['profiles.upsert'] = () => ({ data: null, error: null })
  db.handlers['family_members.select'] = (q) =>
    q.filters.user_id
      ? { data: [{ family_id: 'fam-1', families: { name: 'Fam', emoji: '' } }], error: null }
      : { data: [{ user_id: 'user-1', role: 'moderator', profiles: { display_name: 'Me' } }], error: null }
  db.handlers['families.select'] = () => ({
    data: { name: 'Fam', invite_code: 'ABCD2345', created_by: 'user-1', max_items_per_member: 50, emoji: '' },
    error: null,
  })
  db.handlers['shopping_list_items.select'] = (q) => ({
    data: items.filter((i) => i.checked === q.filters.checked),
    error: null,
  })
  db.handlers['shopping_list_items.delete'] = () => ({ data: null, error: null })
  db.handlers['purchase_history.select'] = () => ({ data: [], error: null })
}

const wrappers = []
async function bootHome(items = [item()]) {
  mocks.db = createFakeDb()
  seed(mocks.db, items)
  const wrapper = mount(HomeView, { shallow: true })
  wrappers.push(wrapper)
  await flushPromises()
  await flushPromises()
  return wrapper
}

const stored = () => loadFamilySnapshot(localStorage, 'user-1')
const tick = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  localStorage.clear()
  markTourSeen(localStorage)
  __setOnlineForTest(true)
})

afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
  vi.restoreAllMocks()
})

describe('persisting the family snapshot', () => {
  it('writes one as soon as the first load finishes', async () => {
    await bootHome()
    expect(stored()?.items.map((i) => i.id)).toEqual(['a'])
  })

  it('writes changes back once the dust settles', async () => {
    const wrapper = await bootHome()

    wrapper.findComponent(ShoppingList).vm.$emit('delete', item())
    await flushPromises()
    await tick()

    expect(stored()?.items).toHaveLength(0)
  })

  it('flushes a pending write when the app is backgrounded', async () => {
    const wrapper = await bootHome()

    wrapper.findComponent(ShoppingList).vm.$emit('delete', item())
    await flushPromises()

    // Hidden before the deferred write got its turn.
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(stored()?.items).toHaveLength(0)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  it('flushes a pending write when the page goes away', async () => {
    const wrapper = await bootHome()

    wrapper.findComponent(ShoppingList).vm.$emit('delete', item())
    await flushPromises()

    window.dispatchEvent(new Event('pagehide'))

    expect(stored()?.items).toHaveLength(0)
  })

  it('flushes a pending write when the view unmounts', async () => {
    const wrapper = await bootHome()

    wrapper.findComponent(ShoppingList).vm.$emit('delete', item())
    await flushPromises()

    wrappers.pop()
    wrapper.unmount()

    expect(stored()?.items).toHaveLength(0)
  })
})
