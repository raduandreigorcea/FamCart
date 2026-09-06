// @vitest-environment happy-dom
//
// The shop logos on the LIST, which is a different problem from the ones in the
// suggestions dropdown.
//
// A suggestion carries `retailers` because it came out of the catalog a moment
// ago. A list row does not: it is a row in the app's own database, written when
// somebody added it, and it knows nothing about the catalog -- which is correct,
// and is why a list still works with no catalog configured. So the shops have to
// be looked up and handed down, and this is the seam where that goes wrong
// quietly.
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ShoppingList from '../src/components/ShoppingList.vue'
import { productKey } from '../src/lib/productSearch'

vi.mock('../src/lib/appChannel', async (importOriginal) => ({
  ...(await importOriginal()),
  get IS_NIGHTLY() {
    return true
  },
}))

const ITEMS = [
  { id: '1', name: 'Lapte Zuzu 1L', maker: 'Zuzu', checked: false, quantity: 1 },
  { id: '2', name: 'Ciocolată', maker: 'Ritter SPORT', checked: false, quantity: 1 },
  { id: '3', name: 'Ceva scris de mana', maker: null, checked: false, quantity: 1 },
]

function mountList(shopMap = new Map()) {
  return mount(ShoppingList, {
    props: { items: ITEMS, shopMap, loading: false, memberProfiles: new Map() },
    global: { stubs: { TransitionGroup: false } },
  })
}

const badges = (wrapper) => wrapper.findAll('.shop-badge__name').map((s) => s.text())

describe('shop logos on the shopping list', () => {
  it('shows the shops for a row the catalog knows', () => {
    const map = new Map([[productKey('Lapte Zuzu 1L', 'Zuzu'), ['auchan', 'lidl']]])
    expect(badges(mountList(map))).toEqual(['Auchan', 'Lidl'])
  })

  it('shows nothing for a row nobody sells, which is itself the signal', () => {
    // An empty answer means no configured shop lists it -- so somebody typed
    // this one in. That is the whole reason the badge is worth having while the
    // catalog is being filled.
    expect(badges(mountList(new Map()))).toEqual([])
  })

  it('matches on the name alone when the row carries no maker', () => {
    // THE CASE THAT BREAKS FIRST. The catalog answers with ITS canonical name
    // and brand; the row on the list carries whatever the person picked, and
    // somebody who typed a name themselves has no maker at all. Keying only on
    // name+maker would silently never match those rows.
    const map = new Map([[productKey('Ceva scris de mana', null), ['carrefour']]])
    expect(badges(mountList(map))).toEqual(['Carrefour'])
  })

  it('prefers the exact name and maker over the name alone', () => {
    const map = new Map([
      [productKey('Ciocolată', 'Ritter SPORT'), ['lidl']],
      [productKey('Ciocolată', null), ['auchan']],
    ])
    expect(badges(mountList(map))).toEqual(['Lidl'])
  })

  it('costs nothing when there is no map at all', () => {
    // Production, or a catalog that could not be reached. Every row still
    // renders; only the decoration is missing.
    const wrapper = mountList(new Map())
    expect(wrapper.findAll('.shop-badge')).toHaveLength(0)
    expect(wrapper.text()).toContain('Lapte Zuzu 1L')
  })
})
