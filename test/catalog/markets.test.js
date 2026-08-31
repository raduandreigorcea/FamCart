import { describe, it, expect } from 'vitest'
import { MARKETS, PRIMARY_MARKETS, LANGUAGES, isMarket, isLanguage } from '../../catalog/supabase/functions/_shared/markets.ts'
import { MARKETS as APP_MARKETS } from '../../src/lib/region.ts'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The catalog and the app have to agree on which markets exist, and there is no
// runtime that would ever tell you they had stopped agreeing.
//
// THIS TEST READS ACROSS A REPOSITORY BOUNDARY ON PURPOSE, and it is the only
// one here that does. The catalog is a submodule (catalog/, published as
// raduandreigorcea/FamCart-catalog) with its own tests, and everything that
// concerns only the catalog lives over there. This one cannot: it compares the
// catalog's market list against src/lib/region.ts, and neither repo can see
// both sides on its own. It is the same job test/vendorDrift.test.js used to
// do for the vendored copy of productSearch.ts, and it lives here for the same
// reason -- the superproject is the only place where both are checked out.
//
// It therefore FAILS LOUDLY on a checkout with no submodules, which is why
// .github/workflows/ci.yml passes `submodules: true` on the unit-test job.
//
// This test is the replacement for one that used to live in the deleted importer
// repo, pinning its country-code table against src/lib/region.ts. That check went
// with the repo, and the comment in region.ts records the list as "currently
// unguarded". It is guarded again here.
//
// WHAT GOES WRONG WITHOUT IT, in both directions:
//
//   * region.ts gains a market the catalog's check constraint rejects → every
//     product written for that market is refused at import, so the market stays
//     permanently empty and the failure shows up as an empty dropdown in one
//     country.
//   * region.ts gains a market nothing ever writes → p_markets carries a code
//     that matches no row, every product is demoted for that phone, and the
//     dropdown fills with foreign names. This is the failure region.ts itself
//     was written to fix, reintroduced.
//
// Neither is visible from a test that only exercises one side.

describe('market and language vocabularies', () => {
  it('lists exactly the markets src/lib/region.ts can derive from a timezone', () => {
    // Sorted, because the order in each file is meaningful to a reader (region.ts
    // groups them roughly by language family) and meaningless to the check.
    expect([...MARKETS].sort()).toEqual([...APP_MARKETS].sort())
  })

  it('accepts every one of them in the database check constraint', () => {
    // The constraint is the thing that actually rejects a row, and it is written
    // in SQL where no type system reaches it. Read it back out of the migration
    // rather than trusting that someone updated both.
    const sql = readFileSync(
      fileURLToPath(new URL('../../catalog/supabase/migrations/002_products.sql', import.meta.url)),
      'utf8',
    )
    const match = sql.match(/markets <@ array\[([^\]]+)\]/)
    expect(match, 'the markets check constraint is still in 002_products.sql').toBeTruthy()

    const constraintMarkets = match[1].split(',').map((s) => s.trim().replace(/'/g, ''))
    expect(constraintMarkets.sort()).toEqual([...MARKETS].sort())
  })

  it('treats the six primary markets as a subset, not a separate vocabulary', () => {
    for (const m of PRIMARY_MARKETS) expect(MARKETS).toContain(m)
    expect(PRIMARY_MARKETS).toHaveLength(6)
  })

  it('speaks exactly the languages the app ships locales for', () => {
    // src/locales/ is the authority on what the interface can render, and a
    // product name in a language nothing can render is a product nobody can read.
    const localeDir = fileURLToPath(new URL('../../src/locales/', import.meta.url))
    const shipped = readdirSync(localeDir)
      .filter((f) => /^[a-z]{2}\.ts$/.test(f))
      .map((f) => f.slice(0, 2))
      .sort()
    expect([...LANGUAGES].sort()).toEqual(shipped)
  })

  it('constrains the alias and name language checks to the same six', () => {
    const sql = readFileSync(
      fileURLToPath(new URL('../../catalog/supabase/migrations/002_products.sql', import.meta.url)),
      'utf8',
    )
    const checks = [...sql.matchAll(/in \('en', 'de', 'es', 'ro', 'fr', 'it'\)/g)]
    // One for catalog_products.name_lang, one for catalog_aliases.lang.
    expect(checks.length).toBe(2)
  })

  it('narrows unknown values rather than accepting them', () => {
    expect(isMarket('RO')).toBe(true)
    expect(isMarket('US')).toBe(false)
    expect(isMarket('ro')).toBe(false)
    expect(isMarket(null)).toBe(false)
    expect(isLanguage('ro')).toBe(true)
    expect(isLanguage('pl')).toBe(false)
  })
})
