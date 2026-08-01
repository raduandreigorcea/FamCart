import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildFamilyProductStats,
  escapeIlikePattern,
  matchFamilyStats,
  normalizeSearchText,
  productKey,
  rankSuggestions,
  type FamilyProductStat,
  type ProductSuggestion,
} from './productSearch'
import { topFamilyProducts } from './productRecents'
import type { ShoppingItemRow } from './familyRealtime'

// Everything behind the add form's search box: what the catalog is asked, what
// this family's history does to the order, and what the screen offers before
// anything is typed.
//
// The catalog is the only SOURCE of suggestions; history only decides their
// order. History is not a catalog — it holds whatever anyone typed into the
// list, so a lazy "apa" entry would otherwise be offered as a product, outrank
// every real one, and entrench itself by being picked again.
//
// Extracted from HomeView, where it sat among six other concerns. It brings the
// purchase-history fold with it, because the same numbers rank the suggestions
// and answer "has this family ever shopped" for the empty list.

export interface ProductSuggestions {
  suggestions: Ref<ProductSuggestion[]>
  suggestionsLoading: Ref<boolean>
  /** The catalog row the user picked, whose maker rides along with the item. */
  selectedProduct: Ref<ProductSuggestion | null>
  /** True while the phone's full-screen search is up, which earns more rows. */
  searchExpanded: Ref<boolean>
  suggestLimit: Ref<number>
  canAddCustomProduct: Ref<boolean>
  /** This family's purchase habits: the ranking signal, and the empty state's answer. */
  familyProductStats: Ref<Map<string, FamilyProductStat>>
  /** Whether the fold has run. An empty map means "none" only once it has. */
  productStatsLoaded: Ref<boolean>
  loadFamilyProductStats: () => Promise<void>
  /** The regulars, for the search screen before anything is typed. */
  recentProducts: Ref<ProductSuggestion[]>
  /** The same list, shorter, for the empty list's one-tap adds. */
  restartProducts: Ref<ProductSuggestion[]>
  lastAdded: Ref<{ name: string; maker: string | null } | null>
  reportAdded: (name: string, maker?: string | null) => void
  /** Take the confirmation back when the add turns out not to have landed. */
  clearLastAdded: () => void
  recordProductAdd: (product: ProductSuggestion & { custom?: boolean }) => void
  clearSuggestions: () => void
}

// Long enough to mean "stopped typing" on a phone. Thumb-typing runs ~300-400ms
// per character, so a shorter pause elapses between ordinary keystrokes and
// every character would cost its own request.
const SUGGEST_DEBOUNCE_MS = 300
const SUGGEST_MIN_CHARS = 2
const SUGGEST_LIMIT = 6
// On a phone the form lifts to the top of the screen when focused, and the
// dropdown gets the whole screen instead of a 275px slot. Twice the room is
// worth twice the matches; the pool below already dwarfs both numbers, so this
// costs nothing but stops throwing ranked matches away.
const SUGGEST_LIMIT_EXPANDED = 12
// Wide enough that a common two-character prefix does not fill the pool with
// globally-popular strangers before this family's own products get a look in.
// The trigram index does the filtering either way, so the cost is the sort and
// the payload, not the match.
const SUGGEST_POOL = 100
const RECENT_LIMIT = 8
const RESTART_LIMIT = 6

