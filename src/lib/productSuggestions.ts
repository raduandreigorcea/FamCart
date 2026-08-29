import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildHouseholdProductStats,
  matchHouseholdStats,
  productKey,
  rankSuggestions,
  type HouseholdProductStat,
  type ProductSuggestion,
} from './productSearch'
import { barcodeCandidates } from './barcodeScanner'
import { getCatalogSupabase } from '../supabase'
import type { AddedProduct } from './shoppingListActions'
import { topHouseholdProducts } from './productRecents'
import {
  DISCOVER_DELAY_MS,
  DISCOVER_MIN_CHARS,
  discoverProducts,
  localAnswersQuery,
} from './catalogDiscovery'
import type { Market } from './region'
import type { ShoppingItemRow } from './householdRealtime'

// Everything behind the add form's search box: what the catalog is asked, what
// this household's history does to the order, and what the screen offers before
// anything is typed.
//
// The catalog is the only SOURCE of suggestions; history only decides their
// order. History is not a catalog — it holds whatever anyone typed into the
// list, so a lazy "apa" entry would otherwise be offered as a product, outrank
// every real one, and entrench itself by being picked again.
//
// Extracted from HomeView, where it sat among six other concerns. It brings the
// purchase-history fold with it, because the same numbers rank the suggestions
// and answer "has this household ever shopped" for the empty list.

