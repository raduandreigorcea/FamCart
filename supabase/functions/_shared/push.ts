// The decisions behind the push fan-out, separated from the runtime that
// delivers it.
//
// WHY THIS FILE EXISTS
//
// push-on-item-insert/index.ts is deployed code that nothing in this repo could
// check. tsconfig.json includes only `src/**`, so vue-tsc never sees it; eslint
// reads it but typescript-eslint turns off no-undef, so `Deno.env` and the
// `npm:` specifier pass without ever being resolved; and it could not be
// unit-tested, because importing it runs `Deno.serve` and `createClient` at
// module scope. So the one piece of the product that decides what every
// notification SAYS had no coverage of any kind.
//
// Splitting it is the same move the catalog repo already makes with
// catalog/supabase/functions/_shared, and it is a deployment constraint rather
// than taste: a Supabase edge function may only import files inside
// supabase/functions, because that is the directory the CLI uploads. `_shared`
// is Supabase's own convention for the part that several places need.
//
// So: no Deno APIs, no Node built-ins, no npm imports. Everything here is
// standard and runs unchanged under Deno, under Node and under vitest. Deno
// resolves imports by full path, which is why index.ts asks for `push.ts` with
// its extension.

/** A shopping_list_items row, as the webhook delivers it. */
export interface ItemRecord {
  id: string
  household_id: string
  name: string
  quantity: number | null
  added_by: string
}

/** A purchase_history row, as the webhook delivers it. */
export interface PurchaseRecord {
  checkout_id: string
  household_id: string
  purchased_by: string
}

/** Enough of a purchase_history row to name it in a message. */
export interface PurchasedItem {
  name: string
  quantity: number | null
}

/**
 * One product as it appears in a notification.
 *
 * A quantity of 1 is not worth saying: "Radu added Milk" reads as a sentence
 * and "Radu added Milk ×1" reads as a database row. Anything unparseable or
 * missing falls back to 1 for the same reason, since the alternative is
 * "Milk ×NaN" on somebody's lock screen.
 */
export function itemLabel(name: string, quantity: number | null): string {
  const qty = Number(quantity) || 1
  return qty > 1 ? `${name} ×${qty}` : name
}

/**
 * The list of products in a checkout notification.
 *
 * Named in full up to two, then counted, because a lock screen truncates and
 * the useful half of the sentence is the beginning. "Bread, Milk and 4 more"
 * says what happened; six names elided mid-word do not.
 */
export function summariseCheckout(labels: string[]): string {
  if (labels.length === 1) return labels[0]
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`
  return `${labels[0]}, ${labels[1]} and ${labels.length - 2} more`
}

/** "Radu added Milk ×2" */
export function itemAddedBody(who: string, item: ItemRecord): string {
  return `${who} added ${itemLabel(item.name, item.quantity)}`
}

/** "Radu bought Bread, Milk and 4 more" */
export function checkoutBody(who: string, items: PurchasedItem[]): string {
  return `${who} bought ${summariseCheckout(items.map((i) => itemLabel(i.name, i.quantity)))}`
}

/**
 * Who hears about it: every member except whoever did it.
 *
 * The exclusion is the whole point. Without it the person who just added the
 * milk gets a notification telling them they added the milk, which is the
 * fastest way to have somebody turn notifications off for good.
 *
 * Tolerates a null member list, because that is what a failed-but-unchecked
 * select hands over.
 */
export function recipientsFor(
  members: { user_id: string }[] | null | undefined,
  actorId: string,
): string[] {
  return (members ?? []).map((m) => m.user_id).filter((id) => id !== actorId)
}

/**
 * Whether the webhook presented the right shared secret.
 *
 * This is the ONLY thing standing between an unauthenticated POST and a push to
 * every member of a household: verify_jwt is off for this function, because a
 * database webhook carries no user JWT.
 *
 * Digests are compared rather than the strings themselves. A plain `===`
 * short-circuits on the first differing byte, so the time it takes leaks how
 * much of a guess was correct, and a secret can be recovered a character at a
 * time. Hashing first makes every comparison the same length and the same
 * shape, and the loop below is written without an early exit for the same
 * reason.
 */
export async function secretMatches(given: string | null, expected: string): Promise<boolean> {
  if (given === null) return false
  const enc = new TextEncoder()
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ])
  const av = new Uint8Array(a)
  const bv = new Uint8Array(b)
  let diff = 0
  for (let i = 0; i < av.length; i++) diff |= av[i] ^ bv[i]
  return diff === 0
}

/** What a webhook payload asks this function to do, or null for nothing. */
export type PushJob =
  | { kind: 'item'; record: ItemRecord }
  | { kind: 'checkout'; record: PurchaseRecord }
  | null

/**
 * Read a webhook payload and decide which fan-out it is asking for.
 *
 * Only INSERT, and only the two tables that have triggers. Everything else is
 * skipped rather than refused: a webhook pointed at one more table by mistake
 * should do nothing quietly, not return an error the sender will retry.
 *
 * Split out from the request handler because the routing is the part most
 * likely to be got wrong by an edit and the part least likely to be noticed
 * when it is — a mis-typed table name here does not fail, it silently stops
 * notifying.
 */
export function routePayload(payload: unknown): PushJob {
  if (!payload || typeof payload !== 'object') return null
  const { type, table, record } = payload as {
    type?: string
    table?: string
    record?: unknown
  }
  if (type !== 'INSERT' || !record) return null
  if (table === 'shopping_list_items') return { kind: 'item', record: record as ItemRecord }
  if (table === 'purchase_history') return { kind: 'checkout', record: record as PurchaseRecord }
  return null
}
