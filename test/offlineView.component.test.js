// @vitest-environment happy-dom
//
// The offline screen must recover on its own the moment connectivity returns
// (and via a manual retry), handing control back to the router guard.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import OfflineView from '../src/views/OfflineView.vue'
import { __setOnlineForTest } from '../src/lib/connectivity'

const mocks = vi.hoisted(() => ({ replace: () => {} }))

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: (...a) => mocks.replace(...a) }),
}))

const wrappers = []
function mountOffline() {
  const w = mount(OfflineView)
  wrappers.push(w)
  return w
}

beforeEach(() => {
  mocks.replace = vi.fn().mockResolvedValue(undefined)
  __setOnlineForTest(false)
})

afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
  __setOnlineForTest(true)
  vi.restoreAllMocks()
})

describe('OfflineView', () => {
  it('navigates home automatically when connectivity is restored', async () => {
    mountOffline()
    expect(mocks.replace).not.toHaveBeenCalled()

    __setOnlineForTest(true) // reconnect edge
    await flushPromises()

    expect(mocks.replace).toHaveBeenCalledWith('/')
  })

  it('retries and navigates home when the connection is back', async () => {
    __setOnlineForTest(true) // online by the time the user taps retry
    const wrapper = mountOffline()

    await wrapper.find('button').trigger('click')
    await flushPromises()

    expect(mocks.replace).toHaveBeenCalledWith('/')
  })

  it('stops listening for reconnect after unmount', async () => {
    const wrapper = mountOffline()
    wrapper.unmount()
    wrappers.pop()

    __setOnlineForTest(true)
    await flushPromises()

    expect(mocks.replace).not.toHaveBeenCalled()
  })
})
