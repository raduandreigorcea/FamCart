// Product suggestion search and ranking.
//
// normalizeSearchText must mirror scripts/seed-products.mjs, which computes
// product_catalog.search_text the same way — both sides lowercase, strip
// diacritics, and collapse whitespace, so "apă" typed with or without accents
// matches the stored "apa plata 2l dorna".
//
// Ranking (see rankSuggestions) puts what THIS family actually buys first and
// only falls back to the global catalog ordering for products they have never
// bought. The global signal is a cold-start default; a family's own history is
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
  // Global cross-family score from product_catalog (migration 022).
  popularity?: number
}

// One product a family has bought, folded across all its purchase_history rows.
export interface FamilyProductStat {
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
export function escapeIlikePattern(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

// Identity of a product across the catalog and a family's history. Name + maker,
// normalized the same way search_text is, so "Apă Plată"/"Apa Plata" and a null
// vs empty maker collapse together — matching how the DB's merge key and
// bump_product_popularity() pair a product with itself.
//
// The parts join on NUL, which normalizeSearchText can never emit, so
// ("Apa Plata", "Dorna") and ("Apa", "Plata Dorna") stay distinct products.
export function productKey(name: string | null | undefined, maker: string | null | undefined): string {
  return `${normalizeSearchText(String(name ?? ''))}\u0000${normalizeSearchText(String(maker ?? ''))}`
}

// Fold a family's purchase_history rows into per-product stats.
//
// purchase_history is pruned to 60 checkouts / 30 days (migration 019), so this
// is inherently a rolling window of recent behaviour: no decay maths needed, the
// retention policy already forgets for us.
export function buildFamilyProductStats(rows: PurchaseHistoryRow[]): Map<string, FamilyProductStat> {
  const stats = new Map<string, FamilyProductStat>()

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

// Order catalog matches, dropping any duplicate product:
//   1. products this family buys — most often, then most recently
//   2. global popularity, for everything they have never bought
//   3. name, so the order is stable
//
// A history entry only participates by matching a candidate's key, so anything
// typed by hand that is not a catalog product (a bare "apa", a typo) contributes
// nothing and can never be suggested. The first candidate for a key wins.
export function rankSuggestions(
  candidates: ProductSuggestion[],
  familyStats: Map<string, FamilyProductStat>,
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
      const sa = familyStats.get(productKey(a.name, a.maker))
      const sb = familyStats.get(productKey(b.name, b.maker))

      // Bought before beats never bought, whatever the world thinks of it.
      if (Boolean(sa) !== Boolean(sb)) return sa ? -1 : 1
      if (sa && sb) {
        if (sa.count !== sb.count) return sb.count - sa.count
        if (sa.lastPurchasedAt !== sb.lastPurchasedAt) return sb.lastPurchasedAt - sa.lastPurchasedAt
      }

      const pa = Number(a.popularity) || 0
      const pb = Number(b.popularity) || 0
      if (pa !== pb) return pb - pa

      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
    .slice(0, limit)
}
