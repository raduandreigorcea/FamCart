// @vitest-environment happy-dom
//
// Tests for the useHouseholdRealtime composable's channel handlers: echo dedupe on
// INSERT (optimistic rows share ids with their realtime echo), merge-or-reload
// on UPDATE, removal on DELETE, and the household-deleted teardown.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { useHouseholdRealtime } from '../src/lib/householdRealtime'

// Fake realtime client: channels record their postgres_changes listeners so
// tests can fire payloads at them directly.
function createRealtimeFakeDb() {
  const db = {
    channels: [],
    removedChannels: [],
    channel(name) {
      const chan = {
        name,
        listeners: [],
        on(_type, filter, callback) {
          chan.listeners.push({ filter, callback })
          return chan
        },
        subscribe(statusCallback) {
          chan.statusCallback = statusCallback
          statusCallback('SUBSCRIBED')
          return chan
        },
        emit(event, payload) {
          for (const listener of chan.listeners) {
            if (listener.filter.event === event || listener.filter.event === '*') {
              listener.callback(payload)
            }
          }
        },
      }
      db.channels.push(chan)
      return chan
    },
    removeChannel(chan) {
      db.removedChannels.push(chan)
    },
    realtime: { setAuth: vi.fn(), connect: vi.fn(), disconnect: vi.fn() },
  }
  return db
}

async function mountRealtime() {
  const db = createRealtimeFakeDb()
  const ctx = {
    db,
    householdId: ref('fam-1'),
    hasInitialized: ref(true),
    items: ref([]),
    householdMembers: ref([]),
    loadItems: vi.fn(async () => {}),
    loadHouseholdHeader: vi.fn(async () => {}),
    refreshMembershipOrRedirect: vi.fn(async () => {}),
    onHouseholdDeleted: vi.fn(),
  }

  let api
  const Harness = defineComponent({
    setup() {
      api = useHouseholdRealtime(ctx)
      return () => null
    },
  })
  const wrapper = mount(Harness)
  await api.setupRealtimeSubscriptions()
  await flushPromises()

  const channelByName = (prefix) => db.channels.find((c) => c.name.startsWith(prefix))
  return {
    ...ctx,
    api,
    wrapper,
    listChannel: channelByName('shopping-list:'),
    membersChannel: channelByName('household-members:'),
    householdChannel: channelByName('household:'),
  }
}

