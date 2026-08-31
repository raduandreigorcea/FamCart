// Product suggestion search and ranking.
//
// normalizeSearchText must mirror product_search_text() in
// 006_product_catalog.sql, which is the one authority on what a product's
// matching key is — both sides lowercase, strip diacritics, and collapse
// whitespace, so "apă" typed with or without accents matches the stored
// "apa plata 2l dorna". The catalog importer vendors a byte-identical copy of
// this file for the same reason, and a test in each repo fails if they drift.
//
// (This used to name scripts/seed-products.mjs as the other side of the mirror.
// That script was deleted in 9a4366e along with its products.json; the ~256
// curated rows it wrote are still in production with nothing in the repo left
// to regenerate them.)
//
// Ranking (see rankSuggestions) puts what THIS household actually buys first and
// only falls back to the global catalog ordering for products they have never
// bought. The global signal is a cold-start default; a household's own history is
// the real answer to "what did they mean by 'apa'".
//
// The split of responsibility matters: the catalog is the only SOURCE of
// suggestions, and history only ORDERS them. Purchase history records whatever
// was typed into the list, so treating it as a source would offer a bare "apa"
// as if it were a product — and, being a purchase, it would outrank every real
// one and entrench itself by being picked again. Such an entry simply keys to no
// catalog product and drops out.

export interface ProductSuggestion {
  name: string
  maker: string | null
  // Global cross-household score from product_catalog (006_product_catalog.sql).
  popularity?: number

  // ─── what the catalog project's search_catalog explains about the match ────
  //
  // Present only on rows from the CATALOG project; the app database's own
  // search_catalog returns three columns and knows nothing about concepts, and
  // rows recovered from household history have none of this either. So every
  // one of these is optional and nothing may depend on it being there.
  //
  // `concept_intent` is the one with behaviour attached: it is what lets the
  // client skip discovery for a generic concept. The rest are for explaining a
  // ranking that is otherwise very hard to argue with — a wrong result here
  // looks like a catalog that does not stock something, which is why `apa`
  // returning onions read as bad data for weeks.
  concept_intent?: string | null
  matched_concept?: string | null
  match_type?: string | null
  matched_alias?: string | null
  category_match?: boolean | null
  language_match?: boolean | null
  market_match?: boolean | null
  relevance_score?: number | null
}

// One product a household has bought, folded across all its purchase_history rows.
export interface HouseholdProductStat {
  name: string
  maker: string | null
  // Purchase occasions, not units: buying "apa x6" once says less about habit
  // than buying it on six separate trips.
  count: number
  lastPurchasedAt: number
}

export interface PurchaseHistoryRow {
  name?: string | null
  maker?: string | null
  purchased_at?: string | null
}

export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// ilike treats %, _ and \ as pattern syntax; escape them so the user's literal
// input can never widen (or break) the match.
//
// `*` is in the class for a reason that is not Postgres's. PostgREST accepts an
// asterisk as a synonym for % in its like/ilike filters and rewrites it on the
// way to SQL, so a typed one arrived as a wildcard however carefully the three
// characters above were handled — searching for `*` matched the entire catalog.
// Nothing unsafe came of that (RLS still decides which rows exist, and this is a
// read), but it was the one input this function was named for and did not cover.
//
// Worth being exact about what escaping buys here, since it is not the usual
// full fix: the rewrite happens after we send, so `\*` reaches Postgres as `\%`
// and a search for a literal asterisk finds a literal percent instead. The
// widening is gone, which is the whole of the bug; expressing "an actual
// asterisk" is not reachable through an operator that spends the character
// before we are consulted. No product name in the catalog contains either, so
// the residue is theoretical — but it is a residue, not a clean win.
export function escapeIlikePattern(text: string): string {
  return text.replace(/[\\%_*]/g, (ch) => `\\${ch}`)
}

// Identity of a product across the catalog and a household's history. Name + maker,
// normalized the same way search_text is, so "Apă Plată"/"Apa Plata" and a null
// vs empty maker collapse together — matching how the DB's merge key and
// bump_product_popularity() pair a product with itself.
//
// The parts join on NUL, which normalizeSearchText can never emit, so
// ("Apa Plata", "Dorna") and ("Apa", "Plata Dorna") stay distinct products.
export function productKey(name: string | null | undefined, maker: string | null | undefined): string {
  return `${normalizeSearchText(String(name ?? ''))}\u0000${normalizeSearchText(String(maker ?? ''))}`
}

// Fold a household's purchase_history rows into per-product stats.
//
// purchase_history is pruned to 60 checkouts / 30 days (005_purchase_history.sql), so this
// is inherently a rolling window of recent behaviour: no decay maths needed, the
// retention policy already forgets for us.
export function buildHouseholdProductStats(rows: PurchaseHistoryRow[]): Map<string, HouseholdProductStat> {
  const stats = new Map<string, HouseholdProductStat>()

  for (const row of rows || []) {
    const name = String(row?.name ?? '').trim()
    if (!name) continue

    const maker = row?.maker ? String(row.maker).trim() || null : null
    const purchasedAt = new Date(String(row?.purchased_at ?? '')).getTime()
    const key = productKey(name, maker)

    const existing = stats.get(key)
    if (existing) {
      existing.count += 1
      if (Number.isFinite(purchasedAt) && purchasedAt > existing.lastPurchasedAt) {
        existing.lastPurchasedAt = purchasedAt
      }
      continue
    }

    stats.set(key, {
      name,
      maker,
      count: 1,
      lastPurchasedAt: Number.isFinite(purchasedAt) ? purchasedAt : 0,
    })
  }

  return stats
}

