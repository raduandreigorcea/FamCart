// @vitest-environment happy-dom
//
// The counted strings on the list, which are the whole reason this app has a
// plural system rather than `n === 1 ? 'item' : 'items'`.
//
// Romanian is what breaks the ternary. It has three cardinal forms and picks
// between them by a rule English speakers do not carry around: 1 is "produs",
// 0 and 2-19 are "produse", and from 20 up it becomes "de produse" — and then
// 101 goes back to "produse". A binary check gets the 20 boundary wrong on
// every count above nineteen and reads as broken grammar to a native speaker.
// So the counts here are pinned per number, because the boundary is the part
// that regresses.
//
// The other thing worth pinning is that both counters count ROWS: "Grapes x3"
// is one thing to find and one thing in the cart. They used to disagree (rows
// above, units on the slider) and a header saying 1 over a slider saying 3 read
// as a bug.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ShoppingList from '../src/components/ShoppingList.vue'
import { setLocale } from '../src/lib/i18n'

// n rows, left to buy unless said otherwise.
const rows = (n, checked = false) =>
  Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    name: `Item ${i}`,
    checked,
    quantity: 1,
  }))
const cart = (n) => rows(n, true)

// One checked row holding n units, so rows and units disagree.
const units = (n) => [{ id: 'u', name: 'Grapes', checked: true, quantity: n }]

const toBuy = (n) => [{ id: 'a', name: 'Milk', checked: false, quantity: n }]

const wrappers = []
function list(items) {
  const w = mount(ShoppingList, { props: { items } })
  wrappers.push(w)
  return w
}

const metaLabel = (w) => w.find('.list-meta__label').text()
const barLabel = (w) => w.find('.buy-bar__label').text()
const thumbLabel = (w) => w.find('.buy-bar__thumb').attributes('aria-label')

beforeEach(async () => {
  // Warm the Romanian chunk, then settle on English.
  await setLocale('ro')
  await setLocale('en')
})

afterEach(async () => {
  while (wrappers.length) wrappers.pop().unmount()
  await setLocale('en')
})

describe('rows, not units', () => {
  // The count of what is left lives in the header now; see
  // test/appNavBarBar.component.test.js for its plurals.
  it('counts one row of grapes x3 as one on the slider', () => {
    expect(barLabel(list(units(3)))).toBe('Slide to check out 1 item')
  })
})

describe('English counts', () => {
  it('agrees on the buy bar and its thumb', () => {
    expect(barLabel(list(cart(1)))).toBe('Slide to check out 1 item')
    expect(barLabel(list(cart(3)))).toBe('Slide to check out 3 items')
    expect(thumbLabel(list(cart(2)))).toBe('Check out 2 items')
  })
})

describe('Romanian counts', () => {
  beforeEach(async () => {
    await setLocale('ro')
  })

  it('applies the same rule to the buy bar and its thumb', () => {
    expect(barLabel(list(cart(1)))).toBe('Glisează: 1 produs cumpărat')
    expect(barLabel(list(cart(5)))).toBe('Glisează: 5 produse cumpărate')
    expect(barLabel(list(cart(20)))).toBe('Glisează: 20 de produse cumpărate')
    expect(thumbLabel(list(cart(20)))).toBe('Marchează 20 de produse ca cumpărate')
  })

})

describe('the meta label', () => {
  it('names what is being counted, in the current language', async () => {
    const w = list(toBuy(2))
    expect(metaLabel(w)).toBe('To buy')
    await setLocale('ro')
    await w.vm.$nextTick()
    expect(metaLabel(w)).toBe('De cumpărat')
  })

  it('says everything is in the cart when nothing is left to buy', () => {
    const w = list(cart(2))
    expect(metaLabel(w)).toBe("Everything's in the cart")
    expect(w.find('.list-meta__count').exists()).toBe(false)
  })
})

// A tap on the slider's thumb must not check out, but must not do nothing
// either. The lean has to move the thumb AND the green trail behind it: moving
// the thumb on its own tore the knob away from its track.
describe('a tap on the slider', () => {
  it('leans the thumb and its trail together, and says to slide', async () => {
    vi.useFakeTimers()
    const w = list(cart(2))
    const thumb = w.find('.buy-bar__thumb')
    const fillBefore = w.find('.buy-bar__fill').attributes('style')

    await thumb.trigger('click', { detail: 1 })
    vi.advanceTimersByTime(1)
    await w.vm.$nextTick()

    expect(thumb.attributes('style')).toContain('translateX(28px)')
    expect(w.find('.buy-bar__fill').attributes('style')).not.toBe(fillBefore)
    // The words come with the lean, not after it.
    expect(barLabel(w)).toBe('Slide to finish')
    expect(w.emitted('checkout')).toBeUndefined()

    vi.advanceTimersByTime(1000)
    await w.vm.$nextTick()
    expect(thumb.attributes('style')).toContain('translateX(0px)')
    expect(barLabel(w)).toBe('Slide to finish')

    vi.advanceTimersByTime(700)
    await w.vm.$nextTick()
    expect(barLabel(w)).toBe('Slide to check out 2 items')
    vi.useRealTimers()
  })
})

// A slide that stops short glides home, and letting go is also a click. The
// helper used to start on that click and grab the knob halfway home.
describe('a slide that stops short', () => {
  it('lets the knob get home before the helper starts', async () => {
    vi.useFakeTimers()
    const w = list(cart(2))
    const bar = w.find('.buy-bar').element
    const thumb = w.find('.buy-bar__thumb')
    Object.defineProperty(bar, 'clientWidth', { value: 400 })
    Object.defineProperty(thumb.element, 'offsetWidth', { value: 56 })

    await thumb.trigger('pointerdown', { pointerId: 1, clientX: 10 })
    await thumb.trigger('pointermove', { pointerId: 1, clientX: 160 })
    await thumb.trigger('pointerup', { pointerId: 1, clientX: 160 })
    await thumb.trigger('click', { detail: 1 })

    // Still gliding home: nothing may move it yet.
    vi.advanceTimersByTime(200)
    await w.vm.$nextTick()
    expect(thumb.attributes('style')).toContain('translateX(0px)')

    // Home, a beat of rest, then the lean.
    vi.advanceTimersByTime(250)
    await w.vm.$nextTick()
    expect(thumb.attributes('style')).toContain('translateX(28px)')
    vi.useRealTimers()
  })
})
