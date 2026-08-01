// @vitest-environment happy-dom
//
// A throw during render unmounts the tree. Without a boundary that leaves a
// white page — the one failure mode where the app tells the user nothing at
// all — and the only signal is a Sentry event nobody is watching in the moment.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { h } from 'vue'
import App from '../src/App.vue'

const captured = vi.hoisted(() => ({ calls: [] }))

vi.mock('@sentry/vue', () => ({
  captureException: (e) => captured.calls.push(e),
}))

// A RouterView stand-in that throws on render, which is what a broken view does.
const Exploding = { setup: () => () => { throw new Error('render exploded') } }
const Fine = { setup: () => () => h('div', { class: 'ok' }, 'fine') }

vi.mock('vue-router', () => ({
  useRouter: () => ({ isReady: () => Promise.resolve() }),
}))

function mountApp(view) {
  return mount(App, {
    global: { stubs: { RouterView: view, AppSplash: true } },
  })
}

beforeEach(() => {
  captured.calls.length = 0
  // Vue logs handled component errors; the boundary is what this asserts on.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the error boundary', () => {
  it('stays out of the way while the app renders', async () => {
    const wrapper = mountApp(Fine)
    await flushPromises()

    expect(wrapper.find('.ok').exists()).toBe(true)
    expect(wrapper.find('.crash').exists()).toBe(false)
  })

  it('shows a recoverable screen instead of a blank page when a view throws', async () => {
    const wrapper = mountApp(Exploding)
    await flushPromises()

    expect(wrapper.find('.crash').exists()).toBe(true)
    expect(wrapper.find('.crash__title').text()).toBe('Something went wrong')
    // A reload is the only honest offer: Vue cannot re-render a component that
    // has already failed, so a retry button would do nothing.
    expect(wrapper.text()).toContain('Reload')
  })

  it('still reports the error, since returning false stops it propagating', async () => {
    mountApp(Exploding)
    await flushPromises()

    expect(captured.calls).toHaveLength(1)
    expect(captured.calls[0].message).toBe('render exploded')
  })
})
