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
  it('says yes when a row contains every word that was typed', () => {
    const rows = [{ name: 'Lapte 1.5% 1L', maker: 'Zuzu', popularity: 40 }]
    expect(localAnswersQuery(rows, 'lapte')).toBe(true)
    expect(localAnswersQuery(rows, 'lapte zuzu')).toBe(true)
    // Word order is not load-bearing, same as the database's own search.
    expect(localAnswersQuery(rows, 'zuzu lapte')).toBe(true)
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
    const rows = [{ name: 'Șampon pentru Copii', maker: "Johnson's", popularity: 1 }]
    expect(localAnswersQuery(rows, 'sampon')).toBe(true)
    expect(localAnswersQuery(rows, 'SAMPON')).toBe(true)
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
