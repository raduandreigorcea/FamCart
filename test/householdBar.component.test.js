// @vitest-environment happy-dom
//
// The phone's household bar: which household, how much is left, and a stamp on
// nightly. It sticks to the top and shrinks once the list scrolls under it,
// which is driven by an IntersectionObserver on a sentinel above it -- so the
// observer is stubbed here and fired by hand.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import HouseholdBar from '../src/components/HouseholdBar.vue'
import { setLocale } from '../src/lib/i18n'

const channel = vi.hoisted(() => ({ nightly: false }))

vi.mock('../src/lib/appChannel', async (importOriginal) => ({
  ...(await importOriginal()),
  get IS_NIGHTLY() {
    return channel.nightly
  },
}))

let observers = []
class FakeObserver {
  constructor(callback) {
    this.callback = callback
    this.disconnect = vi.fn()
    observers.push(this)
  }
  observe() {}
  report(isIntersecting) {
    this.callback([{ isIntersecting }])
  }
}

const wrappers = []
function bar(props = {}) {
  const w = mount(HouseholdBar, {
    props: { emoji: '🏠', name: 'Popescu home', toBuy: 3, inCart: 1, ...props },
  })
  wrappers.push(w)
  return w
}

beforeEach(() => {
  channel.nightly = false
  observers = []
  vi.stubGlobal('IntersectionObserver', FakeObserver)
})

afterEach(async () => {
  while (wrappers.length) wrappers.pop().unmount()
  vi.unstubAllGlobals()
  await setLocale('en')
})

describe('HouseholdBar', () => {
  it('names the household and summarises the list', () => {
    const w = bar()
    expect(w.find('.household-bar__name').text()).toBe('Popescu home')
    expect(w.find('.household-bar__summary').text()).toBe('3 to buy · 1 in cart')
  })

  it('leaves the cart out while nothing is in it', () => {
    expect(bar({ inCart: 0 }).find('.household-bar__summary').text()).toBe('3 to buy')
  })

  it('leaves "0 to buy" out once everything is in the cart', () => {
    expect(bar({ toBuy: 0, inCart: 2 }).find('.household-bar__summary').text()).toBe('2 in cart')
    expect(bar({ toBuy: 0, inCart: 0 }).find('.household-bar__summary').text()).toBe('0 to buy')
  })

  it('fills the ring with the share already in the cart', () => {
    // pathLength is 100, so the offset is the share still to go.
    const fill = (props) => bar(props).find('.household-bar__ring-fill')
    expect(fill({ toBuy: 3, inCart: 1 }).attributes('stroke-dashoffset')).toBe('75')
    expect(fill({ toBuy: 0, inCart: 2 }).attributes('stroke-dashoffset')).toBe('0')
    // Empty draws nothing, not the dot a round cap leaves on a zero-length dash.
    expect(fill({ toBuy: 0, inCart: 0 }).classes()).toContain('household-bar__ring-fill--empty')
  })

  describe('sparks', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('throws them when the last thing goes in the cart, then clears them', async () => {
      const w = bar({ toBuy: 1, inCart: 3 })
      expect(w.find('.household-bar__sparks').exists()).toBe(false)

      await w.setProps({ toBuy: 0, inCart: 4 })
      expect(w.findAll('.household-bar__spark')).toHaveLength(10)
      expect(w.find('.household-bar__ring').classes()).toContain('household-bar__ring--done')

      vi.advanceTimersByTime(1000)
      await nextTick()
      expect(w.find('.household-bar__sparks').exists()).toBe(false)
    })

    it('stays quiet on a list that was already finished', async () => {
      const w = bar({ toBuy: 0, inCart: 4 })
      expect(w.find('.household-bar__sparks').exists()).toBe(false)
      // Still full, just bigger: not a new finish.
      await w.setProps({ toBuy: 0, inCart: 5 })
      expect(w.find('.household-bar__sparks').exists()).toBe(false)
    })

    it('stays quiet when the list empties', async () => {
      const w = bar({ toBuy: 1, inCart: 3 })
      await w.setProps({ toBuy: 0, inCart: 0 })
      expect(w.find('.household-bar__sparks').exists()).toBe(false)
    })
  })

  it('uses the Romanian plural forms', async () => {
    await setLocale('ro')
    expect(bar({ toBuy: 3, inCart: 0 }).find('.household-bar__summary').text()).toBe(
      '3 produse de luat',
    )
    expect(bar({ toBuy: 20, inCart: 0 }).find('.household-bar__summary').text()).toBe(
      '20 de produse de luat',
    )
  })

  it('asks for the household settings when tapped', async () => {
    const w = bar()
    await w.find('.household-bar__button').trigger('click')
    expect(w.emitted('open')).toHaveLength(1)
  })

  it('shrinks once the sentinel scrolls away, and grows back', async () => {
    const w = bar()
    const header = () => w.find('.household-bar')
    expect(header().classes()).not.toContain('household-bar--compact')

    observers[0].report(false)
    await nextTick()
    expect(header().classes()).toContain('household-bar--compact')

    observers[0].report(true)
    await nextTick()
    expect(header().classes()).not.toContain('household-bar--compact')
  })

  it('stops observing when it goes away', () => {
    const w = bar()
    wrappers.splice(wrappers.indexOf(w), 1)
    w.unmount()
    expect(observers[0].disconnect).toHaveBeenCalled()
  })

  it('still renders where IntersectionObserver does not exist', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    expect(bar().find('.household-bar').exists()).toBe(true)
  })

  it('stamps nightly builds only', () => {
    expect(bar().find('.channel-badge').exists()).toBe(false)
    channel.nightly = true
    expect(bar().find('.channel-badge').text()).toBe('NIGHTLY')
  })
})
