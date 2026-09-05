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

// ─── remembering the answer ──────────────────────────────────────────────────
// The badges used to arrive a beat after the rows, and the reason was never the
// logos -- those are inlined in the bundle. It was this lookup: the list paints
// from the household snapshot cache with no network at all, and then had to wait
// for a round trip to a SECOND database before it could say where anything came
// from.
//
// So the answer is cached the same way the list is. On a warm start the badges
// paint with the rows, and the fetch below still runs and replaces them, which
// is what keeps a shop that dropped a product from showing forever.
//
// Nothing here is private: it is which shops sell a product, which every signed
// in user can read anyway. It is keyed by version alone rather than by user, and
// a household's product NAMES are the only thing about it that came from them --
// the same names already sitting in the snapshot cache next to it.
const CACHE_KEY = 'famcart.shop-badges.v1'
// Enough for a big list several times over. A cap at all is what stops a cache
// that is only ever added to from growing until a browser refuses to write it.
const CACHE_MAX = 500

// Read back out of storage and used as an icon name and a label. AppIcon
// resolves against a fixed set and yields nothing for an unknown name, and the
// label is text-bound, so neither is a hole -- but a slug that is not a slug is
// a sign the entry is junk, and dropping it is cheaper than reasoning about it.
const SLUG = /^[a-z0-9-]{1,40}$/

export function loadCachedShops(storage: Storage = localStorage): ShopMap {
  const map: ShopMap = new Map()
  if (!IS_NIGHTLY) return map
  try {
    const raw = storage.getItem(CACHE_KEY)
    if (!raw) return map
    const stored = JSON.parse(raw) as unknown
    if (!Array.isArray(stored)) return map
    for (const entry of stored) {
      if (!Array.isArray(entry) || entry.length !== 2) continue
      const [key, shops] = entry as [unknown, unknown]
      if (typeof key !== 'string' || !Array.isArray(shops)) continue
      const clean = shops.filter((x): x is string => typeof x === 'string' && SLUG.test(x))
      if (clean.length > 0) map.set(key, clean)
    }
  } catch {
    // A private window, cleared site data, a quota error, or something that is
    // not JSON. Every one of them means "no cache", which is the state this
    // started in.
  }
  return map
}

export function saveCachedShops(map: ShopMap, storage: Storage = localStorage): void {
  if (!IS_NIGHTLY) return
  try {
    storage.setItem(CACHE_KEY, JSON.stringify([...map.entries()].slice(0, CACHE_MAX)))
  } catch {
    // Writing a decoration's cache must never be the thing that breaks a list.
  }
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
    saveCachedShops(map)
    return map
  } catch {
    return empty
  }
}
