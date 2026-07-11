import { describe, it, expect } from 'vitest'
import { groupCheckouts, trimPartialTail } from '../src/lib/purchaseHistory'

// Fixed "now" (local) so Today/Yesterday buckets are deterministic. Entries use
// local (no-timezone) timestamps too, so the comparison is TZ-stable.
const NOW = new Date(2026, 6, 10, 12, 0, 0).getTime() // Jul 10 2026, noon
const row = (id, at, checkoutId, by = 'u1') => ({
  id,
  name: 'thing',
  purchased_at: at,
  checkout_id: checkoutId,
  purchased_by: by,
})

describe('groupCheckouts', () => {
  it('collapses rows sharing a checkout_id into one event, bucketed by day', () => {
    const days = groupCheckouts(
      [
        row('a', '2026-07-10T10:00:00', 'co-1', 'u1'),
        row('b', '2026-07-10T10:00:00', 'co-1', 'u1'),
        row('c', '2026-07-10T08:00:00', 'co-2', 'u2'),
        row('d', '2026-07-09T20:00:00', 'co-3', 'u1'),
      ],
      NOW,
    )

    expect(days.map((d) => d.label)).toEqual(['Today', 'Yesterday'])

    // Today has two distinct checkouts, in input (newest-first) order.
    const today = days[0].checkouts
    expect(today).toHaveLength(2)
    expect(today[0].checkoutId).toBe('co-1')
    expect(today[0].purchasedBy).toBe('u1')
    expect(today[0].items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(today[1].checkoutId).toBe('co-2')
    expect(today[1].purchasedBy).toBe('u2')

    // Yesterday has the single remaining checkout.
    expect(days[1].checkouts).toHaveLength(1)
    expect(days[1].checkouts[0].items.map((i) => i.id)).toEqual(['d'])
  })

  it('separates same-day checkouts by different buyers', () => {
    const days = groupCheckouts(
      [
        row('a', '2026-07-10T11:00:00', 'co-1', 'radu'),
        row('b', '2026-07-10T09:00:00', 'co-2', 'ana'),
      ],
      NOW,
    )
    const today = days[0].checkouts
    expect(today).toHaveLength(2)
    expect(today.map((c) => c.purchasedBy)).toEqual(['radu', 'ana'])
  })

  it('falls back to purchaser + timestamp for legacy rows without a checkout_id', () => {
    const days = groupCheckouts(
      [
        row('a', '2026-07-10T10:00:00', null, 'u1'),
        row('b', '2026-07-10T10:00:00', null, 'u1'),
        row('c', '2026-07-10T10:00:00', null, 'u2'),
      ],
      NOW,
    )
    const today = days[0].checkouts
    // u1's two rows collapse; u2's is its own checkout.
    expect(today).toHaveLength(2)
    expect(today[0].items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(today[1].items.map((i) => i.id)).toEqual(['c'])
  })

  it('drops entries with an unparseable timestamp', () => {
    const days = groupCheckouts(
      [row('a', 'not-a-date', 'co-1'), row('b', '2026-07-10T09:00:00', 'co-2')],
      NOW,
    )
    const ids = days.flatMap((d) => d.checkouts.flatMap((c) => c.items.map((i) => i.id)))
    expect(ids).toEqual(['b'])
  })

  it('returns an empty array for no entries', () => {
    expect(groupCheckouts([], NOW)).toEqual([])
  })

  it('sorts items within a checkout alphabetically', () => {
    const days = groupCheckouts(
      [
        { ...row('a', '2026-07-10T10:00:00', 'co-1'), name: 'milk' },
        { ...row('b', '2026-07-10T10:00:00', 'co-1'), name: 'Apples' },
        { ...row('c', '2026-07-10T10:00:00', 'co-1'), name: 'bread' },
      ],
      NOW,
    )
    expect(days[0].checkouts[0].items.map((i) => i.name)).toEqual(['Apples', 'bread', 'milk'])
  })
})

describe('trimPartialTail', () => {
  it('leaves results under the cap untouched', () => {
    const entries = [
      row('a', '2026-07-10T10:00:00', 'co-1'),
      row('b', '2026-07-10T08:00:00', 'co-2'),
    ]
    expect(trimPartialTail(entries, 500)).toBe(entries)
  })

  it('drops the possibly-partial oldest checkout when the cap is hit', () => {
    const entries = [
      row('a', '2026-07-10T10:00:00', 'co-1'),
      row('b', '2026-07-10T08:00:00', 'co-2'),
      row('c', '2026-07-10T08:00:00', 'co-2'), // co-2 may continue past the cap
    ]
    const trimmed = trimPartialTail(entries, 3)
    expect(trimmed.map((e) => e.id)).toEqual(['a'])
  })

  it('groups legacy rows without checkout_id by purchaser + timestamp', () => {
    const entries = [
      row('a', '2026-07-10T10:00:00', null, 'u1'),
      row('b', '2026-07-10T08:00:00', null, 'u2'),
      row('c', '2026-07-10T08:00:00', null, 'u2'),
    ]
    const trimmed = trimPartialTail(entries, 3)
    expect(trimmed.map((e) => e.id)).toEqual(['a'])
  })

  it('keeps everything when the whole capped result is one checkout', () => {
    const entries = [
      row('a', '2026-07-10T10:00:00', 'co-1'),
      row('b', '2026-07-10T10:00:00', 'co-1'),
    ]
    expect(trimPartialTail(entries, 2)).toBe(entries)
  })
})
