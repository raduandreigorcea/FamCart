import { describe, it, expect } from 'vitest'
import {
  normalizeItemName,
  sumActiveQuantities,
  sumCheckedQuantities,
  findActiveItemByName,
  countActiveItemsByMember,
} from '../src/lib/shoppingList'

// Small factory for readable fixtures.
const item = (over = {}) => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  name: 'thing',
  checked: false,
  quantity: 1,
  added_by: 'u1',
  ...over,
})

describe('normalizeItemName', () => {
  it('trims and lowercases', () => {
    expect(normalizeItemName('  Milk ')).toBe('milk')
    expect(normalizeItemName('MILK')).toBe('milk')
  })

  it('treats null/undefined as empty string', () => {
    expect(normalizeItemName(null)).toBe('')
    expect(normalizeItemName(undefined)).toBe('')
  })
})

describe('sumActiveQuantities', () => {
  it('sums quantities of unchecked items (coconut x4 + grapes x2 = 6)', () => {
    const items = [
      item({ name: 'coconut', quantity: 4 }),
      item({ name: 'grapes', quantity: 2 }),
    ]
    expect(sumActiveQuantities(items)).toBe(6)
  })

  it('ignores checked items', () => {
    const items = [
      item({ name: 'milk', quantity: 2 }),
      item({ name: 'bread', quantity: 5, checked: true }),
    ]
    expect(sumActiveQuantities(items)).toBe(2)
  })

  it('counts missing or invalid quantity as 1', () => {
    const items = [
      item({ quantity: undefined }),
      item({ quantity: null }),
      item({ quantity: 'nope' }),
      item({ quantity: 0 }),
    ]
    expect(sumActiveQuantities(items)).toBe(4)
  })

  it('returns 0 for an empty or all-checked list', () => {
    expect(sumActiveQuantities([])).toBe(0)
    expect(sumActiveQuantities([item({ checked: true, quantity: 9 })])).toBe(0)
  })
})

describe('sumCheckedQuantities', () => {
  it('sums quantities of checked items (grapes x4 + milk x1 = 5)', () => {
    const items = [
      item({ name: 'grapes', quantity: 4, checked: true }),
      item({ name: 'milk', quantity: 1, checked: true }),
    ]
    expect(sumCheckedQuantities(items)).toBe(5)
  })

  it('ignores unchecked items', () => {
    const items = [
      item({ name: 'grapes', quantity: 4, checked: true }),
      item({ name: 'bread', quantity: 5 }),
    ]
    expect(sumCheckedQuantities(items)).toBe(4)
  })

  it('counts missing or invalid quantity as 1', () => {
    const items = [
      item({ checked: true, quantity: undefined }),
      item({ checked: true, quantity: 'nope' }),
      item({ checked: true, quantity: 0 }),
    ]
    expect(sumCheckedQuantities(items)).toBe(3)
  })

  it('returns 0 for an empty or all-unchecked list', () => {
    expect(sumCheckedQuantities([])).toBe(0)
    expect(sumCheckedQuantities([item({ quantity: 9 })])).toBe(0)
  })
})

describe('findActiveItemByName', () => {
  it('matches case- and whitespace-insensitively', () => {
    const items = [item({ id: 'a', name: 'Milk' })]
    expect(findActiveItemByName(items, '  milk ')?.id).toBe('a')
    expect(findActiveItemByName(items, 'MILK')?.id).toBe('a')
  })

  it('ignores checked items', () => {
    const items = [item({ id: 'a', name: 'milk', checked: true })]
    expect(findActiveItemByName(items, 'milk')).toBeUndefined()
  })

  it('excludes a given id', () => {
    const items = [
      item({ id: 'a', name: 'milk' }),
      item({ id: 'b', name: 'milk' }),
    ]
    expect(findActiveItemByName(items, 'milk', { excludeId: 'a' })?.id).toBe('b')
  })

  it('returns undefined when nothing matches', () => {
    const items = [item({ name: 'bread' })]
    expect(findActiveItemByName(items, 'milk')).toBeUndefined()
  })

  it('returns the first match', () => {
    const items = [
      item({ id: 'a', name: 'milk' }),
      item({ id: 'b', name: 'milk' }),
    ]
    expect(findActiveItemByName(items, 'milk')?.id).toBe('a')
  })
})

describe('countActiveItemsByMember', () => {
  it('counts only unchecked items owned by the given member', () => {
    const items = [
      item({ added_by: 'u1' }),
      item({ added_by: 'u1', checked: true }),
      item({ added_by: 'u2' }),
      item({ added_by: 'u1' }),
    ]
    expect(countActiveItemsByMember(items, 'u1')).toBe(2)
    expect(countActiveItemsByMember(items, 'u2')).toBe(1)
    expect(countActiveItemsByMember(items, 'nobody')).toBe(0)
  })
})
