// @vitest-environment happy-dom
//
// The offline screen must recover the moment connectivity returns, both on its
// own and via the manual retry.
//
// Recovery is a full page load rather than a router navigation, and that is the
// whole point of these tests. This screen is only reached by starting the app
// with no connection, which means Clerk's script already failed to fetch — and
// Clerk does not retry, so isLoaded stays false for the life of the page. A
// client-side replace('/') would hand the router guard a session it can never
// verify; the guard waits out its Clerk timeout and sends the user straight back
// here. That was the bug: the retry spinner flashed and nothing happened.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import OfflineView from '../src/views/OfflineView.vue'
import { __setOnlineForTest } from '../src/lib/connectivity'

const wrappers = []
function mountOffline() {
  const w = mount(OfflineView)
  wrappers.push(w)
  return w
}

let assign

beforeEach(() => {
  // happy-dom's location is not configurable wholesale, but assign is spyable.
  assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {})
  __setOnlineForTest(false)
})

afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
  __setOnlineForTest(true)
  vi.restoreAllMocks()
})

describe('OfflineView', () => {
  it('reloads into the app automatically when connectivity is restored', async () => {
    mountOffline()
    expect(assign).not.toHaveBeenCalled()

    __setOnlineForTest(true) // reconnect edge
    await flushPromises()

    expect(assign).toHaveBeenCalledWith('/')
  })

  it('reloads into the app when the retry finds the connection back', async () => {
    __setOnlineForTest(true) // online by the time the user taps retry
    const wrapper = mountOffline()

    await wrapper.find('button').trigger('click')
    await flushPromises()

    expect(assign).toHaveBeenCalledWith('/')
  })

  // The spinner is cleared by the page going away, not before it. Clearing it
  // first is what made a successful retry read as "nothing happened".
  it('keeps the spinner up while the reload is in flight', async () => {
    __setOnlineForTest(true)
    const wrapper = mountOffline()

    await wrapper.find('button').trigger('click')
    await flushPromises()

    expect(wrapper.find('.offline-retry-spinner').exists()).toBe(true)
    expect(wrapper.find('button').attributes('disabled')).toBeDefined()
  })

  // refreshConnectivity() polls the OS rather than the cached ref, and on the
  // web that resolves through navigator.onLine — so __setOnlineForTest alone
  // cannot hold this path offline.
  it('shows the hint and stays put when the connection is still down', async () => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true })
    vi.useFakeTimers()
    const wrapper = mountOffline()

    wrapper.find('button').trigger('click')
    await vi.advanceTimersByTimeAsync(600)
    await flushPromises()

    expect(assign).not.toHaveBeenCalled()
    expect(wrapper.find('.offline-hint').exists()).toBe(true)

    vi.useRealTimers()
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true })
  })

  it('stops listening for reconnect after unmount', async () => {
    const wrapper = mountOffline()
    wrapper.unmount()
    wrappers.pop()

    __setOnlineForTest(true)
    await flushPromises()

    expect(assign).not.toHaveBeenCalled()
  })
})
