// What the search screen opens on: the products this family actually reaches
// for, in the order they reach for them.
import { describe, it, expect } from 'vitest'
import { topFamilyProducts } from '../src/lib/productRecents'
import { buildFamilyProductStats, productKey } from '../src/lib/productSearch'

const at = (day) => `2026-07-${String(day).padStart(2, '0')}T10:00:00Z`

// Three trips for bread, two for milk, one for cheese.
const HISTORY = [
  { name: 'Paine Alba', maker: 'Vel Pitar', purchased_at: at(1) },
  { name: 'Paine Alba', maker: 'Vel Pitar', purchased_at: at(8) },
  { name: 'Paine Alba', maker: 'Vel Pitar', purchased_at: at(15) },
  { name: 'Lapte 3.5% 1L', maker: 'Napolact', purchased_at: at(2) },
  { name: 'Lapte 3.5% 1L', maker: 'Napolact', purchased_at: at(16) },
  { name: 'Cascaval 300g', maker: 'Delaco', purchased_at: at(17) },
]

const stats = () => buildFamilyProductStats(HISTORY)
const names = (products) => products.map((p) => p.name)

describe('topFamilyProducts', () => {
  it('puts what they buy most often first', () => {
    expect(names(topFamilyProducts(stats(), { limit: 10 }))).toEqual([
      'Paine Alba',
      'Lapte 3.5% 1L',
      'Cascaval 300g',
    ])
  })

  it('breaks a tie on how recently, not alphabetically', () => {
    const tied = buildFamilyProductStats([
      { name: 'Zahar 1kg', maker: null, purchased_at: at(20) },
      { name: 'Apa Plata 2L', maker: 'Dorna', purchased_at: at(3) },
    ])
    expect(names(topFamilyProducts(tied, { limit: 10 }))).toEqual(['Zahar 1kg', 'Apa Plata 2L'])
  })

  it('leaves out what is already on the list', () => {
    const products = topFamilyProducts(stats(), {
      limit: 10,
      exclude: [productKey('Paine Alba', 'Vel Pitar')],
    })
    expect(names(products)).toEqual(['Lapte 3.5% 1L', 'Cascaval 300g'])
  })

  // The exclusion is keyed the same way the catalog pairs a product with
  // itself, so a differently-cased or accented copy still counts as the same.
  it('matches the list by product identity rather than by spelling', () => {
    const products = topFamilyProducts(stats(), {
      limit: 10,
      exclude: [productKey('pâine albă', 'VEL PITAR')],
    })
    expect(names(products)).not.toContain('Paine Alba')
  })

  it('carries the maker through, so the rows read as products', () => {
    expect(topFamilyProducts(stats(), { limit: 1 })[0]).toEqual({
      name: 'Paine Alba',
      maker: 'Vel Pitar',
    })
  })

  it('stops at the limit', () => {
    expect(topFamilyProducts(stats(), { limit: 2 })).toHaveLength(2)
  })

  it('offers nothing rather than everything when there is no room', () => {
    expect(topFamilyProducts(stats(), { limit: 0 })).toEqual([])
  })

  it('survives a family with no history at all', () => {
    expect(topFamilyProducts(new Map(), { limit: 8 })).toEqual([])
  })

  // Unlike matchFamilyStats, a hand-typed one-word entry belongs here: the
  // section claims to be their history, and that is what they bought.
  it('keeps a bare hand-typed staple, which a search result would drop', () => {
    const typed = buildFamilyProductStats([
      { name: 'paine', maker: null, purchased_at: at(4) },
      { name: 'paine', maker: null, purchased_at: at(11) },
    ])
    expect(names(topFamilyProducts(typed, { limit: 5 }))).toEqual(['paine'])
  })
})
