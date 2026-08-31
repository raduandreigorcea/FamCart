import { describe, it, expect } from 'vitest'
import {
  normalizeSearchText,
  escapeIlikePattern,
  productKey,
  buildHouseholdProductStats,
  matchHouseholdStats,
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

  // PostgREST rewrites * to % on its way to SQL, so an unescaped asterisk was a
  // wildcard that never went through Postgres's pattern syntax at all: typing
  // one matched the whole catalog.
  it('escapes the asterisk PostgREST would rewrite into a wildcard', () => {
    expect(escapeIlikePattern('*')).toBe('\\*')
    expect(escapeIlikePattern('a*b')).toBe('a\\*b')
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

describe('buildHouseholdProductStats', () => {
  const rows = [
    { name: 'Apa Plata 2L', maker: 'Dorna', purchased_at: '2026-07-01T10:00:00Z' },
    { name: 'apa plata 2l', maker: 'dorna', purchased_at: '2026-07-05T10:00:00Z' },
    { name: 'Lapte 3.5% 1L', maker: 'Napolact', purchased_at: '2026-07-09T10:00:00Z' },
  ]

  it('counts purchase occasions per product and keeps the latest date', () => {
    const stats = buildHouseholdProductStats(rows)
    expect(stats.size).toBe(2)

    const apa = stats.get(productKey('Apa Plata 2L', 'Dorna'))
    expect(apa.count).toBe(2)
    expect(apa.lastPurchasedAt).toBe(new Date('2026-07-05T10:00:00Z').getTime())
    // The first spelling seen wins, so the suggestion shows a real product name
    // rather than whatever casing the last row happened to carry.
    expect(apa.name).toBe('Apa Plata 2L')
  })

  it('ignores rows with no usable name', () => {
    expect(buildHouseholdProductStats([{ name: '   ' }, { maker: 'Dorna' }]).size).toBe(0)
  })

  it('survives an unparseable timestamp', () => {
    const stats = buildHouseholdProductStats([{ name: 'Sare de Masa 1kg', purchased_at: 'nonsense' }])
    expect(stats.get(productKey('Sare de Masa 1kg', null)).lastPurchasedAt).toBe(0)
  })
})

// The ordering contract: this household's habits outrank the world's, and the
// global catalog score only settles products they have never bought.
describe('rankSuggestions', () => {
  const catalog = [
    { name: 'Apa Plata 2L', maker: 'Dorna', popularity: 100 },
    { name: 'Apa Minerala 1.5L', maker: 'Perla Harghitei', popularity: 100 },
    { name: 'Apa de Gura 500ml', maker: 'Listerine', popularity: 0 },
  ]

  const noStats = new Map()

  it('falls back to global popularity, then name, with no household history', () => {
    expect(rankSuggestions(catalog, noStats, 6).map((p) => p.name)).toEqual([
      'Apa Minerala 1.5L', // ties on popularity, wins on name
      'Apa Plata 2L',
      'Apa de Gura 500ml', // popularity 0 sinks the mouthwash
    ])
  })

  it('puts a product the household buys above a more globally popular one', () => {
    const stats = buildHouseholdProductStats([
      { name: 'Apa de Gura 500ml', maker: 'Listerine', purchased_at: '2026-07-01T10:00:00Z' },
    ])
    expect(rankSuggestions(catalog, stats, 6).map((p) => p.name)).toEqual([
      'Apa de Gura 500ml', // bought here, so it outranks popularity 100
      'Apa Minerala 1.5L',
      'Apa Plata 2L',
    ])
  })

  it('orders the household favourites by how often, then how recently', () => {
    const stats = buildHouseholdProductStats([
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
    const stats = buildHouseholdProductStats([
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
    const stats = buildHouseholdProductStats([
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

  // The stat lookup is keyed off the TRIMMED name, while the row that comes back
  // and the name tiebreak still use the raw one. That is only safe because
  // productKey normalizes its inputs, and this is the case that proves it: a
  // padded name has to still find the household's history, or a product they buy
  // every week silently drops to catalog order.
  //
  // Worth pinning because it used to be true for a different reason. The
  // comparator resolved the key from the raw name on every comparison; it
  // resolves it once, from the trimmed one, alongside the dedupe that had
  // already computed it.
  it('still finds the household history for a name that arrives padded', () => {
    const stats = buildHouseholdProductStats([
      { name: 'Apa de Gura 500ml', maker: 'Listerine', purchased_at: '2026-07-01T10:00:00Z' },
    ])
    const padded = [
      { name: '  Apa de Gura 500ml  ', maker: 'Listerine', popularity: 0 },
      ...catalog.slice(0, 2),
    ]
    const ranked = rankSuggestions(padded, stats, 6)

    // Bought here, so it outranks two rows with popularity 100 despite its own 0.
    expect(ranked[0].name).toBe('  Apa de Gura 500ml  ')
    // And the row handed back is the candidate as given, not a trimmed copy.
    expect(ranked).toHaveLength(3)
  })
})

// The other half of the suggestion pool. The catalog query is capped and ordered
// globally, so once the catalog is imported at scale a household's own staple can
// be crowded out of it before ranking ever sees it. These matches come from
// memory and close that gap.
describe('matchHouseholdStats', () => {
  const stats = buildHouseholdProductStats([
    { name: 'Apa Plata 2L', maker: 'Dorna', purchased_at: '2026-07-01T10:00:00Z' },
    { name: 'Apa Plata 2L', maker: 'Dorna', purchased_at: '2026-07-02T10:00:00Z' },
    { name: 'Apa Minerala 1.5L', maker: 'Perla Harghitei', purchased_at: '2026-07-08T10:00:00Z' },
    { name: 'Lapte 3.5% 1L', maker: 'Napolact', purchased_at: '2026-07-09T10:00:00Z' },
  ])

  it('finds a bought product by name', () => {
    expect(matchHouseholdStats('plata', stats, { limit: 6 }).map((p) => p.name)).toEqual([
      'Apa Plata 2L',
    ])
  })

  it('matches the maker too, the way the server ilike does', () => {
    expect(matchHouseholdStats('dorna', stats, { limit: 6 }).map((p) => p.name)).toEqual([
      'Apa Plata 2L',
    ])
  })

  it('ignores the accents the user typed', () => {
    expect(matchHouseholdStats('apă plată', stats, { limit: 6 }).map((p) => p.name)).toEqual([
      'Apa Plata 2L',
    ])
  })

  it('stays quiet until the query is worth searching', () => {
    expect(matchHouseholdStats('a', stats, { limit: 6 })).toEqual([])
    expect(matchHouseholdStats('   ', stats, { limit: 6 })).toEqual([])
  })

  it('orders by how often, then how recently, like the ranking does', () => {
    expect(matchHouseholdStats('apa', stats, { limit: 6 }).map((p) => p.name)).toEqual([
      'Apa Plata 2L', // bought twice
      'Apa Minerala 1.5L', // bought once
    ])
  })

  it('caps the list at the limit', () => {
    expect(matchHouseholdStats('apa', stats, { limit: 1 })).toHaveLength(1)
  })

  // The guard that stops history becoming a source of junk: purchase_history
  // records whatever was typed, so a hand-typed bare word must never be offered
  // back as if it were a product.
  it('refuses a hand-typed one-word entry with no maker', () => {
    const typed = buildHouseholdProductStats([
      { name: 'apa', purchased_at: '2026-07-10T10:00:00Z' },
      { name: 'apa', purchased_at: '2026-07-11T10:00:00Z' },
      { name: 'apa', purchased_at: '2026-07-12T10:00:00Z' },
    ])
    expect(matchHouseholdStats('apa', typed, { limit: 6 })).toEqual([])
  })

  it('accepts a maker-less entry that still reads as a product', () => {
    const typed = buildHouseholdProductStats([
      { name: 'Rosii Cherry 250g', purchased_at: '2026-07-10T10:00:00Z' },
    ])
    expect(matchHouseholdStats('rosii', typed, { limit: 6 }).map((p) => p.name)).toEqual([
      'Rosii Cherry 250g',
    ])
  })

  it('can be told to skip the specificity guard', () => {
    const typed = buildHouseholdProductStats([{ name: 'apa', purchased_at: '2026-07-10T10:00:00Z' }])
    expect(
      matchHouseholdStats('apa', typed, { limit: 6, requireSpecific: false }).map((p) => p.name),
    ).toEqual(['apa'])
  })

  // popularity 0 rather than undefined, so these take the identical path through
  // rankSuggestions' comparison and a catalog row with real popularity wins.
  it('returns a zero popularity so the catalog row outranks it on a tie', () => {
    const [match] = matchHouseholdStats('plata', stats, { limit: 6 })
    expect(match).toEqual({ name: 'Apa Plata 2L', maker: 'Dorna', popularity: 0 })
  })

  it('yields to the catalog spelling when both have the product', () => {
    const fromCatalog = { name: 'Apa Plata 2L', maker: 'Dorna', popularity: 100 }
    const merged = rankSuggestions(
      [fromCatalog, ...matchHouseholdStats('plata', stats, { limit: 6 })],
      stats,
      6,
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].popularity).toBe(100)
  })
})
