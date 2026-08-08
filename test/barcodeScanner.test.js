// The pure half of scanning: which stored codes one scanned symbol could mean.
//
// This is the part that decides whether a scanner finds anything at all. The
// catalog's codes come from Open Food Facts, which files a product under its
// 13-digit EAN; a UPC-A symbol on an American package prints only 12 of those
// digits, because the leading zero is implied. Reporting what the camera read
// and nothing else would miss every one of them.
import { describe, it, expect } from 'vitest'
import { barcodeCandidates } from '../src/lib/barcodeScanner'

describe('barcodeCandidates', () => {
  it('offers the padded form of a 12-digit UPC-A, which is how the catalog files it', () => {
    expect(barcodeCandidates('012345678905')).toContain('0012345678905')
  })

  it('offers the printed form of a padded 13-digit code', () => {
    // The same product, filed the other way round: a row imported under the
    // 12-digit code still has to be found by a scanner reporting 13.
    expect(barcodeCandidates('0012345678905')).toContain('012345678905')
  })

  it('always includes the code exactly as it was read', () => {
    expect(barcodeCandidates('5941234567890')).toContain('5941234567890')
  })

  it('does not strip a leading digit that is carrying information', () => {
    // Only a leading ZERO is the implied-padding case. Dropping any other first
    // digit would turn one product's code into a different product's.
    expect(barcodeCandidates('5941234567890')).not.toContain('941234567890')
  })

  it('returns nothing for anything the catalog could not be holding', () => {
    // Mirrors product_catalog_barcode_format: 8-14 digits, nothing else. A
    // decoder that hands back letters or a 4-digit shelf label has not read a
    // product, and querying for it would only cost a round trip.
    expect(barcodeCandidates('ABC123')).toEqual([])
    expect(barcodeCandidates('1234')).toEqual([])
    expect(barcodeCandidates('')).toEqual([])
    expect(barcodeCandidates(null)).toEqual([])
  })

  it('never repeats a form, so the lookup asks for each code once', () => {
    const forms = barcodeCandidates('01234567')
    expect(new Set(forms).size).toBe(forms.length)
  })

  it('keeps every form within the length the column accepts', () => {
    // A 14-digit ITF-14 is already at the ceiling: padding it further would
    // produce a code no row could ever hold.
    for (const form of barcodeCandidates('12345678901234')) {
      expect(form).toMatch(/^[0-9]{8,14}$/)
    }
  })
})
