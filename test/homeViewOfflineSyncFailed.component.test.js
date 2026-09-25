// @vitest-environment happy-dom
//
// A write queued offline that the server later refuses for good is dropped, so
// one bad row can never wedge the queue. Dropping it is right; dropping it
// without a word is not. Only the reconnect handler used to say so, but most
// flushes happen elsewhere -- at boot, and inside every list refetch -- so the
// user's change usually vanished with nothing on screen.
import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import HomeView from '../src/views/HomeView.vue'
import ErrorModal from '../src/components/ErrorModal.vue'
import { createFakeDb } from './support/fakeSupabase.js'
import { enqueueOfflineMutation, hasQueuedOfflineMutations } from '../src/lib/offlineQueue'
import { __setOnlineForTest } from '../src/lib/connectivity'
import { markTourSeen } from '../src/lib/onboarding'
import { t } from '../src/lib/i18n'

const mocks = vi.hoisted(() => ({ db: null }))

vi.mock('../src/supabase', () => ({
  useSupabase: () => mocks.db,
  getCatalogSupabase: () => null,
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ replace: vi.fn() }) }))
vi.mock('../src/lib/listRealtime', () => ({
  useListRealtime: () => ({
    realtimeHealthy: { value: false },
    setupRealtimeSubscriptions: async () => {},
    cleanupRealtimeSubscriptions: () => {},
  }),
}))
vi.mock('@clerk/vue', async () => {
  const { ref } = await import('vue')
  return {
    useAuth: () => ({ userId: ref('user-1'), isLoaded: ref(true), getToken: ref(async () => 'token') }),
    useUser: () => ({ user: ref({ fullName: 'Test User', imageUrl: null }) }),
  }
})

let wrapper

beforeEach(() => {
  localStorage.clear()
  markTourSeen(localStorage)
  __setOnlineForTest(true)
  mocks.db = createFakeDb()
  mocks.db.handlers['list_members.select'] = (q) =>
    q.filters.user_id
      ? { data: [{ list_id: 'fam-1', lists: { name: 'Fam' } }], error: null }
      : { data: [{ user_id: 'user-1', role: 'moderator', profiles: { display_name: 'Test User' } }], error: null }
  mocks.db.handlers['lists.select'] = () => ({
    data: { name: 'Fam', invite_code: 'ABCDEFGH', created_by: 'user-1', max_items_per_member: 50 },
    error: null,
  })
  mocks.db.handlers['shopping_list_items.select'] = () => ({ data: [], error: null })
  mocks.db.handlers['purchase_history.select'] = () => ({ data: [], error: null })
})

afterEach(() => {
  wrapper?.unmount()
  __setOnlineForTest(null)
})

// Kept in this file because it is the same path: a reconnect is when a queued
// write gets replayed. The browser's 'online' event and lib/connectivity's
// reconnect used to both start the sync, so every reconnect ran it twice.
it('syncs once per reconnect', async () => {
  wrapper = mount(HomeView, { shallow: true })
  await flushPromises()
  await flushPromises()
  const listReads = () =>
    mocks.db.calls.filter((c) => c.table === 'shopping_list_items' && c.op === 'select').length
  const before = listReads()

  __setOnlineForTest(false)
  window.dispatchEvent(new Event('online'))
  __setOnlineForTest(true)
  await flushPromises()
  await flushPromises()

  // One sync is one loadItems, which reads the unchecked and checked halves.
  expect(listReads() - before).toBe(2)
})

it('tells the user when a queued offline change is refused at boot', async () => {
  enqueueOfflineMutation(localStorage, 'user-1', {
    kind: 'insert',
    id: 'row-1',
    row: { id: 'row-1', list_id: 'fam-1', name: 'Milk', quantity: 1, added_by: 'user-1' },
  })
  // A real rejection: the server answered, with a code.
  mocks.db.handlers['shopping_list_items.insert'] = () => ({
    data: null,
    error: { code: '23514', message: 'check constraint violated' },
  })

  wrapper = mount(HomeView, { shallow: true })
  await flushPromises()
  await flushPromises()

  expect(hasQueuedOfflineMutations(localStorage, 'user-1')).toBe(false)
  expect(wrapper.findComponent(ErrorModal).props('message')).toBe(t('error.offlineSyncFailed'))
})