// Catalog matches this household has bought, recovered without a second query.
//
// The catalog pool the caller fetches is capped and ordered by GLOBAL
// popularity, which was harmless while the catalog was a few hundred curated
// rows: everything that matched fit in the pool, and rankSuggestions could sort
// it. Once the catalog is imported at scale, a two-character prefix matches
// thousands of products, and a household's own weekly staple can be crowded out of
// the pool by globally-popular strangers before ranking ever sees it.
// rankSuggestions can only reorder what it is handed.
//
// This is the other half of the pool: the household's stats are already in memory
// and already keyed the same way, so matching them here costs no network.
//
// It does make purchase history a SOURCE of suggestions, which the note at the
// top of this file warns against. Two things contain that:
//
//   1. rankSuggestions dedupes by productKey, first candidate wins, and the
//      caller appends these AFTER the catalog rows. So whenever the catalog did
//      return the product, the catalog's row -- canonical spelling, real
//      popularity -- wins and the history copy is discarded. Only the rows the
//      pool starved out survive, which is exactly the gap being filled.
//   2. requireSpecific is the guard the warning asks for. A maker is only ever
//      set by picking a catalog suggestion or by filling in the custom-product
//      modal, so it is a strong "this is a real product" signal. A hand-typed
//      bare "apa" has no maker and one word and can never be offered back; an
//      "Apa Plata 2L" / "Dorna" can.
export function matchHouseholdStats(
  query: string,
  householdStats: Map<string, HouseholdProductStat>,
  options: { limit: number; requireSpecific?: boolean },
): ProductSuggestion[] {
  const needle = normalizeSearchText(String(query ?? ''))
  if (needle.length < 2) return []

  const requireSpecific = options?.requireSpecific !== false
  const limit = Math.max(0, Number(options?.limit) || 0)
  if (limit === 0) return []

  const matches: HouseholdProductStat[] = []
  for (const stat of householdStats?.values() ?? []) {
    if (requireSpecific && !stat.maker && stat.name.trim().split(/\s+/).length < 2) continue
    // The same haystack product_search_text() builds, so "contains" means the
    // same thing here as it does in the server's ilike.
    const haystack = normalizeSearchText(`${stat.name} ${stat.maker ?? ''}`)
    if (haystack.includes(needle)) matches.push(stat)
  }

  return matches
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count
      if (a.lastPurchasedAt !== b.lastPurchasedAt) return b.lastPurchasedAt - a.lastPurchasedAt
      // Pinned to 'en', not the device or the app language: this is a
      // tie-breaker over catalog data, and a locale-dependent collation
      // would order the same list differently on two phones for no gain.
      return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
    })
    .slice(0, limit)
    // popularity 0 rather than undefined so these take exactly the same path
    // through rankSuggestions' Number(x) || 0 comparison as a catalog row.
    .map((stat) => ({ name: stat.name, maker: stat.maker, popularity: 0 }))
}

// Order catalog matches, dropping any duplicate product:
//   1. products this household buys — most often, then most recently
//   2. global popularity, for everything they have never bought
//   3. name, so the order is stable
//
// A history entry only participates by matching a candidate's key, so anything
// typed by hand that is not a catalog product (a bare "apa", a typo) contributes
// nothing and can never be suggested. The first candidate for a key wins.
export function rankSuggestions(
  candidates: ProductSuggestion[],
  householdStats: Map<string, HouseholdProductStat>,
  limit: number,
): ProductSuggestion[] {
  const unique = new Map<string, ProductSuggestion>()
  for (const candidate of candidates || []) {
    const name = String(candidate?.name ?? '').trim()
    if (!name) continue
    const key = productKey(name, candidate.maker)
    if (!unique.has(key)) unique.set(key, candidate)
  }

  return [...unique.values()]
    .sort((a, b) => {
      const sa = householdStats.get(productKey(a.name, a.maker))
      const sb = householdStats.get(productKey(b.name, b.maker))

      // Bought before beats never bought, whatever the world thinks of it.
      if (Boolean(sa) !== Boolean(sb)) return sa ? -1 : 1
      if (sa && sb) {
        if (sa.count !== sb.count) return sb.count - sa.count
        if (sa.lastPurchasedAt !== sb.lastPurchasedAt) return sb.lastPurchasedAt - sa.lastPurchasedAt
      }

      const pa = Number(a.popularity) || 0
      const pb = Number(b.popularity) || 0
      if (pa !== pb) return pb - pa

      // Pinned to 'en', not the device or the app language: this is a
      // tie-breaker over catalog data, and a locale-dependent collation
      // would order the same list differently on two phones for no gain.
      return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
    })
    .slice(0, limit)
}
