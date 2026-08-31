// The client's copies of the database's caps.
//
// Every constant here mirrors a constraint in supabase/migrations, and drift
// between the two is silent in both directions: the UI starts allowing
// something the server then refuses, or forbidding something it would have
// allowed. Nothing but these assertions notices, because a number that agrees
// with nothing still compiles.
//
// clampItemLimit is the only function in the file and it earns its own tests
// for a reason the settings panel makes clear. That panel edits the limit with
// a range input, so the browser has already constrained the value and the clamp
// is unreachable from the UI. The inputs that CAN be out of range arrive from
// somewhere else entirely: a column read straight out of the database, and a
// household snapshot restored from localStorage, which is not a value this app
// controls. Those are what this covers.
import { describe, it, expect } from 'vitest'
import {
  clampItemLimit,
  HOUSEHOLD_MEMBERSHIP_CAP,
  HOUSEHOLD_NAME_MAX_LENGTH,
  ITEM_LIMIT_DEFAULT,
  ITEM_LIMIT_MAX,
  ITEM_LIMIT_MIN,
  ITEM_NAME_MAX_LENGTH,
  ITEM_QUANTITY_MAX,
  PRODUCT_MAKER_MAX_LENGTH,
} from '../src/lib/limits'

describe('the caps themselves', () => {
  // Pinned as literals on purpose. Asserting a constant against itself proves
  // nothing; these are the numbers in the migrations, written out again so that
  // changing one side without the other fails here.
  it('matches the bounds the migrations enforce', () => {
    expect(HOUSEHOLD_NAME_MAX_LENGTH).toBe(25) // 003_households_and_members.sql
    expect(ITEM_NAME_MAX_LENGTH).toBe(120) // 004_shopping_list.sql
    expect(PRODUCT_MAKER_MAX_LENGTH).toBe(60) // 006_product_catalog.sql
    expect(HOUSEHOLD_MEMBERSHIP_CAP).toBe(3) // 003_households_and_members.sql
    expect(ITEM_LIMIT_MIN).toBe(1) // 003_households_and_members.sql
    expect(ITEM_LIMIT_MAX).toBe(50)
  })

  // The one pairing that differs from the database on purpose: 004 enforces
  // 1..999 as a mischief ceiling, while this is the product decision. The gap
  // is deliberate, so a future edit that "fixes" it by matching 999 should have
  // to delete this line and read why.
  it('keeps the stepper ceiling stricter than the database bound', () => {
    expect(ITEM_QUANTITY_MAX).toBe(99)
    expect(ITEM_QUANTITY_MAX).toBeLessThan(999)
  })
})

describe('clampItemLimit', () => {
  it('passes an in-range value through untouched', () => {
    expect(clampItemLimit(20)).toBe(20)
    expect(clampItemLimit(ITEM_LIMIT_MIN)).toBe(ITEM_LIMIT_MIN)
    expect(clampItemLimit(ITEM_LIMIT_MAX)).toBe(ITEM_LIMIT_MAX)
  })

  it('pulls an out-of-range value back to the nearest bound', () => {
    expect(clampItemLimit(ITEM_LIMIT_MAX + 500)).toBe(ITEM_LIMIT_MAX)
    expect(clampItemLimit(-40)).toBe(ITEM_LIMIT_MIN)
    // Numeric strings are what a form field and a JSON snapshot both hand over.
    expect(clampItemLimit('300')).toBe(ITEM_LIMIT_MAX)
  })

  // Falling back to the default rather than to zero is the whole point: zero
  // reads as "this household may not add anything", which is a working app
  // that refuses every write.
  it('falls back to the default for anything unusable, never to zero', () => {
    for (const value of [null, undefined, '', 'fifty', NaN, {}, [], 0]) {
      expect(clampItemLimit(value)).toBe(ITEM_LIMIT_DEFAULT)
    }
  })
})
