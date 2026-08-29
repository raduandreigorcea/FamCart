import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeSearchText, type ProductSuggestion } from './productSearch'
import type { Market } from './region'

// Asking the catalog to go and find something it does not have.
//
// THE COLD HALF of the search. `search_catalog` answers almost every keystroke
// out of rows that already exist; this is what happens when it cannot, and it is
// the only reason the catalog grows at all. A household types a product nobody
// has ever searched for, the catalog says nothing, and the `discover` edge
// function goes to Open Food Facts, validates what comes back, saves what
// survives, and hands it here. The next household to type it is answered
// locally.
//
// ─── three rules this file exists to enforce ────────────────────────────────
//
//   1. IT NEVER BLOCKS THE LOCAL ANSWER. The suggestions from the two databases
//      are already on screen before anything here runs. Discovery adds rows; it
//      does not delay the ones that were already there.
//   2. IT NEVER FAILS THE CALLER. Every path returns [] — an unreachable edge
//      function, a rejected token, a timeout, a malformed body. A shopping list
//      must keep working when a third-party food database does not, and this is
//      the one place in the app that talks to one.
//   3. IT ASKS AS SELDOM AS POSSIBLE. Local-first is not a slogan here: the
//      decision below is what stops every keystroke from becoming an outbound
//      request, and the edge function repeats the same check server-side so a
//      client that got it wrong still costs nothing but a round trip.

/**
 * Below this, do not ask anyone. Spec §6.
 *
 * Three characters, where the LOCAL search starts at two. The asymmetry is
 * deliberate: a two-character local prefix search is cheap and often useful
 * ("ou", "te"), while a two-character external search returns noise in
 * proportion to how common the letters are, and pays a network round trip for
 * it.
 */
export const DISCOVER_MIN_CHARS = 3

/**
 * How long to wait, after the local answer is on screen, before asking outside.
 *
 * ON TOP of the 300ms debounce that already gated the local search, not instead
 * of it — so a person typing "detergent" at speed produces one external call
 * rather than six. The number is chosen to sit past a normal inter-key gap: the
 * local dropdown is already filled by then, so nobody is waiting on this and
 * the only thing the delay costs is how soon a discovered row appears.
 */
export const DISCOVER_DELAY_MS = 400

/**
 * Did the local catalog actually answer the question?
 *
 * THE MOST IMPORTANT DECISION IN THIS FILE, because it decides how often
 * anything external happens. And it is deliberately about MATCH QUALITY rather
 * than result count, which is the version that looks equivalent and is not.
 *
 * Counting rows says "yes" to a search for "pepsi zero" that returned ten
 * drinks matched through a category name — the shelf it might be on, not the
 * product. So the test is instead: does any row contain EVERY word that was
 * typed? One row whose name holds all of them is a better answer than twenty
 * that do not.
 *
 * The same rule the database's own search applies with `like all (...)`, and
 * the same one the edge function re-applies before it spends anything. Three
 * copies is deliberate: this one saves a round trip, the server's is the one
 * that cannot be lied to.
 */
export function localAnswersQuery(rows: ProductSuggestion[], query: string): boolean {
  const tokens = normalizeSearchText(query).split(' ').filter(Boolean)
  if (!tokens.length) return true

  return rows.some((row) => {
    const hay = normalizeSearchText(`${row.name} ${row.maker ?? ''}`)
    return tokens.every((token) => hay.includes(token))
  })
}

export interface DiscoverOptions {
  query: string
  /** Where the phone thinks it is; a ranking hint upstream, never a filter. */
  market: Market | null
  /** The language the app is in, so the source is asked in the right one. */
  language: string | null
  /**
   * What the local search already returned. Sent so the function can skip
   * products this catalog already holds rather than proposing them back.
   *
   * Untrusted on the far side, and safe to be: a caller that sends nothing gets
   * an external search it did not need, one that sends fabricated rows gets
   * fewer discoveries, and neither can write anything.
   */
  local: ProductSuggestion[]
}

interface DiscoverResponse {
  products?: unknown
  discovered?: unknown
  reason?: unknown
}

/**
 * Call the discovery function, and never let it break anything.
 *
 * Uses `functions.invoke` on the CATALOG client rather than a hand-rolled
 * fetch, because that client already carries the Clerk token resolver — the
 * same session token that authenticates its RPCs authenticates this, and the
 * function refuses anything that is not signed in.
 */
export async function discoverProducts(
  catalogDb: SupabaseClient,
  options: DiscoverOptions,
): Promise<ProductSuggestion[]> {
  const query = options.query.trim()
  if (query.length < DISCOVER_MIN_CHARS) return []

  try {
    const { data, error } = await catalogDb.functions.invoke<DiscoverResponse>('discover', {
      body: {
        query,
        ...(options.market ? { market: options.market } : {}),
        ...(options.language ? { language: options.language } : {}),
        // Bounded before it leaves: the function caps this anyway, and sending
        // a hundred rows to be told about eight is the caller's waste to avoid.
        local: options.local.slice(0, 40).map((r) => ({
          name: r.name,
          maker: r.maker ?? null,
          popularity: r.popularity ?? 0,
        })),
      },
    })

    if (error || !data || !Array.isArray(data.products)) return []

    // Shaped rather than trusted. These rows came from an external product
    // database by way of an edge function, and they are about to be rendered
    // and, if picked, written to a shopping list.
    return (data.products as unknown[])
      .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === 'object')
      .map((p) => ({
        name: String(p.name ?? '').trim(),
        maker: p.maker == null ? null : String(p.maker).trim() || null,
        // Always zero from a discovery: a product nobody has added yet has
        // earned nothing, and it must not arrive claiming otherwise and sort
        // above products this household actually buys.
        popularity: 0,
      }))
      .filter((p) => p.name)
  } catch {
    // Rule 2. There is no failure here worth surfacing on top of a search box
    // that is already showing results.
    return []
  }
}
