// The list's shape: rows to buy first, the cart after them, and aisle headings
// only when asked for. A mistake here puts a ticked item back among the things
// still to find, or hides something to buy under a collapsed cart.
import { describe, it, expect } from 'vitest'
import { buildListEntries } from '../src/lib/listSections'

const row = (id, name, checked = false) => ({ id, name, maker: null, checked })
const shape = (entries) =>
  entries.map((e) => (e.kind === 'row' ? e.item.id : `${e.kind}:${e.aisle ?? ''}${e.count}`))

const ITEMS = [row('1', 'Lapte'), row('2', 'Mere', true), row('3', 'Paine'), row('4', 'Mere')]

describe('buildListEntries', () => {
  it('keeps added order and puts ticked rows in the cart after the rest', () => {
    const entries = buildListEntries(ITEMS, { sort: 'added', cartCollapsed: false })
    expect(shape(entries)).toEqual(['1', '3', '4', 'cart:1', '2'])
  })

  it('hides the cart rows, never its heading, when collapsed', () => {
    const entries = buildListEntries(ITEMS, { sort: 'added', cartCollapsed: true })
    expect(shape(entries)).toEqual(['1', '3', '4', 'cart:1'])
  })

  it('groups rows to buy by aisle in shop order', () => {
    const entries = buildListEntries(ITEMS, { sort: 'aisle', cartCollapsed: false })
    expect(shape(entries)).toEqual([
      'aisle:produce1', '4',
      'aisle:bakery1', '3',
      'aisle:dairy1', '1',
      'cart:1', '2',
    ])
  })

  it('has no cart heading when nothing is ticked', () => {
    const entries = buildListEntries([row('1', 'Lapte')], { sort: 'added', cartCollapsed: false })
    expect(entries.some((e) => e.kind === 'cart')).toBe(false)
  })
})
