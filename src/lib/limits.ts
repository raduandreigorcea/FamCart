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

/** How many households one user may belong to. Mirrors 003_households_and_members.sql. */
export const HOUSEHOLD_MEMBERSHIP_CAP = 3

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
