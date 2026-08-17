// The caps the database enforces, in one place on the client.
//
// Every value here mirrors a constraint in supabase/migrations. The client
// copies exist so the UI can refuse early — a form that rejects what the row
// would reject anyway, rather than showing an optimistic item that the trigger
// then takes back. The DB remains the authority in every case; these are the
// polite version of the same rule.
//
// They were previously spread across four files, some under two different
// names for the same number (MAX_HOUSEHOLDS in the topbar, HOUSEHOLD_MEMBERSHIP_CAP
// in the router). Drift between a client cap and its migration is silent: the
// UI simply starts allowing something the server then refuses, or forbidding
// something it would have allowed.

/** Longest a household name may be. Mirrors 003_households_and_members.sql. */
export const HOUSEHOLD_NAME_MAX_LENGTH = 25

/** Longest a shopping-list item name may be. Mirrors 004_shopping_list.sql. */
export const ITEM_NAME_MAX_LENGTH = 120

/**
 * Longest a product's maker may be. Mirrors product_catalog_maker_length in
 * 006_product_catalog.sql, which add_custom_product() and the promotion sweep
 * both re-check.
 *
 * It was a prop on CustomProductModal with a default of 60 that no caller ever
 * passed — so it was a database constraint living as a component default,
 * configurable in principle by nobody and invisible from here. This file's whole
 * reason for existing is that a client cap drifting from its migration is
 * silent, and a number hidden in a defineProps is the easiest kind to miss.
 */
export const PRODUCT_MAKER_MAX_LENGTH = 60

/** How many households one user may belong to. Mirrors 003_households_and_members.sql. */
export const HOUSEHOLD_MEMBERSHIP_CAP = 3

/**
 * Most of one product the stepper will set. Deliberately STRICTER than the
 * database bound, which is the one pairing in this file where the two numbers
 * differ on purpose: 004_shopping_list.sql enforces 1..999, a mischief ceiling
 * against a hand-crafted request parking 2^31-1 on a shared row, while this is
 * the product decision — nothing but a stuck finger wants x100, and anyone
 * genuinely buying more wants two rows, or a wholesaler. The gap between the
 * two exists because merges legitimately sum quantities past this cap.
 */
export const ITEM_QUANTITY_MAX = 99

/**
 * Bounds on a household's per-member active-item cap — the owner-configurable
 * setting itself, not the count it limits. Mirrors 003_households_and_members.sql.
 */
export const ITEM_LIMIT_MIN = 1
export const ITEM_LIMIT_MAX = 50
export const ITEM_LIMIT_DEFAULT = 50

/**
 * Coerce whatever came back from the database (or a form field, or an old
 * cached snapshot) into a usable item limit. A missing or unparseable value
 * falls back to the default rather than to zero, which would otherwise read as
 * "this household may not add anything".
 */
export function clampItemLimit(value: unknown): number {
  const parsed = Number(value) || ITEM_LIMIT_DEFAULT
  return Math.min(ITEM_LIMIT_MAX, Math.max(ITEM_LIMIT_MIN, parsed))
}