export function useProductSuggestions(options: {
  db: SupabaseClient
  familyId: Ref<string | null>
  items: Ref<ShoppingItemRow[]>
  /** What is currently typed into the add form. */
  query: Ref<string>
  isOffline: () => boolean
}): ProductSuggestions {
  const { db, familyId, items, query, isOffline } = options

  const suggestions = ref<ProductSuggestion[]>([])
  const suggestionsLoading = ref(false)
  const selectedProduct = ref<ProductSuggestion | null>(null)
  const searchExpanded = ref(false)
  const familyProductStats = ref<Map<string, FamilyProductStat>>(new Map())
  const productStatsLoaded = ref(false)
  const lastAdded = ref<{ name: string; maker: string | null } | null>(null)

  let suggestTimer: ReturnType<typeof setTimeout> | null = null
  let suggestRequestId = 0

  const suggestLimit = computed(() =>
    searchExpanded.value ? SUGGEST_LIMIT_EXPANDED : SUGGEST_LIMIT,
  )

  // The escape hatch, offered as soon as the query is long enough to have been
  // searched for — including when nothing matched, which is when it matters most.
  const canAddCustomProduct = computed(() => query.value.trim().length >= SUGGEST_MIN_CHARS)

  // What the search screen opens on before anything is typed, and what the empty
  // list offers as one-tap adds. Groceries are mostly repeats, so the most useful
  // thing either space can hold is the shortcut past typing altogether.
  // familyProductStats is already loaded for ranking, so this costs no query.
  const recentProducts = computed(() =>
    topFamilyProducts(familyProductStats.value, {
      limit: RECENT_LIMIT,
      // Already on the list is not something to add again.
      exclude: items.value.map((item) => productKey(item.name, item.maker as string | null)),
    }),
  )

  // The same list, shorter. A prefix rather than a second query, because the
  // order is the same one either way.
  const restartProducts = computed(() => recentProducts.value.slice(0, RESTART_LIMIT))

  // What just landed, for the search screen to confirm — while it is up, the list
  // is behind it and a tap would otherwise have no visible result. Reported at
  // the point the row is actually on the list rather than when the tap happened,
  // so a rejected add never claims to have worked. A fresh object each time, so
  // adding the same product twice reads as two adds.
  function reportAdded(name: string, maker?: string | null): void {
    lastAdded.value = { name, maker: maker ?? null }
  }

  function clearLastAdded(): void {
    lastAdded.value = null
  }

  function clearSuggestions(): void {
    suggestions.value = []
  }

  async function fetchSuggestions(text: string): Promise<void> {
    if (isOffline()) {
      suggestionsLoading.value = false
      return
    }
    const requestId = ++suggestRequestId
    try {
      const pattern = `%${escapeIlikePattern(normalizeSearchText(text))}%`
      let pool = db
        .from('product_catalog')
        .select('name, maker, popularity')
        .ilike('search_text', pattern)
      // Scope to the global catalog plus THIS family's own contributions. RLS
      // already blocks other families' rows, but a user in more than one family
      // would otherwise see (and, via recordProductAdd, bump) the products they
      // contributed elsewhere while shopping here. familyId is a server-issued
      // uuid, never typed input, so it is safe to interpolate into the filter.
      pool = familyId.value
        ? pool.or(`family_id.is.null,family_id.eq.${familyId.value}`)
        : pool.is('family_id', null)
      const { data, error } = await pool
        // Popularity decides which matches make the pool, then rankSuggestions
        // reorders it around this family. Ordering here (rather than only
        // locally) is what keeps the pool cap from cutting off globally-popular
        // products.
        .order('popularity', { ascending: false })
        .order('name')
        .limit(SUGGEST_POOL)
      // Stale response: a newer keystroke queried already, and that request owns
      // the dropdown now — including when its skeleton stops.
      if (requestId !== suggestRequestId) return
      // Late response: the input was cleared or a product picked meanwhile, so
      // these matches must not reopen the list.
      if (error || selectedProduct.value || query.value.trim().length < SUGGEST_MIN_CHARS) return
      // The pool is capped and ordered globally, so a product this family buys
      // every week can be crowded out of it entirely by a catalog this large.
      // familyProductStats is already loaded, so recovering those matches costs
      // no network. Catalog rows go first: rankSuggestions dedupes first-wins,
      // so the catalog's spelling and popularity win wherever it did return the
      // product.
      const candidates = [
        ...((data ?? []) as ProductSuggestion[]),
        ...matchFamilyStats(text, familyProductStats.value, { limit: suggestLimit.value }),
      ]
      suggestions.value = rankSuggestions(candidates, familyProductStats.value, suggestLimit.value)
    } catch {
      // Suggestions are a convenience; a failed lookup changes nothing.
    } finally {
      // Only the newest request may stop the skeleton. A superseded one
      // returning early must leave it spinning for the request that replaced it,
      // or the dropdown would flash "Can't find it?" mid-search.
      if (requestId === suggestRequestId) suggestionsLoading.value = false
    }
  }

  watch(query, (value) => {
    const text = value.trim()
    // Editing away from a picked suggestion drops its maker; retyping the exact
    // product name without re-picking keeps it (same product, same subtitle).
    if (selectedProduct.value && text !== selectedProduct.value.name) {
      selectedProduct.value = null
    }
    if (suggestTimer) clearTimeout(suggestTimer)
    if (text.length < SUGGEST_MIN_CHARS || selectedProduct.value) {
      suggestions.value = []
      suggestionsLoading.value = false
      return
    }
    // The last query's matches are not this query's answers, so drop them and
    // show the skeleton from the first keystroke — across the debounce as well
    // as the request, since both are time the user spends waiting. Without this
    // the dropdown would offer "Can't find it?" while the search is still
    // running.
    suggestions.value = []
    suggestionsLoading.value = true
    suggestTimer = setTimeout(() => void fetchSuggestions(text), SUGGEST_DEBOUNCE_MS)
  })

  // Fold this family's recent purchases into the ranking signal. Best-effort: on
  // failure suggestions just fall back to the global catalog order. Retention
  // (migration 019) already caps history at 60 checkouts / 30 days, so this is a
  // small, naturally-recent window and can be fetched whole.
  async function loadFamilyProductStats(): Promise<void> {
    if (!familyId.value || isOffline()) {
      // Nothing is coming, so stop the empty list waiting on an answer it will
      // never get.
      productStatsLoaded.value = true
      return
    }
    try {
      const { data, error } = await db
        .from('purchase_history')
        .select('name, maker, purchased_at')
        .eq('family_id', familyId.value)
      if (error) return
      familyProductStats.value = buildFamilyProductStats(data ?? [])
    } catch {
      // No stats just means suggestions rank globally, which is the old behaviour.
    } finally {
      // Every path resolves the question, including the failures above: a family
      // whose history we could not read is not a family that never shopped, but
      // it is one we cannot hold a blank screen for.
      productStatsLoaded.value = true
    }
  }

  // A catalog product just gets its popularity bumped. A custom one is
  // contributed to the catalog scoped to this family — suggested back to them
  // straight away, and promoted to a global suggestion only once enough other
  // families have added the same product (migration 022), so one family's
  // spelling cannot leak into everyone else's dropdown.
  //
  // Best-effort either way: fire-and-forget, never blocks or errors the add, and
  // skipped offline (neither is part of the offline queue). Both RPCs are
  // throttled server-side as well (migration 032).
  function recordProductAdd(product: ProductSuggestion & { custom?: boolean }): void {
    if (!product || isOffline()) return
    const call = product.custom
      ? db.rpc('add_custom_product', {
          p_family_id: familyId.value,
          p_name: product.name,
          p_maker: product.maker ?? null,
        })
      : db.rpc('bump_product_popularity', {
          p_name: product.name,
          p_maker: product.maker ?? null,
          p_family_id: familyId.value,
        })
    void call.then(
      () => {},
      () => {},
    )
  }

  onBeforeUnmount(() => {
    if (suggestTimer) clearTimeout(suggestTimer)
  })

  return {
    suggestions,
    suggestionsLoading,
    selectedProduct,
    searchExpanded,
    suggestLimit,
    canAddCustomProduct,
    familyProductStats,
    productStatsLoaded,
    loadFamilyProductStats,
    recentProducts,
    restartProducts,
    lastAdded,
    reportAdded,
    clearLastAdded,
    recordProductAdd,
    clearSuggestions,
  }
}
