import { describe, it, expect } from 'vitest'
import { getProductEmoji } from '../src/lib/productEmoji'

describe('getProductEmoji', () => {
  it('maps known products to their emoji', () => {
    expect(getProductEmoji('milk')).toBe('🥛')
    expect(getProductEmoji('apple')).toBe('🍎')
    expect(getProductEmoji('grapes')).toBe('🍇')
    expect(getProductEmoji('coconut')).toBe('🥥')
  })

  it('is case-insensitive', () => {
    expect(getProductEmoji('MILK')).toBe('🥛')
    expect(getProductEmoji('Grapes')).toBe('🍇')
  })

  it('ignores diacritics', () => {
    // normalizeText strips combining marks, so "Bánana" resolves to "banana".
    expect(getProductEmoji('Bánana')).toBe('🍌')
  })

  it('matches keywords as substrings', () => {
    expect(getProductEmoji('whole milk')).toBe('🥛')
  })

  it('falls back to the default bag emoji when nothing matches', () => {
    expect(getProductEmoji('asdfqwer')).toBe('🛍️')
    expect(getProductEmoji('')).toBe('🛍️')
  })
})
