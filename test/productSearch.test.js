import { describe, it, expect } from 'vitest'
import {
  normalizeSearchText,
  escapeIlikePattern,
  productKey,
  buildFamilyProductStats,
  rankSuggestions,
} from '../src/lib/productSearch'

// The client-side normalization must mirror how scripts/seed-products.mjs
// computes product_catalog.search_text — same lowercase / diacritic-stripping /
// whitespace-collapsing — or typed input stops matching seeded rows.
describe('normalizeSearchText', () => {
  it('lowercases, strips diacritics, and collapses whitespace', () => {
    expect(normalizeSearchText('  Apă  Plată   2L ')).toBe('apa plata 2l')
    expect(normalizeSearchText('Brânză și Țelină')).toBe('branza si telina')
  })

  it('leaves already-normalized text unchanged', () => {
    expect(normalizeSearchText('apa plata 2l dorna')).toBe('apa plata 2l dorna')
  })
})

describe('escapeIlikePattern', () => {
  it('escapes the ilike wildcards and the escape character itself', () => {
    expect(escapeIlikePattern('50%_a\\b')).toBe('50\\%\\_a\\\\b')
  })

  it('leaves plain text alone', () => {
    expect(escapeIlikePattern('apa plata')).toBe('apa plata')
  })
})

describe('productKey', () => {
  it('treats accents, case, and padding as the same product', () => {
    expect(productKey('  Apă Plată 2L ', 'DORNA')).toBe(productKey('apa plata 2l', 'Dorna'))
  })

  it('treats a null and an empty maker alike', () => {
    expect(productKey('Lamai 500g', null)).toBe(productKey('Lamai 500g', ''))
  })

  it('keeps the name/maker split unambiguous', () => {
    // Joined on a separator normalizeSearchText can never emit, so the split
    // point cannot be forged by putting the maker's words in the name.
    expect(productKey('Apa Plata', 'Dorna')).not.toBe(productKey('Apa', 'Plata Dorna'))
  })

  it('distinguishes the same product name from different makers', () => {
    expect(productKey('Lapte 3.5% 1L', 'Napolact')).not.toBe(productKey('Lapte 3.5% 1L', 'LaDorna'))
  })
})

describe('buildFamilyProductStats', () => {
  const rows = [
    { name: 'Apa Plata 2L', maker: 'Dorna', purchased_at: '2026-07-01T10:00:00Z' },
    { name: 'apa plata 2l', maker: 'dorna', purchased_at: '2026-07-05T10:00:00Z' },
    { name: 'Lapte 3.5% 1L', maker: 'Napolact', purchased_at: '2026-07-09T10:00:00Z' },
  ]

  it('counts purchase occasions per product and keeps the latest date', () => {
    const stats = buildFamilyProductStats(rows)
    expect(stats.size).toBe(2)

    const apa = stats.get(productKey('Apa Plata 2L', 'Dorna'))
    expect(apa.count).toBe(2)
    expect(apa.lastPurchasedAt).toBe(new Date('2026-07-05T10:00:00Z').getTime())
    // The first spelling seen wins, so the suggestion shows a real product name
    // rather than whatever casing the last row happened to carry.
    expect(apa.name).toBe('Apa Plata 2L')
  })

  it('ignores rows with no usable name', () => {
    expect(buildFamilyProductStats([{ name: '   ' }, { maker: 'Dorna' }]).size).toBe(0)
  })

  it('survives an unparseable timestamp', () => {
    const stats = buildFamilyProductStats([{ name: 'Sare de Masa 1kg', purchased_at: 'nonsense' }])
    expect(stats.get(productKey('Sare de Masa 1kg', null)).lastPurchasedAt).toBe(0)
  })
})