export interface ProductSuggestions {
  suggestions: Ref<ProductSuggestion[]>
  suggestionsLoading: Ref<boolean>
  /** The catalog row the user picked, whose maker rides along with the item. */
  selectedProduct: Ref<ProductSuggestion | null>
  /** True while the phone's full-screen search is up, which earns more rows. */
  searchExpanded: Ref<boolean>
  canAddCustomProduct: Ref<boolean>
  /** This household's purchase habits: the ranking signal, and the empty state's answer. */
  householdProductStats: Ref<Map<string, HouseholdProductStat>>
  /** Whether the fold has run. An empty map means "none" only once it has. */
  productStatsLoaded: Ref<boolean>
  loadHouseholdProductStats: () => Promise<void>
  /**
   * Forget everything scoped to the household being left, before the next one
   * loads.
   *
   * Owned here rather than done by the caller. HomeView used to clear
   * householdProductStats and productStatsLoaded itself on a switch, which meant
   * this composable's reset rule lived at a call site that could not see the
   * rest of its state — and did not: recentsExcluded, a picked product and the
   * last-added confirmation all belonged to the previous household and all
   * survived the switch. The second of those had already caused a visible bug
   * once (an empty list in a new household reading "All bought"), which is the
   * kind that comes back every time state is added here and not there.
   */
  resetForHousehold: () => void
  /** The regulars, for the search screen before anything is typed. */
  recentProducts: Ref<ProductSuggestion[]>
  /** The same list, shorter, for the empty list's one-tap adds. */
  restartProducts: Ref<ProductSuggestion[]>
  /** Find the product a scanned barcode names, or null if the catalog has none. */
  lookupBarcode: (code: string) => Promise<ProductSuggestion | null>
  lastAdded: Ref<{ name: string; maker: string | null } | null>
  reportAdded: (name: string, maker?: string | null) => void
  /** Take the confirmation back when the add turns out not to have landed. */
  clearLastAdded: () => void
  recordProductAdd: (product: AddedProduct) => void
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
// globally-popular strangers before this household's own products get a look in.
// The trigram index does the filtering either way, so the cost is the sort and
// the payload, not the match.
const SUGGEST_POOL = 100
const RECENT_LIMIT = 8
const RESTART_LIMIT = 6

export function useProductSuggestions(options: {
  db: SupabaseClient
  householdId: Ref<string | null>
  items: Ref<ShoppingItemRow[]>
  /** What is currently typed into the add form. */
  query: Ref<string>
  isOffline: () => boolean
  /**
   * Where this person shops, detected from the device timezone, or null when
   * the timezone is one the catalog does not cover.
   *
   * A getter rather than a ref, and read fresh on every search, for the same
   * reason isOffline is a function: it is a question with a current answer
   * rather than a value to keep in step. A phone that crosses a border is
   * answering differently by the next keystroke, with no plumbing between.
   */
  region: () => Market | null
  /**
   * The language this person reads, which is the one the app is in.
   *
   * A getter for the same reason as region, and it matters more here: setLocale
   * takes effect immediately, so switching the app to Romanian must reorder the
   * next search rather than the next session.
   */
  locale: () => string
}): ProductSuggestions {
  const { db, householdId, items, query, isOffline, region, locale } = options

  const suggestions = ref<ProductSuggestion[]>([])
  const suggestionsLoading = ref(false)
  const selectedProduct = ref<ProductSuggestion | null>(null)
  const searchExpanded = ref(false)
  const householdProductStats = ref<Map<string, HouseholdProductStat>>(new Map())
  const productStatsLoaded = ref(false)
  const lastAdded = ref<{ name: string; maker: string | null } | null>(null)

  let suggestTimer: ReturnType<typeof setTimeout> | null = null
  let suggestRequestId = 0

  // Which project each suggestion currently on screen came from, keyed the way
  // productSearch identifies a product. recordProductAdd reads it to send the
  // popularity bump to the database holding the row; an unknown key means the
  // product came from purchase history rather than from a search, and both get
  // asked. See the note there.
  const suggestionOrigins = new Map<string, 'catalog' | 'local'>()

  const suggestLimit = computed(() =>
    searchExpanded.value ? SUGGEST_LIMIT_EXPANDED : SUGGEST_LIMIT,
  )

  // The escape hatch, offered as soon as the query is long enough to have been
  // searched for — including when nothing matched, which is when it matters most.
  const canAddCustomProduct = computed(() => query.value.trim().length >= SUGGEST_MIN_CHARS)

  // What the search screen opens on before anything is typed, and what the empty
  // list offers as one-tap adds. Groceries are mostly repeats, so the most useful
  // thing either space can hold is the shortcut past typing altogether.
  // householdProductStats is already loaded for ranking, so this costs no query.
  // What was already on the list when the search screen opened, frozen there.
  //
  // The exclusion itself is right -- something already on the list is not much of
  // a shortcut -- but reading it live made the row you had just tapped stop
  // qualifying and disappear out from under your finger. That was coherent while
  // adding cleared the query and put the screen away; it is not now that the
  // query, the results and the tapped row all stay, with a tick on it, so a
  // second tap can ask for a second one.
  //
  // Frozen at open rather than never applied: the answer to "is this worth
  // offering" belongs to the moment the offer is made, and nothing the user does
  // inside that screen should rearrange the things they are choosing between.
  const recentsExcluded = ref<string[]>([])

  watch(searchExpanded, (open) => {
    if (open) {
      recentsExcluded.value = items.value.map((item) =>
        productKey(item.name, item.maker as string | null),
      )
    }
  })

  const recentProducts = computed(() =>
    topHouseholdProducts(householdProductStats.value, {
      limit: RECENT_LIMIT,
      exclude: recentsExcluded.value,
    }),
  )

  // The same list, shorter, for the empty state's one-tap adds. Live rather than
  // frozen: it is drawn under an empty list, so there is nothing to exclude, and
  // it has no screen of its own to hold still -- a chip whose product lands on the
  // list has done its job and the list is right there showing it.
  const restartProducts = computed(() =>
    topHouseholdProducts(householdProductStats.value, {
      limit: RESTART_LIMIT,
      exclude: items.value.map((item) => productKey(item.name, item.maker as string | null)),
    }),
  )

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

  // See the note on the interface. Ordered as: what the next household has to
  // re-answer, then what the previous one had already answered.
  function resetForHousehold(): void {
    householdProductStats.value = new Map()
    // Deliberately false rather than left alone: an empty map reads as "never
    // shopped" until the refetch lands, which is what made a new household's
    // empty list flash "Nothing here yet" before turning into "All bought".
    productStatsLoaded.value = false
    // Frozen from the previous household's list when its search screen opened.
    recentsExcluded.value = []
    // All three describe the catalog query, the pick and the add that belonged
    // to the household being left. A stale one is not merely useless here, it is
    // about a different list.
    suggestions.value = []
    suggestionsLoading.value = false
    selectedProduct.value = null
    lastAdded.value = null
    // A response already on the wire must not land in the new household's
    // dropdown; bumping the id is what makes fetchSuggestions discard it.
    suggestRequestId++
    if (suggestTimer) {
      clearTimeout(suggestTimer)
      suggestTimer = null
    }
  }

  async function fetchSuggestions(text: string): Promise<void> {
    if (isOffline()) {
      suggestionsLoading.value = false
      return
    }
    const requestId = ++suggestRequestId
    try {
      // Two catalogs, asked at once.
      //
      // The global reference catalog is its own Supabase project, shared live by
      // production and development; this household's contributed products and
      // anything promoted out of them stay in the app database. So a full answer
      // is the union of two searches, and they go out concurrently rather than
      // in sequence: the slower of the two is the wait, not their sum.
      //
      // Both are the same RPC by name, and neither is a filter chain, which is
      // what buys word-order independence ("borsec apa" and "apa borsec" find
      // the same thing) and matching against search_blob, so a category alias
      // reaches a product in a language it is not named in.
      //
      // allSettled, not all: a rejecting Promise.all would throw away the
      // household's own products because a third project was slow. One source
      // failing must cost only that source.
      const catalogDb = getCatalogSupabase()

      // Two signals about this person, sent to the reference catalog only.
      //
      // The catalog holds 191,394 products and 190,394 of them name a market,
      // so without either of these a Romanian household ranks 37,008 French
      // products above its own 9,011 Romanian ones — popularity is measured
      // across all of Europe, and every French product wins it.
      //
      // LANGUAGE FIRST, MARKET SECOND, and search_catalog encodes that order
      // rather than this file: p_langs decides whether a name can be read,
      // p_markets whether the product is on a nearby shelf, and the first
      // question is the one somebody typing into a search box is really asking.
      // "Sour Cream & Onion" is no use to a household that wanted "cu smantana
      // si ceapa", however close the shop is.
      //
      // Both DEMOTE rather than filter: a non-matching row sorts last, it does
      // not disappear. That is deliberate and worth preserving — a hard filter
      // would give a household in a thin market, or searching a term the
      // catalog only holds under a foreign name, an empty dropdown
      // indistinguishable from "we have never heard of that product", which is
      // the worst failure a search box has.
      //
      // Spread rather than `p_markets: null`, because PostgREST resolves an RPC
      // by the argument names in the body. Omitting the key entirely keeps the
      // no-region call byte-identical to the one that shipped before this
      // existed, which is what makes "no preference" mean "exactly as before".
      const markets = region()
      // Sent as a one-element array because search_catalog takes text[]. It
      // does the English fallback itself — a Romanian caller gets Romanian
      // names, then English ones, then everything else — so there is no second
      // language to add here, and adding one would silently promote it above
      // that fallback.
      const langs = locale()

      // Neither is sent to the app database, which has no markets or name_lang
      // column and wants none. Its rows are this household's own contributions
      // plus the curated seed, and its search_catalog already sorts them above
      // popularity. There is nothing there that should ever be demoted for
      // being foreign — the household typed it in themselves, in whatever
      // language they typed it in.
      const [globalRes, localRes] = await Promise.allSettled([
        catalogDb
          ? catalogDb.rpc('search_catalog', {
              p_query: text,
              p_limit: SUGGEST_POOL,
              ...(markets ? { p_markets: [markets] } : {}),
              ...(langs ? { p_langs: [langs] } : {}),
            })
          : Promise.resolve({ data: [], error: null }),
        db.rpc('search_catalog', {
          p_query: text,
          p_household_id: householdId.value || null,
          p_limit: SUGGEST_POOL,
        }),
      ])
      // Stale response: a newer keystroke queried already, and that request owns
      // the dropdown now — including when its skeleton stops.
      if (requestId !== suggestRequestId) return
      // Late response: the input was cleared or a product picked meanwhile, so
      // these matches must not reopen the list.
      if (selectedProduct.value || query.value.trim().length < SUGGEST_MIN_CHARS) return

      const rowsOf = (
        settled: PromiseSettledResult<{ data: unknown; error: unknown }>,
      ): ProductSuggestion[] =>
        settled.status === 'fulfilled' && !settled.value.error
          ? ((settled.value.data ?? []) as ProductSuggestion[])
          : []

      const globalRows = rowsOf(globalRes)
      const localRows = rowsOf(localRes)

      // Which project each product came from, so the popularity bump goes to the
      // row the user actually saw. Rebuilt per search: it only ever describes
      // what is on screen now, which also keeps it from growing all session.
      suggestionOrigins.clear()
      for (const row of globalRows) suggestionOrigins.set(productKey(row.name, row.maker), 'catalog')
      // Local second, so a product in both is remembered as local: its row is
      // the one carrying this household's own add_count, and the app database is
      // where a promoted row keeps earning.
      for (const row of localRows) suggestionOrigins.set(productKey(row.name, row.maker), 'local')

      // The pool is capped and ordered globally, so a product this household buys
      // every week can be crowded out of it entirely by a catalog this large.
      // householdProductStats is already loaded, so recovering those matches costs
      // no network. Catalog rows go first: rankSuggestions dedupes first-wins,
      // so the catalog's spelling and popularity win wherever it did return the
      // product — including over a duplicate of it promoted in the app database.
      const candidates = [
        ...globalRows,
        ...localRows,
        ...matchHouseholdStats(text, householdProductStats.value, { limit: suggestLimit.value }),
      ]
      suggestions.value = rankSuggestions(candidates, householdProductStats.value, suggestLimit.value)

      // THE COLD PATH, and it starts only once the warm one has already
      // answered. Everything above this line is on screen; nothing below it can
      // delay a row or take one away. Deliberately not awaited — the local
      // answer is the answer, and this is an addition to it that arrives later
      // or not at all.
      if (!localAnswersQuery(candidates, text)) {
        void discoverMore(text, requestId, [...globalRows, ...localRows])
      }
    } catch {
      // Suggestions are a convenience; a failed lookup changes nothing.
    } finally {
      // Only the newest request may stop the skeleton. A superseded one
      // returning early must leave it spinning for the request that replaced it,
      // or the dropdown would flash "Can't find it?" mid-search.
      if (requestId === suggestRequestId) suggestionsLoading.value = false
    }
  }

  // Ask the catalog to go and find what it did not have.
  //
  // Runs behind its own delay ON TOP of the debounce that already gated the
  // search above, so somebody typing "detergent" at speed produces one external
  // call rather than six. Every early return below is a reason not to spend one.
  //
  // Guarded by requestId the same way fetchSuggestions is, and for a stricter
  // reason: this resolves seconds after the keystroke that started it, so the
  // chance of the dropdown having moved on is much higher than for a local
  // query. A stale discovery landing in the list would show products for a word
  // the person has finished deleting.
  async function discoverMore(
    text: string,
    requestId: number,
    local: ProductSuggestion[],
  ): Promise<void> {
    if (text.length < DISCOVER_MIN_CHARS) return
    const catalogDb = getCatalogSupabase()
    if (!catalogDb) return

    await new Promise((resolve) => setTimeout(resolve, DISCOVER_DELAY_MS))
    // Typed again during the delay: that keystroke owns the dropdown and will
    // do its own asking.
    if (requestId !== suggestRequestId || selectedProduct.value || isOffline()) return

    const found = await discoverProducts(catalogDb, {
      query: text,
      market: region(),
      language: locale(),
      local,
    })

    if (!found.length) return
    // Checked AGAIN after the call, not only before it. The request above is
    // the slow part, and everything that could have happened during the delay
    // could equally have happened during it.
    if (requestId !== suggestRequestId || selectedProduct.value) return

    // These rows live in the catalog project now — the function saved them
    // before returning them — so a bump for one has to go there. Without this
    // they would be treated as unknown-origin and the app database would be
    // asked about a product it has never held.
    for (const row of found) suggestionOrigins.set(productKey(row.name, row.maker), 'catalog')

    // Appended, never substituted. rankSuggestions dedupes first-wins, so what
    // was already on screen keeps its place and its order, and discoveries fill
    // whatever room is left. A person watching the dropdown sees rows arrive
    // rather than the list they were reading rearrange itself.
    suggestions.value = rankSuggestions(
      [...suggestions.value, ...found],
      householdProductStats.value,
      suggestLimit.value,
    )
  }

  // ─── scanning ──────────────────────────────────────────────────────────────
  // A barcode is an exact key, so this is the one lookup that does not go near
  // search_text, ranking, or the debounce: there is nothing to rank and nothing
  // to guess at. Scoped the same way fetchSuggestions is — the global catalog
  // plus this household's own contributions — which is what lets a product this
  // household named after a miss be found by the next scan.
  //
  // Ordered so a global row wins over a scoped one carrying the same code. The
  // global is the canonical spelling; the scoped row is what this household
  // called it before the catalog caught up.
  //
  // "Exact key" is doing less work than it looks. buildLoadPlan merges products
  // whose names normalize alike, so one row can answer to several codes, and
  // before alt_barcodes existed the merged-away codes answered to nothing at
  // all — 4,468 products that scanned to an empty result. lookup_barcode() is
  // what makes the key exact again.
  async function lookupBarcode(code: string): Promise<ProductSuggestion | null> {
    const candidates = barcodeCandidates(code)
    if (!candidates.length || isOffline()) return null
    try {
      const catalogDb = getCatalogSupabase()
      // Both projects, at once, for the same reason the search asks both: the
      // code may name an imported product or one this household named after a
      // scan that missed. allSettled so an unreachable catalog project still
      // lets the household's own row answer.
      const [globalRes, localRes] = await Promise.allSettled([
        // An RPC on the reference catalog, where the app database below is
        // still a plain select, and the asymmetry is real rather than untidy.
        // Only the catalog has alt_barcodes — the codes of products that
        // collapsed onto one row because their names normalize alike. A scan
        // has to match either column, and a printed barcode has to beat an
        // absorbed one, which is an ordering across two columns that belongs
        // beside them rather than in a PostgREST filter chain here.
        catalogDb
          ? catalogDb.rpc('lookup_barcode', { p_codes: candidates })
          : Promise.resolve({ data: [], error: null }),
        (householdId.value
          ? db
              .from('product_catalog')
              .select('name, maker, popularity')
              .in('barcode', candidates)
              .or(`household_id.is.null,household_id.eq.${householdId.value}`)
          : db
              .from('product_catalog')
              .select('name, maker, popularity')
              .in('barcode', candidates)
              .is('household_id', null)
        )
          .order('household_id', { ascending: true, nullsFirst: true })
          .order('popularity', { ascending: false })
          .limit(1),
      ])

      const firstOf = (
        settled: PromiseSettledResult<{ data: unknown; error: unknown }>,
      ): ProductSuggestion | null =>
        settled.status === 'fulfilled' && !settled.value.error
          ? (((settled.value.data ?? []) as ProductSuggestion[])[0] ?? null)
          : null

      // The imported row wins over a household's own, which is the same rule the
      // single-database version applied when it ordered globals first: the
      // catalog holds the canonical spelling, the scoped row holds what this
      // household called it before the catalog caught up.
      const global = firstOf(globalRes)
      const local = firstOf(localRes)
      const found = global ?? local
      if (found) {
        suggestionOrigins.set(productKey(found.name, found.maker), global ? 'catalog' : 'local')
      }
      return found
    } catch {
      // Treated as "the catalog does not have it", which puts the user on the
      // naming path rather than on an error they can do nothing about.
      return null
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

  // Fold this household's recent purchases into the ranking signal. Best-effort: on
  // failure suggestions just fall back to the global catalog order. Retention
  // (005_purchase_history.sql) already caps history at 60 checkouts / 30 days, so this is a
  // small, naturally-recent window and can be fetched whole.
  async function loadHouseholdProductStats(): Promise<void> {
    // Pinned before the await: this fetch can span a household switch, and a
    // response is only an answer for the household it was asked about. The
    // suggestions fetch guards the same race with suggestRequestId; here the
    // id itself is the request's identity.
    const requestedHouseholdId = householdId.value
    if (!requestedHouseholdId || isOffline()) {
      // Nothing is coming, so stop the empty list waiting on an answer it will
      // never get.
      productStatsLoaded.value = true
      return
    }
    try {
      const { data, error } = await db
        .from('purchase_history')
        .select('name, maker, purchased_at')
        .eq('household_id', requestedHouseholdId)
      // Stale: the household changed while this was in flight. Its rows would
      // become the new household's ranking signal — and its `finally` below
      // would claim the new household's still-pending answer has arrived,
      // which is what turns a fresh empty list into a false "All bought".
      if (householdId.value !== requestedHouseholdId) return
      if (error) return
      householdProductStats.value = buildHouseholdProductStats(data ?? [])
    } catch {
      // No stats just means suggestions rank globally, which is the old behaviour.
    } finally {
      // Every path resolves the question, including the failures above: a household
      // whose history we could not read is not a household that never shopped, but
      // it is one we cannot hold a blank screen for. Only for the household that
      // asked, though — a stale response answers nothing.
      if (householdId.value === requestedHouseholdId) productStatsLoaded.value = true
    }
  }

  // A catalog product just gets its popularity bumped. A custom one is
  // contributed to the catalog scoped to this household — suggested back to them
  // straight away, and promoted to a global suggestion only once enough other
  // households have added the same product (006_product_catalog.sql), so one household's
  // spelling cannot leak into everyone else's dropdown.
  //
  // A custom product named after a scan carries its barcode into that
  // contribution, which is what closes the scanning loop: the code missed once,
  // was named once, and every later scan of the same package — by anyone in the
  // household — finds it. The server validates the format and ignores anything
  // that is not a barcode, so nothing here has to.
  //
  // Best-effort either way: fire-and-forget, never blocks or errors the add, and
  // skipped offline (neither is part of the offline queue). Both RPCs are
  // throttled server-side as well (002_security_audit.sql).
  function recordProductAdd(product: AddedProduct): void {
    if (!product || isOffline()) return

    const ignore = (promise: PromiseLike<unknown>): void => {
      void promise.then(
        () => {},
        () => {},
      )
    }

    // A contribution is user data and always belongs to the app database. The
    // catalog project has no household column to scope it by, and the promotion
    // rule that eventually turns three households' contributions into one global
    // row runs there too.
    if (product.custom) {
      ignore(
        db.rpc('add_custom_product', {
          p_household_id: householdId.value,
          p_name: product.name,
          p_maker: product.maker ?? null,
          p_barcode: product.barcode ?? null,
        }),
      )
      return
    }

    // A bump has to reach the database holding the row, and the two projects
    // each carry a copy of this RPC with a different signature — the app's takes
    // a household to scope by, the catalog's has nothing to scope.
    //
    // An unknown origin means the product came from purchase history rather than
    // from either search, and history does not record where a product was found.
    // Both are asked in that case: each is a no-op where the row is not, they
    // are fire-and-forget already, and the rate limits are counted per project
    // so one add can never spend two of anything. Guessing instead would quietly
    // stop counting exactly the products this household buys most.
    const origin = suggestionOrigins.get(productKey(product.name, product.maker))
    const catalogDb = getCatalogSupabase()

    if (origin !== 'local' && catalogDb) {
      ignore(
        catalogDb.rpc('bump_product_popularity', {
          p_name: product.name,
          p_maker: product.maker ?? null,
        }),
      )
    }
    if (origin !== 'catalog') {
      ignore(
        db.rpc('bump_product_popularity', {
          p_name: product.name,
          p_maker: product.maker ?? null,
          p_household_id: householdId.value,
        }),
      )
    }
  }

  onBeforeUnmount(() => {
    if (suggestTimer) clearTimeout(suggestTimer)
  })

  return {
    suggestions,
    suggestionsLoading,
    selectedProduct,
    searchExpanded,
    canAddCustomProduct,
    householdProductStats,
    productStatsLoaded,
    loadHouseholdProductStats,
    resetForHousehold,
    recentProducts,
    restartProducts,
    lookupBarcode,
    lastAdded,
    reportAdded,
    clearLastAdded,
    recordProductAdd,
    clearSuggestions,
  }
}
