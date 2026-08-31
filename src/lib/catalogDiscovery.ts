import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeSearchText, type ProductSuggestion } from './productSearch'
import type { Market } from './region'

// Asking the catalog to go and find something it does not have.
//
// THE COLD HALF of the search. `search_catalog` answers almost every keystroke
// out of rows that already exist; this is what happens when it cannot, and it is
// the only reason the catalog grows at all. A household types a product nobody
// has ever searched for, the catalog says nothing, and the `discover` edge
// function goes to the three Open*Facts databases — food, household products
// and beauty — validates what comes back, saves what survives, and hands it
// here. The next household to type it is answered locally.
//
// ─── three rules this file exists to enforce ────────────────────────────────
//
//   1. IT NEVER BLOCKS THE LOCAL ANSWER. The suggestions from the two databases
//      are already on screen before anything here runs. Discovery adds rows; it
//      does not delay the ones that were already there.
//   2. IT NEVER FAILS THE CALLER. Every path returns [] — an unreachable edge
//      function, a rejected token, a timeout, a malformed body. A shopping list
//      must keep working when a third-party product database does not, and this
//      is the one place in the app that talks to one.
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
 * How many BUYABLE local answers count as the question being answered.
 *
 * Six, which is what the dropdown shows on a phone. THIS NUMBER AND THE RULE
 * BELOW ARE MIRRORED in the catalog's own `isLocalSufficient` (SUFFICIENT_MATCHES
 * there), the same way the fold has three copies: this one saves a round trip,
 * the server's is the one that cannot be lied to. Change one and change both.
 *
 * The rule it replaces was "at least one row contains every word typed", and it
 * had a failure nobody predicted until it was watched in production: the
 * curated seed's own GENERIC rows satisfy it. A search for "apa" (water) found
 * a seed row literally named "Apă", declared the question answered, and so
 * discovery NEVER RAN for it — not once, ever. The dropdown stayed frozen at
 * the six waters the seed shipped with while AQUA Carpatica, Azuga and Bucovina
 * sat one call away, and the same was true of lapte, paine and every other
 * everyday word. Obscure queries grew the catalog; common ones could not.
 */
export const SUFFICIENT_MATCHES = 6

/**
 * Did the local catalog actually answer the question?
 *
 * THE MOST IMPORTANT DECISION IN THIS FILE, because it decides how often
 * anything external happens.
 *
 * Two things have to be true, and the first is about MATCH QUALITY rather than
 * count — the version that looks equivalent and is not. Counting alone says
 * "yes" to a search for "pepsi zero" that returned ten drinks matched through a
 * category name: the shelf it might be on, not the product. So a row only
 * counts if it contains EVERY word that was typed.
 *
 * The second is that there have to be enough of them TO CHOOSE FROM, counted in
 * branded rows only. A row with no maker is a concept rather than a product —
 * "Apă" on a list makes whoever is holding it guess — which is the same
 * judgement that kept fifty brandless concepts out of the seed.
 */
/**
 * What the searched word MEANS, as `search_catalog` reported it.
 *
 * Null whenever no concept claimed the word, which is most queries — a brand, a
 * package size, something nobody has named yet — and null is treated as
 * 'branded' here for the same reason the server does: an unknown word is one
 * the catalog has never been asked about, and the useful assumption is that
 * there is a product out there we do not stock.
 */
export type ConceptIntent = 'generic' | 'branded' | 'mixed'

export function localAnswersQuery(
  rows: ProductSuggestion[],
  query: string,
  intent: ConceptIntent | null = null,
): boolean {
  const tokens = normalizeSearchText(query).split(' ').filter(Boolean)
  if (!tokens.length) return true

  const answers = rows.filter((row) => {
    const hay = normalizeSearchText(`${row.name} ${row.maker ?? ''}`)
    return tokens.every((token) => hay.includes(token))
  })
  if (!answers.length) return false

  // A GENERIC concept is answered by the bare row, and no external database has
  // a better answer to give. Potatoes have no brands and never will, so without
  // this every produce query pays for a round trip whose only possible reply is
  // "the row you already have is the right one". This is the half that the
  // branded-row count got wrong in the other direction, and the reason the
  // catalog needed to know what a word MEANS rather than how many rows it hit.
  if (intent === 'generic') return true

  return answers.filter((r) => (r.maker ?? '').trim().length > 0).length >= SUFFICIENT_MATCHES
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

interface DiscoverBarcodeResponse {
  product?: unknown
  discovered?: unknown
  reason?: unknown
}

/** One row from the function, shaped rather than trusted. */
function asSuggestion(raw: unknown): ProductSuggestion | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  const name = String(p.name ?? '').trim()
  if (!name) return null
  return {
    name,
    maker: p.maker == null ? null : String(p.maker).trim() || null,
    // Always zero from a discovery: a product nobody has added yet has earned
    // nothing, and it must not arrive claiming otherwise and sort above
    // products this household actually buys.
    popularity: 0,
  }
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
      .map(asSuggestion)
      .filter((p): p is ProductSuggestion => p !== null)
  } catch {
    // Rule 2. There is no failure here worth surfacing on top of a search box
    // that is already showing results.
    return []
  }
}

/**
 * A scanned code neither database knew.
 *
 * THE SAME COLD PATH, arrived at differently. A search reaches it because the
 * words typed matched nothing good enough; a scan reaches it because an exact
 * key matched nothing at all — which is a stronger signal, and the reason this
 * one is worth asking about immediately rather than behind a delay.
 *
 * The three rules at the top of this file all still hold. In particular rule 2:
 * a scan that cannot be resolved must leave the person exactly where they were,
 * which is in front of the "add it yourself" flow, rather than in front of an
 * error about a third-party database.
 */
export async function discoverBarcode(
  catalogDb: SupabaseClient,
  codes: string[],
): Promise<ProductSuggestion | null> {
  const valid = codes.filter((c) => /^[0-9]{8,14}$/.test(c)).slice(0, 4)
  if (!valid.length) return null

  try {
    const { data, error } = await catalogDb.functions.invoke<DiscoverBarcodeResponse>('discover', {
      body: { barcode: valid },
    })
    if (error || !data) return null
    return asSuggestion(data.product)
  } catch {
    return null
  }
}
