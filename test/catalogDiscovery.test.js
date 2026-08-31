import { describe, it, expect, vi } from 'vitest'
import {
  DISCOVER_MIN_CHARS,
  discoverProducts,
  localAnswersQuery,
} from '../src/lib/catalogDiscovery'

// The client half of the cold search: when to ask the catalog to go and find
// something, and what to do with what comes back.
//
// This is the one place in the app that reaches a third-party product database,
// by way of an edge function, so it is also the one place where a failure must
// be invisible. Everything below is either "do not ask unless it is worth
// asking" or "never let the answer break the search box".

const fakeFunctions = (impl) => ({
  functions: { invoke: vi.fn(impl) },
})

describe('deciding whether the local catalog answered', () => {
  // Enough branded rows to fill the dropdown, which is what "answered" means.
  const sixMilks = Array.from({ length: 6 }, (_, i) => ({
    name: `Lapte 1.5% 1L ${i}`, maker: `Zuzu${i}`, popularity: 40,
  }))

  it('says yes when enough branded rows contain every word typed', () => {
    expect(localAnswersQuery(sixMilks, 'lapte')).toBe(true)
    // Word order is not load-bearing, same as the database's own search.
    expect(localAnswersQuery(sixMilks, 'zuzu lapte')).toBe(true)
  })

  it('says no when one thin row is all there is', () => {
    // THE BUG THIS RULE EXISTS FOR. One matching row used to be enough, so a
    // seed row named "Apă" answered every water search forever and the catalog
    // could never grow past what it shipped with.
    const rows = [{ name: 'Lapte 1.5% 1L', maker: 'Zuzu', popularity: 40 }]
    expect(localAnswersQuery(rows, 'lapte')).toBe(false)
  })

  it('does not count brandless concepts toward the total', () => {
    // "Apă", "Apă plată", "Apă minerală" are concepts, not things to buy.
    const generics = Array.from({ length: 9 }, (_, i) => ({
      name: `Apa ${i}`, maker: null, popularity: 50,
    }))
    expect(localAnswersQuery(generics, 'apa')).toBe(false)
  })

  it('says no when the rows are about something else', () => {
    // THE CASE A ROW COUNT GETS WRONG. These rows are not empty — a count-based
    // rule would call this answered and never ask anyone. Ten drinks reached
    // through a category name are the shelf, not the product.
    const rows = [
      { name: 'Apa Plata 2L', maker: 'Dorna', popularity: 90 },
      { name: 'Suc de portocale', maker: null, popularity: 70 },
    ]
    expect(localAnswersQuery(rows, 'pepsi zero')).toBe(false)
  })

  it('says no when there is nothing at all', () => {
    expect(localAnswersQuery([], 'pepsi')).toBe(false)
  })

  it('folds both sides, so accents and case do not decide it', () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      name: `Șampon pentru Copii ${i}`, maker: `Johnson's ${i}`, popularity: 1,
    }))
    expect(localAnswersQuery(rows, 'sampon')).toBe(true)
    expect(localAnswersQuery(rows, 'SAMPON')).toBe(true)
    // And the fold is not what decides it: the same rows, one short.
    expect(localAnswersQuery(rows.slice(0, 5), 'sampon')).toBe(false)
  })

  it('treats an empty query as answered rather than asking about nothing', () => {
    expect(localAnswersQuery([], '   ')).toBe(true)
  })
})

describe('asking', () => {
  it('sends the query, the market and the language', async () => {
    const db = fakeFunctions(async () => ({ data: { products: [] }, error: null }))

    await discoverProducts(db, {
      query: 'pepsi zero',
      market: 'RO',
      language: 'ro',
      local: [{ name: 'Apa', maker: null, popularity: 3 }],
    })

    expect(db.functions.invoke).toHaveBeenCalledWith('discover', {
      body: {
        query: 'pepsi zero',
        market: 'RO',
        language: 'ro',
        local: [{ name: 'Apa', maker: null, popularity: 3 }],
      },
    })
  })

  it('omits a market and language it does not have, rather than sending null', async () => {
    const db = fakeFunctions(async () => ({ data: { products: [] }, error: null }))
    await discoverProducts(db, { query: 'pepsi', market: null, language: null, local: [] })

    const body = db.functions.invoke.mock.calls[0][1].body
    expect('market' in body).toBe(false)
    expect('language' in body).toBe(false)
  })

  it('does not ask at all below the minimum length (§6)', async () => {
    const db = fakeFunctions(async () => ({ data: { products: [] }, error: null }))
    const short = 'x'.repeat(DISCOVER_MIN_CHARS - 1)

    expect(await discoverProducts(db, { query: short, market: null, language: null, local: [] }))
      .toEqual([])
    expect(db.functions.invoke).not.toHaveBeenCalled()
  })

  it('bounds what it sends about the local results', async () => {
    const db = fakeFunctions(async () => ({ data: { products: [] }, error: null }))
    const many = Array.from({ length: 200 }, (_, i) => ({
      name: `Product ${i}`, maker: null, popularity: i,
    }))

    await discoverProducts(db, { query: 'pepsi', market: null, language: null, local: many })
    expect(db.functions.invoke.mock.calls[0][1].body.local).toHaveLength(40)
  })
})

