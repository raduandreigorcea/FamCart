// Pure helpers for the shopping list. Deliberately free of Vue and Supabase so
// they can be unit-tested and reused across the add / toggle / merge paths.

export interface ShoppingItem {
  id: string
  name: string
  checked: boolean
  quantity?: number
  added_by?: string
}

// Normalize a name for matching: trimmed and lowercased, so "Milk", "milk " and
// "MILK" all collapse to the same key. Mirrors the DB's lower(btrim(name)) index.
export function normalizeItemName(name: string | null | undefined): string {
  return String(name ?? '').trim().toLowerCase()
}

// Total units left to buy: sum of quantities across unchecked items. A missing or
// invalid quantity counts as 1.
export function sumActiveQuantities(items: ShoppingItem[]): number {
  return items
    .filter((i) => !i.checked)
    .reduce((sum, i) => sum + (Number(i.quantity) || 1), 0)
}

// First unchecked item whose name matches `name` (case/whitespace-insensitive),
// optionally excluding one id. Returns undefined if none match.
export function findActiveItemByName(
  items: ShoppingItem[],
  name: string,
  { excludeId }: { excludeId?: string } = {},
): ShoppingItem | undefined {
  const key = normalizeItemName(name)
  return items.find(
    (i) => !i.checked && i.id !== excludeId && normalizeItemName(i.name) === key,
  )
}

// How many active (unchecked) items a given member currently owns — the client
// side of the per-member cap (the DB trigger is the authoritative backstop).
export function countActiveItemsByMember(items: ShoppingItem[], userId: string): number {
  return items.filter((i) => !i.checked && i.added_by === userId).length
}
