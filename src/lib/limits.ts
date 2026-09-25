// The caps the database enforces, in one place on the client.
//
// Every value here mirrors a constraint in supabase/migrations. The client
// copies exist so the UI can refuse early — a form that rejects what the row
// would reject anyway, rather than showing an optimistic item that the trigger
// then takes back. The DB remains the authority in every case; these are the
// polite version of the same rule.
//
// They were previously spread across four files, some under two different
// names for the same number (MAX_LISTS in the topbar, LIST_MEMBERSHIP_CAP
// in the router). Drift between a client cap and its migration is silent: the
// UI simply starts allowing something the server then refuses, or forbidding
// something it would have allowed.

/** Longest a list name may be. Mirrors 003_lists_and_members.sql. */
export const LIST_NAME_MAX_LENGTH = 25

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

/** How many lists one user may belong to. Mirrors 003_lists_and_members.sql. */
export const LIST_MEMBERSHIP_CAP = 3

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
 * The hard ceiling the database puts on one row's quantity. Mirrors
 * shopping_list_items_quantity_check in 004_shopping_list.sql.
 *
 * ITEM_QUANTITY_MAX above is the stepper's cap and the paragraph there says why
 * the two differ; this is the number a SUM has to respect. Three paths add
 * quantities together rather than setting one — adding a product already on the
 * list, folding a lost insert race into the winning row, and merging an
 * unchecked row into its twin — and none of them is reachable from the stepper,
 * so none of them is bounded by it.
 */
export const ITEM_QUANTITY_DB_MAX = 999

/**
 * Two quantities folded into one row, held at the bound the database enforces.
 *
 * Capping silently is the least bad of the three available outcomes. Sending the
 * sum unclamped fails the check constraint, which reaches the user as "couldn't
 * update item" with the number rolling back under their thumb and reaches Sentry
 * as a fault, for a row doing nothing wrong. Refusing the fold is worse still on
 * the merge path: a unique index forbids two active rows for one product, so
 * there is no state to refuse INTO.
 *
 * What it costs is the units past 999 on a merge, which is real and is the
 * reason this is a named function rather than an inline Math.min. Reaching it at
 * all means two rows that each took hundreds of taps to build.
 */
export function sumQuantities(a: number, b: number): number {
  return Math.min(ITEM_QUANTITY_DB_MAX, a + b)
}

/**
 * Bounds on a list's per-member active-item cap — the owner-configurable
 * setting itself, not the count it limits. Mirrors 003_lists_and_members.sql.
 */
export const ITEM_LIMIT_MIN = 1
export const ITEM_LIMIT_MAX = 50
export const ITEM_LIMIT_DEFAULT = 50

/**
 * Coerce whatever came back from the database (or a form field, or an old
 * cached snapshot) into a usable item limit. A missing or unparseable value
 * falls back to the default rather than to zero, which would otherwise read as
 * "this list may not add anything".
 */
export function clampItemLimit(value: unknown): number {
  const parsed = Number(value) || ITEM_LIMIT_DEFAULT
  return Math.min(ITEM_LIMIT_MAX, Math.max(ITEM_LIMIT_MIN, parsed))
}
