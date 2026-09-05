import { getCatalogSupabase } from '../supabase'
import { IS_NIGHTLY } from './appChannel'
import { productKey } from './productSearch'

// Which shop each product on the list came from, on nightly only.
//
// A shopping list row is a row in the APP's database. It knows a name and a
// maker and nothing else, and it has no idea the catalog exists -- which is
// correct, and is why a list still works with no catalog configured at all.
// Suggestions carry `retailers` because they came from the catalog a moment ago;
// a row that was added last Tuesday does not.
//
// So this is a lookup, and one for the whole list at once. Twenty rows must not
// mean twenty round trips.
//
// EVERY FAILURE PATH RETURNS AN EMPTY MAP. This draws a decoration on a nightly
// build; a shopping list must not degrade because a second database is slow, and
// the caller renders nothing for a product it has no answer for anyway.

/** name + maker, folded, to the shops carrying it. */
export type ShopMap = Map<string, string[]>

interface ShopRow {
  name?: unknown
  maker?: unknown
  retailers?: unknown
}

export function shopsEnabled(): boolean {
  return IS_NIGHTLY && getCatalogSupabase() !== null
}

export async function fetchShopsFor(names: string[]): Promise<ShopMap> {
  const empty: ShopMap = new Map()
  if (!shopsEnabled()) return empty

  const catalogDb = getCatalogSupabase()
  if (!catalogDb) return empty

  // Deduplicated and capped before it leaves. The RPC caps at 200 too; doing it
  // here as well keeps the request small rather than relying on the far side to
  // throw the excess away.
  const wanted = [...new Set(names.map((n) => String(n ?? '').trim()).filter(Boolean))].slice(0, 200)
  if (wanted.length === 0) return empty

  try {
    const { data, error } = await catalogDb.rpc('catalog_shops_for', { p_names: wanted })
    if (error || !Array.isArray(data)) return empty

    const map: ShopMap = new Map()
    for (const row of data as ShopRow[]) {
      const name = typeof row.name === 'string' ? row.name : ''
      if (!name) continue
      const maker = typeof row.maker === 'string' ? row.maker : null
      const shops = Array.isArray(row.retailers)
        ? row.retailers.filter((s): s is string => typeof s === 'string')
        : []
      if (shops.length === 0) continue

      // Keyed both ways on purpose. The catalog answers with ITS canonical name
      // and brand, and the row on the list carries whatever the person picked --
      // often a shop's own wording, and sometimes with no maker at all because
      // they typed it themselves. Keying on the name alone as well is what makes
      // the second case resolve.
      map.set(productKey(name, maker), shops)
      if (!map.has(productKey(name, null))) map.set(productKey(name, null), shops)
    }
    return map
  } catch {
    return empty
  }
}
