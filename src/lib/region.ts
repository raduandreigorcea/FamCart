// Where the phone is, guessed from its timezone and never asked for.
//
// The catalog holds 191,394 products and 190,394 of them name the markets they
// are sold in. Until this existed the app never told the catalog where the
// searcher was, so a household in Romania ranked 37,008 French and 33,813
// German products against its own 9,011 Romanian ones, ordered by a popularity
// measured across all of Europe. Every French product won.
//
// NOBODY IS ASKED, and this module is what is left after the question was
// withdrawn. It used to back a Shopping Region picker in App Settings that
// stored a chosen market per account; there is no picker now, no storage, and
// no `userId` in any signature here.
//
// The picker went because it was answering the wrong question. What a person
// actually noticed was product names they could not read -- "Sour Cream &
// Onion" where they wanted "cu smantana si ceapa" -- and a country is a clumsy
// proxy for that. The catalog now carries product_catalog.name_lang and
// search_catalog ranks on it first, fed by the language the app is already in,
// so the readable name comes up without anyone touching a setting.
//
// LANGUAGE IS STILL NOT LOCATION -- someone can run their phone in English and
// do their shopping in Bucharest -- which is exactly why this module was not
// deleted along with the picker. The timezone is the one signal a phone carries
// that tracks where its owner IS rather than what they read, and it stays the
// input to p_markets. Language says whether you can read a product, market says
// whether you can buy it, and search_catalog ranks on both in that order.
// The importer carried the older assumption in a comment on its country-code
// table -- "The app will derive its p_markets from a locale" -- and this module
// is still that assumption corrected.
//
// THE ONE THING LOST WITH THE PICKER is the manual override. A traveller, a
// VPN, or a phone on a factory-default timezone now has no way to correct the
// guess. That is affordable only because the guess no longer decides much:
// getting the market wrong reorders within a language, and the language is
// read from the app itself and cannot be wrong the same way.
//
// Deliberately Vue-free and catalog-free, the same shape as lib/locale and
// lib/theme: pure functions with nothing injected but their arguments, so
// nothing here needs a DOM to test and no screen owns the state.

/**
 * The markets the catalog can actually speak about.
 *
 * These eleven MUST stay in step with whatever writes product_catalog.markets
 * in the catalog project. A code detected here that the importer never writes
 * would match no product at all, so a phone in that timezone would have the
 * entire catalog demoted -- which looks exactly like the bug this fixes.
 *
 * A test used to pin this list against the importer's own country-code table.
 * That repo is gone, so the check is gone with it and this list is currently
 * unguarded: whatever refills the catalog has to be checked against these
 * eleven by hand, or pinned by a test again once it exists.
 */
export const MARKETS = ['RO', 'MD', 'DE', 'AT', 'CH', 'ES', 'FR', 'BE', 'IT', 'GB', 'IE'] as const

export type Market = (typeof MARKETS)[number]

/**
 * IANA zones to markets.
 *
 * navigator.languages says 'en-US' for an English phone in Bucharest;
 * Europe/Bucharest says Romania. See the header.
 *
 * Only zones belonging to the eleven markets are listed, and several countries
 * own more than one: Spain has the Canaries and Ceuta, Germany has Busingen
 * (the enclave inside Switzerland, which keeps its own zone). Anything else
 * returns null, which means no market is sent at all -- see
 * detectRegionFromTimeZone.
 */
const TIMEZONE_MARKETS: Record<string, Market> = {
  'Europe/Bucharest': 'RO',
  'Europe/Chisinau': 'MD',
  'Europe/Tiraspol': 'MD',
  'Europe/Berlin': 'DE',
  'Europe/Busingen': 'DE',
  'Europe/Vienna': 'AT',
  'Europe/Zurich': 'CH',
  'Europe/Madrid': 'ES',
  'Africa/Ceuta': 'ES',
  'Atlantic/Canary': 'ES',
  'Europe/Paris': 'FR',
  'Europe/Brussels': 'BE',
  'Europe/Rome': 'IT',
  'Europe/London': 'GB',
  'Europe/Dublin': 'IE',
}

export function isMarket(value: unknown): value is Market {
  return typeof value === 'string' && (MARKETS as readonly string[]).includes(value)
}

/**
 * The market a timezone implies, or null for one we do not cover.
 *
 * Fails open, exactly as marketCodes() does in the importer and for the same
 * reason: a null here means no p_markets is sent, the catalog ranks on language
 * and popularity alone, and somebody in Poland or Brazil is no worse off than
 * they were yesterday. Guessing a neighbour would be worse than not guessing.
 *
 * Takes the zone as an argument rather than reading Intl itself, so the tests
 * never depend on the machine they run on -- same posture as detectDeviceLocale
 * taking its language list.
 */
export function detectRegionFromTimeZone(timeZone: string | undefined): Market | null {
  if (!timeZone) return null
  return TIMEZONE_MARKETS[timeZone] ?? null
}

/**
 * This device's timezone, or undefined where Intl is unavailable or throws.
 *
 * The one impure function here, kept apart from everything above so the rest of
 * the module stays testable without stubbing globals.
 */
export function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
}

/**
 * What to send as p_markets, or null when the timezone answers nothing.
 *
 * Fails open: null means no p_markets is sent and the catalog ranks on language
 * and popularity alone, which is strictly better than guessing a neighbouring
 * country.
 *
 * STILL TAKES THE ZONE, even though it now has only one caller and that caller
 * always passes deviceTimeZone(). Closing over Intl here instead would read
 * better and would quietly break every test above it: the component suite fakes
 * deviceTimeZone through the module export, and a call made from inside this
 * module binds the real one, so the assertions would start depending on the
 * clock of whatever machine ran them -- Europe/Bucharest on this developer's
 * box, UTC on CI, and "no market is sent" passing or failing on the difference.
 * detectRegionFromTimeZone says the same thing one function up; this is the
 * seam that makes it true from the outside.
 */
export function resolveRegion(timeZone: string | undefined): Market | null {
  return detectRegionFromTimeZone(timeZone)
}
