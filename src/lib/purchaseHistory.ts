// Pure helpers for the checkout-history view. Kept free of Vue/Supabase so the
// grouping logic can be unit-tested.

export interface CheckoutEntry {
  purchased_at: string
  checkout_id?: string | null
  purchased_by?: string | null
  [key: string]: unknown
}

export interface Checkout {
  key: string
  checkoutId: string | null
  purchasedBy: string | null
  purchasedAt: string
  items: CheckoutEntry[]
}

export interface DayGroup {
  label: string
  checkouts: Checkout[]
}

function startOfDay(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

// Rows share a checkout_id when bought in one action; legacy rows without one
// fall back to grouping by purchaser + timestamp, which was one checkout.
function checkoutKey(entry: CheckoutEntry): string {
  return entry.checkout_id
    ? `c:${entry.checkout_id}`
    : `t:${entry.purchased_by ?? ''}@${entry.purchased_at}`
}

// A row-capped query can cut the oldest checkout in half: some of its items
// fall past the cap. When the result fills the cap, drop the trailing rows of
// that possibly-partial checkout so every checkout shown is complete. If all
// rows belong to a single checkout, keep them — a partial view beats an empty
// one.
export function trimPartialTail(entries: CheckoutEntry[], limit: number): CheckoutEntry[] {
  if (entries.length < limit) return entries
  const lastKey = checkoutKey(entries[entries.length - 1])
  let cut = entries.length
  while (cut > 0 && checkoutKey(entries[cut - 1]) === lastKey) cut--
  return cut === 0 ? entries : entries.slice(0, cut)
}

// Collapse purchase rows into checkout events (all items bought together), then
// bucket those events under day headers ("Today", "Yesterday", or a date).
// Input is assumed newest-first (as the query returns it); that order is
// preserved throughout. Rows with an unparseable timestamp are dropped.
export function groupCheckouts(
  entries: CheckoutEntry[],
  now: number = Date.now(),
): DayGroup[] {
  const events: Checkout[] = []
  const byKey = new Map<string, Checkout>()

  for (const entry of entries) {
    if (Number.isNaN(new Date(entry.purchased_at).getTime())) continue

    const key = checkoutKey(entry)
    let event = byKey.get(key)
    if (!event) {
      event = {
        key,
        checkoutId: entry.checkout_id ?? null,
        purchasedBy: entry.purchased_by ?? null,
        purchasedAt: entry.purchased_at,
        items: [],
      }
      byKey.set(key, event)
      events.push(event)
    }
    event.items.push(entry)
  }

  const today = startOfDay(now)
  const dayMs = 86_400_000
  const days: DayGroup[] = []
  const byLabel = new Map<string, DayGroup>()

  for (const event of events) {
    const day = startOfDay(new Date(event.purchasedAt).getTime())
    let label: string
    if (day === today) label = 'Today'
    else if (day === today - dayMs) label = 'Yesterday'
    else {
      label = new Date(event.purchasedAt).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
    }

    let group = byLabel.get(label)
    if (!group) {
      group = { label, checkouts: [] }
      byLabel.set(label, group)
      days.push(group)
    }
    group.checkouts.push(event)
  }

  // Items inside one checkout were archived in a single statement, so their
  // timestamps are identical and carry no order. Alphabetical is stable across
  // fetches and devices, and easy to scan.
  for (const event of events) {
    event.items.sort((a, b) =>
      String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' }),
    )
  }

  return days
}
