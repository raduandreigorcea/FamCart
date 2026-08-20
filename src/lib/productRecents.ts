// What a household reaches for most, for the phone search screen to open on before
// anything is typed. Groceries are mostly repeats, so the most useful thing that
// space can hold is the shortcut past typing altogether.
//
// Deliberately NOT in productSearch.ts, which the catalog importer vendors
// byte-for-byte (see test/vendorDrift.test.js). The importer collapses products;
// it has no use for a household's habits, and adding this there would make every
// edit to it churn a submodule for nothing.

import { productKey, type HouseholdProductStat, type ProductSuggestion } from './productSearch'

// Same order as matchHouseholdStats — most often, then most recently, then by name
// — because "what you buy" means the same thing whether it is answering a query
// or standing in for one.
//
// This makes purchase history a SOURCE of suggestions without matchHouseholdStats'
// requireSpecific guard, which the note at the top of productSearch.ts would
// normally object to. What contains it is that this is not a search result: the
// section says "Buy again" and answers "what have you bought", so a hand-typed
// bare "paine" that this household adds every week is a correct answer rather than
// an impostor. It never reaches rankSuggestions, so it cannot displace a catalog
// row from a query it does not match, and picking one takes exactly the path
// typing that same word by hand already takes.
//
// `exclude` keeps what is already on the list out of it: the one thing a household
// does not need offered is the milk they added an hour ago.
export function topHouseholdProducts(
  householdStats: Map<string, HouseholdProductStat>,
  options: { limit: number; exclude?: Iterable<string> },
): ProductSuggestion[] {
  const limit = Math.max(0, Number(options?.limit) || 0)
  if (limit === 0) return []

  const skip = new Set(options?.exclude ?? [])

  return [...(householdStats?.values() ?? [])]
    .filter((stat) => !skip.has(productKey(stat.name, stat.maker)))
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count
      if (a.lastPurchasedAt !== b.lastPurchasedAt) return b.lastPurchasedAt - a.lastPurchasedAt
      // Pinned to 'en', not the device or the app language: this is a
      // tie-breaker over catalog data, and a locale-dependent collation
      // would order the same list differently on two phones for no gain.
      return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
    })
    .slice(0, limit)
    .map((stat) => ({ name: stat.name, maker: stat.maker }))
}