function row(overrides = {}) {
  return {
    id: 'item-1',
    name: 'Milk',
    quantity: 1,
    checked: false,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('shopping list channel', () => {
  it('adds INSERTed rows sorted by created_at and ignores echoes of known ids', async () => {
    const { listChannel, items, wrapper } = await mountRealtime()

    listChannel.emit('INSERT', { eventType: 'INSERT', new: row({ id: 'b', created_at: '2026-01-02T00:00:00.000Z' }) })
    listChannel.emit('INSERT', { eventType: 'INSERT', new: row({ id: 'a', created_at: '2026-01-01T00:00:00.000Z' }) })
    expect(items.value.map((i) => i.id)).toEqual(['a', 'b'])

    // The realtime echo of an optimistic insert reuses the same id — no duplicate.
    listChannel.emit('INSERT', { eventType: 'INSERT', new: row({ id: 'a', created_at: '2026-01-01T00:00:00.000Z' }) })
    expect(items.value).toHaveLength(2)

    wrapper.unmount()
  })

  it('merges UPDATEs into known rows and reloads for unknown rows', async () => {
    const { listChannel, items, loadItems, wrapper } = await mountRealtime()
    items.value = [row({ id: 'a', quantity: 1 })]
    loadItems.mockClear()

    listChannel.emit('UPDATE', { eventType: 'UPDATE', new: row({ id: 'a', quantity: 7 }) })
    expect(items.value[0].quantity).toBe(7)
    expect(loadItems).not.toHaveBeenCalled()

    listChannel.emit('UPDATE', { eventType: 'UPDATE', new: row({ id: 'unknown' }) })
    expect(loadItems).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it('removes DELETEd rows by id and falls back to a reload for minimal payloads', async () => {
    const { listChannel, items, loadItems, wrapper } = await mountRealtime()
    items.value = [row({ id: 'a' }), row({ id: 'b' })]
    loadItems.mockClear()

    listChannel.emit('DELETE', { eventType: 'DELETE', old: { id: 'a' } })
    expect(items.value.map((i) => i.id)).toEqual(['b'])
    expect(loadItems).not.toHaveBeenCalled()

    listChannel.emit('DELETE', { eventType: 'DELETE', old: {} })
    expect(loadItems).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })
})

describe('members channel', () => {
  it('removes the member on DELETE and rechecks own membership', async () => {
    const { membersChannel, householdMembers, refreshMembershipOrRedirect, wrapper } = await mountRealtime()
    householdMembers.value = [
      { user_id: 'user-1', display_name: 'Me' },
      { user_id: 'user-2', display_name: 'Them' },
    ]

    membersChannel.emit('DELETE', { eventType: 'DELETE', old: { user_id: 'user-2' } })
    expect(householdMembers.value.map((m) => m.user_id)).toEqual(['user-1'])
    expect(refreshMembershipOrRedirect).toHaveBeenCalled()

    wrapper.unmount()
  })
})

describe('household channel', () => {
  it('tears down subscriptions and signals the caller when the household is deleted', async () => {
    const { householdChannel, db, onHouseholdDeleted, wrapper } = await mountRealtime()

    householdChannel.emit('DELETE', { eventType: 'DELETE', old: { id: 'fam-1' } })
    expect(onHouseholdDeleted).toHaveBeenCalled()
    expect(db.removedChannels).toHaveLength(3)

    wrapper.unmount()
  })
})

describe('refresh coalescing', () => {
  // The coalescing window is 250ms and these tests measure it rather than mock
  // it away, so they wait it out on real timers. Comfortably past the window,
  // still short enough not to be felt in the suite.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 400))

  it('collapses three channels resubscribing into one fetch of each half', async () => {
    const { listChannel, membersChannel, householdChannel, loadItems, loadHouseholdHeader, wrapper } =
      await mountRealtime()
    // Let the refresh the initial subscribe asked for run to completion, so what
    // is measured below is only what the reconnect itself costs.
    await settle()
    loadItems.mockClear()
    loadHouseholdHeader.mockClear()

    // What a reconnect looks like from here: all three acknowledgements land
    // within a few milliseconds of each other. Before coalescing this was one
    // loadItems and two loadHouseholdHeaders, on top of the pair the reconnect
    // had already issued itself.
    listChannel.statusCallback('SUBSCRIBED')
    membersChannel.statusCallback('SUBSCRIBED')
    householdChannel.statusCallback('SUBSCRIBED')
    await settle()

    expect(loadItems).toHaveBeenCalledTimes(1)
    expect(loadHouseholdHeader).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it('asks only for the half the resubscribed channel is responsible for', async () => {
    const { membersChannel, loadItems, loadHouseholdHeader, wrapper } = await mountRealtime()
    await settle()
    loadItems.mockClear()
    loadHouseholdHeader.mockClear()

    // The roster came back; the item list never went anywhere.
    membersChannel.statusCallback('SUBSCRIBED')
    await settle()

    expect(loadHouseholdHeader).toHaveBeenCalledTimes(1)
    expect(loadItems).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('drops a refresh still inside its window when the view goes away', async () => {
    const { listChannel, loadItems, wrapper } = await mountRealtime()
    await settle()
    loadItems.mockClear()

    listChannel.statusCallback('SUBSCRIBED')
    wrapper.unmount()
    await settle()

    expect(loadItems).not.toHaveBeenCalled()
  })
})

describe('channel health', () => {
  it('marks realtime unhealthy on CLOSED and healthy again on resubscribe', async () => {
    const { listChannel, api, wrapper } = await mountRealtime()
    expect(api.realtimeHealthy.value).toBe(true)

    listChannel.statusCallback('CLOSED')
    expect(api.realtimeHealthy.value).toBe(false)

    listChannel.statusCallback('SUBSCRIBED')
    expect(api.realtimeHealthy.value).toBe(true)

    wrapper.unmount()
  })
})