describe('what comes back', () => {
  it('returns the discovered products', async () => {
    const db = fakeFunctions(async () => ({
      data: {
        products: [
          { name: 'Pepsi Zero 500ml', maker: 'Pepsi', popularity: 0 },
          { name: 'Pepsi Zero 2L', maker: 'Pepsi', popularity: 0 },
        ],
      },
      error: null,
    }))

    const found = await discoverProducts(db, {
      query: 'pepsi zero', market: 'RO', language: 'ro', local: [],
    })
    expect(found.map((p) => p.name)).toEqual(['Pepsi Zero 500ml', 'Pepsi Zero 2L'])
    expect(found[0].maker).toBe('Pepsi')
  })

  it('forces popularity to zero whatever the response claims', async () => {
    // A product nobody has added has earned nothing. Arriving with a number on
    // it would sort a stranger's discovery above products this household
    // actually buys — and the number came from outside the app.
    const db = fakeFunctions(async () => ({
      data: { products: [{ name: 'Pepsi Zero', maker: 'Pepsi', popularity: 99999 }] },
      error: null,
    }))

    const [row] = await discoverProducts(db, {
      query: 'pepsi zero', market: null, language: null, local: [],
    })
    expect(row.popularity).toBe(0)
  })

  it('shapes every row rather than trusting it', async () => {
    // These reach the dropdown and, if picked, a shopping list.
    const db = fakeFunctions(async () => ({
      data: {
        products: [
          { name: '  Spaced  ', maker: '  ' },
          { name: 'No maker' },
          { name: '' },
          null,
          'not an object',
          { maker: 'orphan brand' },
        ],
      },
      error: null,
    }))

    const found = await discoverProducts(db, {
      query: 'anything', market: null, language: null, local: [],
    })
    expect(found).toEqual([
      { name: 'Spaced', maker: null, popularity: 0 },
      { name: 'No maker', maker: null, popularity: 0 },
    ])
  })
})

describe('never breaking the search box', () => {
  it('returns nothing when the function errors', async () => {
    const db = fakeFunctions(async () => ({ data: null, error: { message: 'boom' } }))
    expect(await discoverProducts(db, { query: 'pepsi', market: null, language: null, local: [] }))
      .toEqual([])
  })

  it('returns nothing when invoke throws', async () => {
    // A dead network, a rejected token, a CORS failure. All the same here.
    const db = fakeFunctions(async () => { throw new Error('network') })
    expect(await discoverProducts(db, { query: 'pepsi', market: null, language: null, local: [] }))
      .toEqual([])
  })

  it('returns nothing for a body that is not the shape it should be', async () => {
    for (const data of [null, {}, { products: 'nope' }, { products: null }]) {
      const db = fakeFunctions(async () => ({ data, error: null }))
      expect(
        await discoverProducts(db, { query: 'pepsi', market: null, language: null, local: [] }),
        JSON.stringify(data),
      ).toEqual([])
    }
  })
})

describe('the intent the catalog reported', () => {
  // MIRRORED in the catalog's own isLocalSufficient, the same way the fold has
  // three copies: this one saves a round trip, the server's cannot be lied to.
  // Change one and change both.

  it('a generic concept needs nothing external, however thin the local answer', () => {
    const rows = [{ name: 'Cartofi', maker: null, popularity: 100 }]
    expect(localAnswersQuery(rows, 'cartofi')).toBe(false)
    expect(localAnswersQuery(rows, 'cartofi', 'generic')).toBe(true)
  })

  it('a branded concept is never answered by a brandless row', () => {
    const rows = [{ name: 'Apă', maker: null, popularity: 10000 }]
    expect(localAnswersQuery(rows, 'apa', 'branded')).toBe(false)
  })

  it('a mixed concept still wants real products', () => {
    const rows = [{ name: 'Lapte', maker: null, popularity: 500 }]
    expect(localAnswersQuery(rows, 'lapte', 'mixed')).toBe(false)
  })

  it('falls back to counting branded rows when no concept claimed the word', () => {
    const branded = Array.from({ length: 6 }, (_, i) => ({
      name: `Chorizo ${i}`, maker: `Maker${i}`, popularity: 1,
    }))
    expect(localAnswersQuery(branded, 'chorizo', null)).toBe(true)
    expect(localAnswersQuery(branded.slice(0, 5), 'chorizo', null)).toBe(false)
  })

  it('a generic intent does not rescue a query nothing actually matched', () => {
    // The match-quality half still runs first. Ten drinks reached through a
    // category name are not an answer to "pepsi zero", whatever the intent.
    const rows = [{ name: 'Suc de portocale', maker: null, popularity: 10 }]
    expect(localAnswersQuery(rows, 'pepsi zero', 'generic')).toBe(false)
  })
})
