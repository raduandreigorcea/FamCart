// Where somebody shops, and the one way the app can find that out.
//
// It used to be two: a Shopping Region picker in App Settings wrote a choice
// per account, and the timezone was only the fallback. The picker is gone --
// product_catalog.name_lang answers the question people were actually asking,
// and it needs nothing asked -- so what is tested here is detection alone.
//
// The interesting cases are all about failing open. A wrong guess here does not
// throw or blank the screen — it quietly reorders every product suggestion,
// which is the kind of bug that gets lived with for months rather than
// reported. So the fallbacks are pinned as hard as the happy path, and harder
// now that nobody can correct a wrong one by hand.
import { describe, it, expect } from 'vitest'
import {
  MARKETS,
  detectRegionFromTimeZone,
  isMarket,
  resolveRegion,
} from '../src/lib/region'

describe('detectRegionFromTimeZone', () => {
  it('reads the market off the zone', () => {
    expect(detectRegionFromTimeZone('Europe/Bucharest')).toBe('RO')
    expect(detectRegionFromTimeZone('Europe/Paris')).toBe('FR')
    expect(detectRegionFromTimeZone('Europe/Dublin')).toBe('IE')
  })

  // The case this whole module exists for: the phone is in English, the
  // shopping is in Romania, and only the zone knows it.
  it('does not care what language the device is in', () => {
    expect(detectRegionFromTimeZone('Europe/Bucharest')).toBe('RO')
  })

  it('knows the zones a country owns beyond its capital', () => {
    expect(detectRegionFromTimeZone('Atlantic/Canary')).toBe('ES')
    expect(detectRegionFromTimeZone('Africa/Ceuta')).toBe('ES')
    // The German enclave inside Switzerland, which keeps its own zone.
    expect(detectRegionFromTimeZone('Europe/Busingen')).toBe('DE')
  })

  // Fails open, exactly as marketCodes() does in the importer. A null means no
  // p_markets is sent and the catalog ranks by popularity alone, which is what
  // every install did before this shipped. Guessing a neighbour would be worse
  // than not guessing.
  it('returns null for a market the catalog does not cover', () => {
    expect(detectRegionFromTimeZone('Europe/Warsaw')).toBeNull()
    expect(detectRegionFromTimeZone('America/Sao_Paulo')).toBeNull()
  })

  it('returns null rather than throwing when there is no zone at all', () => {
    expect(detectRegionFromTimeZone(undefined)).toBeNull()
    expect(detectRegionFromTimeZone('')).toBeNull()
  })
})

describe('resolveRegion', () => {
  it('is the detection, now that there is no choice to prefer over it', () => {
    expect(resolveRegion('Europe/Bucharest')).toBe('RO')
    expect(resolveRegion('Europe/Rome')).toBe('IT')
  })

  it('falls through to null for a zone the catalog does not cover', () => {
    expect(resolveRegion('Europe/Warsaw')).toBeNull()
    expect(resolveRegion(undefined)).toBeNull()
  })

  // The seam the component suite fakes. Closing over Intl in here instead would
  // make every "no market is sent" assertion depend on the clock of the machine
  // running it, so the argument stays even with one caller that always fills it
  // the same way.
  it('takes the zone rather than reading Intl itself', () => {
    expect(resolveRegion.length).toBe(1)
  })
})

describe('the market list', () => {
  it('accepts only the eleven', () => {
    for (const market of MARKETS) expect(isMarket(market)).toBe(true)
    expect(isMarket('XX')).toBe(false)
    expect(isMarket('ro')).toBe(false)
    expect(isMarket(null)).toBe(false)
  })
})
