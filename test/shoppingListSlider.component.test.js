// @vitest-environment happy-dom
//
// Component test for the slide-to-checkout bar in ShoppingList: a pointer
// click must not check out (sliding is the point), a completed drag and a
// keyboard activation must, and a short drag snaps back doing nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ShoppingList from '../src/components/ShoppingList.vue'

const items = () => [
  { id: 'a', name: 'Milk', checked: false, quantity: 1 },
  { id: 'b', name: 'Bread', checked: true, quantity: 1 },
  { id: 'c', name: 'Eggs', checked: true, quantity: 2 },
]

// Bar geometry is 0 in happy-dom; give the track and thumb real sizes so the
// drag math has travel to work with (maxTravel = 480 - 46 - 2*4 = 426).
function sizeBar(wrapper) {
  Object.defineProperty(wrapper.find('.buy-bar').element, 'clientWidth', {
    value: 480,
    configurable: true,
  })
  Object.defineProperty(wrapper.find('.buy-bar__thumb').element, 'offsetWidth', {
    value: 46,
    configurable: true,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('slide-to-checkout bar', () => {
  it('does not check out on a plain pointer click', async () => {
    const wrapper = mount(ShoppingList, { props: { items: items() } })
    await wrapper.find('.buy-bar__thumb').trigger('click', { detail: 1 })
    vi.runAllTimers()
    expect(wrapper.emitted('checkout')).toBeUndefined()
  })

  it('checks out on keyboard activation (click with detail 0)', async () => {
    const wrapper = mount(ShoppingList, { props: { items: items() } })
    await wrapper.find('.buy-bar__thumb').trigger('click', { detail: 0 })
    vi.runAllTimers()
    expect(wrapper.emitted('checkout')).toHaveLength(1)
    expect(wrapper.emitted('checkout')[0][0]).toEqual(['b', 'c'])
  })

  it('checks out when the thumb is dragged past the threshold', async () => {
    const wrapper = mount(ShoppingList, { props: { items: items() } })
    sizeBar(wrapper)
    const thumb = wrapper.find('.buy-bar__thumb')

    await thumb.trigger('pointerdown', { pointerId: 1, clientX: 10 })
    await thumb.trigger('pointermove', { pointerId: 1, clientX: 420 }) // 410px of 426 travel
    await thumb.trigger('pointerup', { pointerId: 1, clientX: 420 })
    vi.runAllTimers()

    expect(wrapper.emitted('checkout')).toHaveLength(1)
    expect(wrapper.emitted('checkout')[0][0]).toEqual(['b', 'c'])
  })

  it('snaps back without checking out when released early', async () => {
    const wrapper = mount(ShoppingList, { props: { items: items() } })
    sizeBar(wrapper)
    const thumb = wrapper.find('.buy-bar__thumb')

    await thumb.trigger('pointerdown', { pointerId: 1, clientX: 10 })
    await thumb.trigger('pointermove', { pointerId: 1, clientX: 100 }) // 90px of 426 travel
    await thumb.trigger('pointerup', { pointerId: 1, clientX: 100 })
    vi.runAllTimers()

    expect(wrapper.emitted('checkout')).toBeUndefined()
    expect(thumb.attributes('style')).toContain('translateX(0px)')
  })

  it('clamps the drag inside the track', async () => {
    const wrapper = mount(ShoppingList, { props: { items: items() } })
    sizeBar(wrapper)
    const thumb = wrapper.find('.buy-bar__thumb')

    await thumb.trigger('pointerdown', { pointerId: 1, clientX: 10 })
    await thumb.trigger('pointermove', { pointerId: 1, clientX: 2000 })
    expect(thumb.attributes('style')).toContain('translateX(426px)')

    await thumb.trigger('pointermove', { pointerId: 1, clientX: -2000 })
    expect(thumb.attributes('style')).toContain('translateX(0px)')
  })
})
