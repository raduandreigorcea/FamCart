import { describe, it, expect } from 'vitest'
import { normalizeSearchText, escapeIlikePattern } from '../src/lib/productSearch'

// The client-side normalization must mirror how scripts/seed-products.mjs
// computes product_catalog.search_text — same lowercase / diacritic-stripping /
// whitespace-collapsing — or typed input stops matching seeded rows.
describe('normalizeSearchText', () => {
  it('lowercases, strips diacritics, and collapses whitespace', () => {
    expect(normalizeSearchText('  Apă  Plată   2L ')).toBe('apa plata 2l')
    expect(normalizeSearchText('Brânză și Țelină')).toBe('branza si telina')
  })

  it('leaves already-normalized text unchanged', () => {
    expect(normalizeSearchText('apa plata 2l dorna')).toBe('apa plata 2l dorna')
  })
})

describe('escapeIlikePattern', () => {
  it('escapes the ilike wildcards and the escape character itself', () => {
    expect(escapeIlikePattern('50%_a\\b')).toBe('50\\%\\_a\\\\b')
  })

  it('leaves plain text alone', () => {
    expect(escapeIlikePattern('apa plata')).toBe('apa plata')
  })
})
