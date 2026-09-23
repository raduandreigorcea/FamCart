// The list's "By aisle" order is derived from the emoji a product gets, so every
// emoji a rule can produce must belong to an aisle. A new rule without one would
// not fail anything visibly; its products would just drift to "Other".
import { describe, it, expect } from 'vitest'
import { AISLES, RULE_EMOJIS, aisleForEmoji, getProductAisle } from '../src/lib/productEmoji'

describe('getProductAisle', () => {
  it('places every emoji the rules produce in an aisle', () => {
    const unplaced = RULE_EMOJIS.filter((emoji) => aisleForEmoji(emoji) === 'other')
    expect(unplaced).toEqual([])
  })

  it('sorts common Romanian products where a shopper finds them', () => {
    expect(getProductAisle('Lapte', 'Zuzu')).toBe('dairy')
    expect(getProductAisle('Mere')).toBe('produce')
    expect(getProductAisle('Paine')).toBe('bakery')
    expect(getProductAisle('Piept de pui')).toBe('meat')
    expect(getProductAisle('Apa minerala', 'Borsec')).toBe('drinks')
    expect(getProductAisle('Detergent de vase')).toBe('household')
    expect(getProductAisle('Pasta de dinti')).toBe('personal')
    expect(getProductAisle('Chipsuri cu smantana')).toBe('sweets')
  })

  it('puts what it cannot place under other, last', () => {
    expect(getProductAisle('Ceva necunoscut')).toBe('other')
    expect(AISLES[AISLES.length - 1]).toBe('other')
  })
})
