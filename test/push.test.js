// What every push notification says, who receives it, and what gets in.
//
// This was the one piece of deployed code in the repo that nothing checked.
// supabase/functions is outside tsconfig's `src/**`, so vue-tsc never saw it;
// eslint reads it but typescript-eslint disables no-undef, so `Deno.env` and
// the `npm:` specifier resolved to nothing and complained about nothing; and it
// could not be imported by a test, because doing so runs Deno.serve at module
// scope.
//
// The logic now lives in supabase/functions/_shared/push.ts, which uses no Deno
// API and no Node built-in and so runs here unchanged. What is left in
// index.ts is the service-role client, the OneSignal fetch and the handler --
// wiring that genuinely needs the platform.
//
// The two things worth being strict about: the actor must never be notified of
// their own action (the fastest way to have somebody turn push off for good),
// and the secret comparison must not leak how much of a guess was right, since
// it is the only authentication this function has.
import { describe, it, expect } from 'vitest'
import {
  checkoutBody,
  itemAddedBody,
  itemLabel,
  recipientsFor,
  routePayload,
  secretMatches,
  summariseCheckout,
} from '../supabase/functions/_shared/push.ts'

describe('itemLabel', () => {
  it('says nothing about a quantity of one', () => {
    expect(itemLabel('Milk', 1)).toBe('Milk')
  })

  it('carries the count when there is more than one', () => {
    expect(itemLabel('Milk', 3)).toBe('Milk ×3')
  })

  // "Milk ×NaN" on a lock screen is the failure this prevents.
  it('falls back to one for anything unusable', () => {
    for (const quantity of [null, undefined, 0, NaN, 'many']) {
      expect(itemLabel('Milk', quantity)).toBe('Milk')
    }
  })
})

describe('summariseCheckout', () => {
  it('names one', () => {
    expect(summariseCheckout(['Milk'])).toBe('Milk')
  })

  it('names two', () => {
    expect(summariseCheckout(['Milk', 'Bread'])).toBe('Milk and Bread')
  })

  // Named in full up to two, then counted: a lock screen truncates, so the
  // useful half of the sentence is the beginning.
  it('names two and counts the rest', () => {
    expect(summariseCheckout(['Milk', 'Bread', 'Eggs'])).toBe('Milk, Bread and 1 more')
    expect(summariseCheckout(['Milk', 'Bread', 'Eggs', 'Jam', 'Tea'])).toBe(
      'Milk, Bread and 3 more',
    )
  })
})

describe('the message bodies', () => {
  it('reads as a sentence for an added item', () => {
    expect(itemAddedBody('Radu', { name: 'Milk', quantity: 2 })).toBe('Radu added Milk ×2')
  })

  it('reads as a sentence for a checkout', () => {
    expect(
      checkoutBody('Radu', [
        { name: 'Milk', quantity: 2 },
        { name: 'Bread', quantity: 1 },
        { name: 'Eggs', quantity: 1 },
      ]),
    ).toBe('Radu bought Milk ×2, Bread and 1 more')
  })
})

describe('recipientsFor', () => {
  const members = [{ user_id: 'u_a' }, { user_id: 'u_b' }, { user_id: 'u_c' }]

  it('notifies everyone except whoever did it', () => {
    expect(recipientsFor(members, 'u_b')).toEqual(['u_a', 'u_c'])
  })

  it('notifies nobody when the actor is the only member', () => {
    expect(recipientsFor([{ user_id: 'u_a' }], 'u_a')).toEqual([])
  })

  // What a select that failed without being checked hands over.
  it('treats a missing roster as nobody rather than throwing', () => {
    expect(recipientsFor(null, 'u_a')).toEqual([])
    expect(recipientsFor(undefined, 'u_a')).toEqual([])
  })
})

// verify_jwt is off for this function, so this comparison is the whole of its
// authentication.
//
// WHAT THESE DO NOT COVER, stated because it would otherwise be assumed. They
// pin the ANSWERS. They cannot pin the reason the function is written the way
// it is: replacing the digest comparison with `given === expected` passes every
// case below, because the two agree on every input and differ only in how long
// they take to disagree. A timing assertion would be flaky enough to be
// deleted within a month, so the comment at the implementation is what carries
// that property, and anyone simplifying it should read that comment first.
describe('secretMatches', () => {
  it('accepts the right secret', async () => {
    await expect(secretMatches('s3cret', 's3cret')).resolves.toBe(true)
  })

  it('rejects a wrong one', async () => {
    await expect(secretMatches('s3crft', 's3cret')).resolves.toBe(false)
  })

  // A missing header is the unauthenticated case, and it must not be able to
  // match an unset or empty secret by accident.
  it('rejects an absent header', async () => {
    await expect(secretMatches(null, 's3cret')).resolves.toBe(false)
    await expect(secretMatches(null, '')).resolves.toBe(false)
  })

  it('rejects a value that merely starts the same', async () => {
    await expect(secretMatches('s3cret-and-more', 's3cret')).resolves.toBe(false)
    await expect(secretMatches('s', 's3cret')).resolves.toBe(false)
  })
})

describe('routePayload', () => {
  const item = { id: 'i1', household_id: 'hh-1', name: 'Milk', quantity: 1, added_by: 'u_a' }
  const purchase = { checkout_id: 'c1', household_id: 'hh-1', purchased_by: 'u_a' }

  it('routes an item insert', () => {
    expect(routePayload({ type: 'INSERT', table: 'shopping_list_items', record: item })).toEqual({
      kind: 'item',
      record: item,
    })
  })

  it('routes a purchase insert', () => {
    expect(routePayload({ type: 'INSERT', table: 'purchase_history', record: purchase })).toEqual({
      kind: 'checkout',
      record: purchase,
    })
  })

  // Only INSERT has a trigger. An UPDATE arriving here means something is
  // misconfigured, and doing nothing quietly is the right answer: returning an
  // error would only have the sender retry it.
  it('skips anything that is not an insert', () => {
    expect(routePayload({ type: 'UPDATE', table: 'shopping_list_items', record: item })).toBeNull()
    expect(routePayload({ type: 'DELETE', table: 'purchase_history', record: purchase })).toBeNull()
  })

  it('skips a table with no fan-out of its own', () => {
    expect(routePayload({ type: 'INSERT', table: 'households', record: {} })).toBeNull()
    // The nearest miss, and the one a rename would produce.
    expect(routePayload({ type: 'INSERT', table: 'shopping_items', record: item })).toBeNull()
  })

  it('skips a payload it cannot read at all', () => {
    // What `await req.json().catch(() => null)` hands over for a malformed body.
    expect(routePayload(null)).toBeNull()
    expect(routePayload(undefined)).toBeNull()
    expect(routePayload('not an object')).toBeNull()
    expect(routePayload({ type: 'INSERT', table: 'shopping_list_items' })).toBeNull()
  })
})