// The ordering contract: this family's habits outrank the world's, and the
// global catalog score only settles products they have never bought.
describe('rankSuggestions', () => {
  const catalog = [
    { name: 'Apa Plata 2L', maker: 'Dorna', popularity: 100 },
    { name: 'Apa Minerala 1.5L', maker: 'Perla Harghitei', popularity: 100 },
    { name: 'Apa de Gura 500ml', maker: 'Listerine', popularity: 0 },
  ]

  const noStats = new Map()

  it('falls back to global popularity, then name, with no family history', () => {
    expect(rankSuggestions(catalog, noStats, 6).map((p) => p.name)).toEqual([
      'Apa Minerala 1.5L', // ties on popularity, wins on name
      'Apa Plata 2L',
      'Apa de Gura 500ml', // popularity 0 sinks the mouthwash
    ])
  })

  it('puts a product the family buys above a more globally popular one', () => {
    const stats = buildFamilyProductStats([
      { name: 'Apa de Gura 500ml', maker: 'Listerine', purchased_at: '2026-07-01T10:00:00Z' },
    ])
    expect(rankSuggestions(catalog, stats, 6).map((p) => p.name)).toEqual([
      'Apa de Gura 500ml', // bought here, so it outranks popularity 100
      'Apa Minerala 1.5L',
      'Apa Plata 2L',
    ])
  })

  it('orders the family favourites by how often, then how recently', () => {
    const stats = buildFamilyProductStats([
      // Perla bought once, most recently; Dorna bought twice, longer ago.
      { name: 'Apa Plata 2L', maker: 'Dorna', purchased_at: '2026-07-01T10:00:00Z' },
      { name: 'Apa Plata 2L', maker: 'Dorna', purchased_at: '2026-07-02T10:00:00Z' },
      { name: 'Apa Minerala 1.5L', maker: 'Perla Harghitei', purchased_at: '2026-07-08T10:00:00Z' },
    ])
    expect(rankSuggestions(catalog, stats, 6).map((p) => p.name)).toEqual([
      'Apa Plata 2L', // twice beats once, even though Perla is more recent
      'Apa Minerala 1.5L',
      'Apa de Gura 500ml',
    ])
  })

  it('breaks an equal-count tie on recency', () => {
    const stats = buildFamilyProductStats([
      { name: 'Apa Plata 2L', maker: 'Dorna', purchased_at: '2026-07-01T10:00:00Z' },
      { name: 'Apa Minerala 1.5L', maker: 'Perla Harghitei', purchased_at: '2026-07-08T10:00:00Z' },
    ])
    expect(rankSuggestions(catalog, stats, 6)[0].name).toBe('Apa Minerala 1.5L')
  })

  // The catalog is the only source of suggestions. Purchase history holds
  // whatever was typed into the list, so a bare, maker-less "apa" bought over
  // and over must never be offered as a product — it would outrank every real
  // one and then entrench itself by being picked again.
  it('never suggests a hand-typed history entry that is not a catalog product', () => {
    const stats = buildFamilyProductStats([
      { name: 'apa', maker: null, purchased_at: '2026-07-01T10:00:00Z' },
      { name: 'apa', maker: null, purchased_at: '2026-07-08T10:00:00Z' },
      { name: 'apa', maker: null, purchased_at: '2026-07-14T10:00:00Z' },
    ])
    const ranked = rankSuggestions(catalog, stats, 6)
    expect(ranked.map((p) => p.name)).toEqual([
      'Apa Minerala 1.5L',
      'Apa Plata 2L',
      'Apa de Gura 500ml',
    ])
    // Bought three times, and still not a suggestion.
    expect(ranked.map((p) => p.name)).not.toContain('apa')
  })

  it('drops a duplicate product, keeping the canonical spelling first seen', () => {
    const ranked = rankSuggestions([...catalog, { name: 'apa plata 2l', maker: 'DORNA' }], noStats, 6)
    expect(ranked).toHaveLength(3)
    expect(ranked.map((p) => p.name)).toContain('Apa Plata 2L')
    expect(ranked.map((p) => p.name)).not.toContain('apa plata 2l')
  })

  it('caps the list at the limit', () => {
    expect(rankSuggestions(catalog, noStats, 2)).toHaveLength(2)
  })

  it('ignores candidates with no usable name', () => {
    expect(rankSuggestions([{ name: '  ', maker: 'x' }, ...catalog], noStats, 6)).toHaveLength(3)
  })
})
