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
// The other thing worth pinning is that the two counters on this screen count
// DIFFERENT things, which is easy to "fix" into agreement by accident: the meta
// line counts rows, the buy bar counts units.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ShoppingList from '../src/components/ShoppingList.vue'
import { setLocale } from '../src/lib/i18n'

// n checked rows of one unit each, so rows and units agree.
const rows = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    name: `Item ${i}`,
    checked: true,
    quantity: 1,
  }))

// One checked row holding n units, so rows and units disagree.
const units = (n) => [{ id: 'u', name: 'Grapes', checked: true, quantity: n }]

// Unchecked units, which is what the "left" count sums.
const toBuy = (n) => [{ id: 'a', name: 'Milk', checked: false, quantity: n }]

const wrappers = []
function list(items) {
  const w = mount(ShoppingList, { props: { items } })
  wrappers.push(w)
  return w
}

const metaCount = (w) => w.find('.list-meta__count').text()
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

describe('rows versus units', () => {
  it('counts rows in the meta line and units on the buy bar', () => {
    // One row of grapes x3: one thing on the list, three things to buy.
    const w = list(units(3))
    expect(metaCount(w)).toBe('1 item')
    expect(barLabel(w)).toBe('Slide to check out 3 items')
  })
})

describe('English counts', () => {
  it('distinguishes one from many', () => {
    expect(metaCount(list(toBuy(1)))).toBe('1 left')
    expect(metaCount(list(toBuy(6)))).toBe('6 left')
    expect(metaCount(list(rows(1)))).toBe('1 item')
    expect(metaCount(list(rows(4)))).toBe('4 items')
  })

  it('agrees on the buy bar and its thumb', () => {
    expect(barLabel(list(rows(1)))).toBe('Slide to check out 1 item')
    expect(barLabel(list(rows(3)))).toBe('Slide to check out 3 items')
    expect(thumbLabel(list(rows(2)))).toBe('Check out 2 items')
  })
})

describe('Romanian counts', () => {
  beforeEach(async () => {
    await setLocale('ro')
  })

  it('uses all three forms of the item count, including the 20 boundary', () => {
    expect(metaCount(list(rows(1)))).toBe('1 produs')
    expect(metaCount(list(rows(2)))).toBe('2 produse')
    expect(metaCount(list(rows(19)))).toBe('19 produse')
    // The one a ternary gets wrong.
    expect(metaCount(list(rows(20)))).toBe('20 de produse')
    // And back again inside the next hundred.
    expect(metaCount(list(rows(101)))).toBe('101 produse')
  })

  it('applies the same rule to the buy bar and its thumb', () => {
    expect(barLabel(list(rows(1)))).toBe('Glisează pentru a finaliza 1 produs')
    expect(barLabel(list(rows(5)))).toBe('Glisează pentru a finaliza 5 produse')
    expect(barLabel(list(rows(20)))).toBe('Glisează pentru a finaliza 20 de produse')
    expect(thumbLabel(list(rows(20)))).toBe('Finalizează 20 de produse')
  })

  it('agrees the left-count adjective with the number', () => {
    expect(metaCount(list(toBuy(1)))).toBe('1 rămas')
    expect(metaCount(list(toBuy(3)))).toBe('3 rămase')
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

  it('switches to the checked label when nothing is left to buy', () => {
    expect(metaLabel(list(rows(2)))).toBe('Checked')
  })
})
