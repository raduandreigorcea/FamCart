import type { HouseholdMemberProfile, ShoppingItemRow } from './householdRealtime'

// Last known household state, keyed to one user. Read on startup so a returning
// user sees their list instantly (stale-while-revalidate) instead of skeletons
// while Clerk and the first Supabase fetches warm up; the fresh data then
// overwrites it. The cache is an optimization only — every failure mode
// degrades to "no snapshot".

export interface HouseholdSnapshot {
  householdId: string
  householdName: string
  householdInviteCode: string
  householdOwnerId: string
  householdItemLimit: number
  householdEmoji: string
  householdMembers: HouseholdMemberProfile[]
  items: ShoppingItemRow[]
  // Whether this household has ever bought anything. Cached because it decides
  // between "All bought" and "Nothing here yet" on an empty list, and the
  // purchase history that answers it cannot be read offline — without this, a
  // household that shops every week is told they have never started.
  hasShopped: boolean
}

interface StoredSnapshot extends HouseholdSnapshot {
  version: number
  userId: string
  savedAt: number
}

// One snapshot per account, rather than one snapshot with an account stamped on
// it.
//
// The read below has always rejected a snapshot belonging to somebody else, so
// the single key was never a leak. It was a loss: the one key held whichever
// account saved last, so B signing in overwrote A's snapshot outright, and A's
// next open was a column of skeletons for a cache that had been sitting there a
// moment earlier. offlineQueue.ts and the notification preference were both
// moved off exactly this design, each with its own note explaining why; this was
// the last one still on it.
//
// Milder than either of those, and worth saying why it is fixed the same way
// anyway: a snapshot is only a cache, so losing one costs a slower boot rather
// than a user's unsent writes or a consent nobody gave. It is the same shape of
// problem one severity down, and leaving the shape in place is how it survives
// to reappear somewhere it does matter.
const STORAGE_PREFIX = 'famcart-household-snapshot'
// What every build up to this one wrote: a single device-wide key. Read as a
// fallback rather than discarded — it carries the same userId field the check
// below applies to everything — and removed on the next save.
const LEGACY_SHARED_KEY = STORAGE_PREFIX
// And before that, the pre-rename key, with familyId/familyMembers/... field
// names. Still sitting in the browser of anyone who used the app before that
// deploy, so it is read once, rewritten under the per-user key, and deleted.
// Dropping it instead would cost a returning user their instant-paint list for
// no reason.
const LEGACY_FAMILY_KEY = 'famcart-family-snapshot'
const VERSION = 1

function snapshotKey(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`
}

// The pre-rename snapshot, exactly as it was written.
interface LegacyStoredSnapshot {
  version: number
  userId: string
  savedAt: number
  familyId?: string
  familyName?: string
  familyInviteCode?: string
  familyOwnerId?: string
  familyItemLimit?: number
  familyEmoji?: string
  familyMembers?: HouseholdMemberProfile[]
  items?: ShoppingItemRow[]
  hasShopped?: boolean
}

// Both shapes carry the same values under different names, so normalise once
// here rather than teaching every reader below about the old spelling.
function normaliseStored(parsed: StoredSnapshot & LegacyStoredSnapshot): StoredSnapshot {
  return {
    ...parsed,
    householdId: parsed.householdId ?? parsed.familyId ?? '',
    householdName: parsed.householdName ?? parsed.familyName ?? '',
    householdInviteCode: parsed.householdInviteCode ?? parsed.familyInviteCode ?? '',
    householdOwnerId: parsed.householdOwnerId ?? parsed.familyOwnerId ?? '',
    householdItemLimit: parsed.householdItemLimit ?? parsed.familyItemLimit ?? 50,
    householdEmoji: parsed.householdEmoji ?? parsed.familyEmoji ?? '',
    householdMembers: parsed.householdMembers ?? parsed.familyMembers ?? [],
    items: parsed.items ?? [],
  }
}

// Older than this and the snapshot is more likely to confuse than help.
export const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

// Everything else in a snapshot is display text that gets escaped on its way to
// the DOM, and is overwritten by the first fetch anyway. The household id is
// different: it is read back out as a QUERY parameter, and one of its uses
// (lib/productSuggestions) interpolates it into a PostgREST `or` filter, whose
// syntax is comma- and dot-separated. The comment there is right that the id is
// server-issued — but only on the live path. Restored from a snapshot it is
// whatever localStorage happened to hold, and localStorage is not a trust
// boundary the app controls.
//
// RLS is still what decides which rows anyone may see, so this is not the thing
// standing between a tampered cache and another household's list. It is the
// cheap check that keeps a value that was never an id from being spliced into a
// filter expression at all.
//
// Deliberately "an opaque identifier" rather than "a uuid", though in
// production it is always the latter. What has to be excluded is PostgREST's
// filter syntax — the comma that separates conditions, the dot that separates
// column from operator, parens, colons, quotes, whitespace — and an allowlist
// of identifier characters excludes all of it. Demanding the full uuid shape
// would additionally assert a storage format this module has no reason to
// care about, and would break on any future id scheme without being any safer
// against the thing it is actually guarding.
const HOUSEHOLD_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

function isHouseholdId(value: unknown): value is string {
  return typeof value === 'string' && HOUSEHOLD_ID_PATTERN.test(value)
}

export function loadHouseholdSnapshot(
  storage: Storage,
  userId: string,
  now: number = Date.now(),
): HouseholdSnapshot | null {
  try {
    // This account's own key first; the two device-wide predecessors only as
    // fallbacks, each still subject to the userId check below.
    const raw =
      storage.getItem(snapshotKey(userId))
      ?? storage.getItem(LEGACY_SHARED_KEY)
      ?? storage.getItem(LEGACY_FAMILY_KEY)
    if (!raw) return null
    const stored = normaliseStored(JSON.parse(raw))
    if (stored.version !== VERSION) return null
    // Never show one account's list to another account on the same browser.
    if (stored.userId !== userId) return null
    if (now - stored.savedAt > SNAPSHOT_MAX_AGE_MS) return null
    if (!isHouseholdId(stored.householdId) || !Array.isArray(stored.items) || !Array.isArray(stored.householdMembers)) {
      return null
    }
    return {
      householdId: stored.householdId,
      householdName: stored.householdName ?? '',
      householdInviteCode: stored.householdInviteCode ?? '',
      householdOwnerId: stored.householdOwnerId ?? '',
      householdItemLimit: typeof stored.householdItemLimit === 'number' ? stored.householdItemLimit : 50,
      householdEmoji: stored.householdEmoji ?? '',
      householdMembers: stored.householdMembers,
      items: stored.items,
      // Snapshots written before this field existed are still version 1, so
      // default rather than discard them: false is the pre-existing behaviour.
      hasShopped: stored.hasShopped === true,
    }
  } catch {
    return null
  }
}

export function saveHouseholdSnapshot(
  storage: Storage,
  userId: string,
  snapshot: HouseholdSnapshot,
  now: number = Date.now(),
): void {
  const stored: StoredSnapshot = { ...snapshot, version: VERSION, userId, savedAt: now }
  try {
    storage.setItem(snapshotKey(userId), JSON.stringify(stored))
    // Both device-wide copies have been superseded by this write. Removing them
    // here rather than on read means a browser that only ever reads (a session
    // that never saves) keeps its fallback instead of being left with neither.
    storage.removeItem(LEGACY_SHARED_KEY)
    storage.removeItem(LEGACY_FAMILY_KEY)
  } catch {
    // Quota exceeded or storage disabled — skip; the app works without it.
  }
}

// `userId` scopes it to one account. Without one — a caller that cannot say
// whose snapshot this is — every account's is cleared, which is the safer end of
// the trade on a shared browser. Same signature and same reasoning as
// clearOfflineQueue.
export function clearHouseholdSnapshot(storage: Storage, userId?: string): void {
  try {
    storage.removeItem(LEGACY_SHARED_KEY)
    storage.removeItem(LEGACY_FAMILY_KEY)
    if (userId) {
      storage.removeItem(snapshotKey(userId))
      return
    }
    // Guarded: the Storage stub the unit tests hand in implements only the three
    // accessors, and enumeration is not part of what the scoped path needs.
    if (typeof storage.length !== 'number' || typeof storage.key !== 'function') return
    const doomed: string[] = []
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i)
      if (key && key.startsWith(`${STORAGE_PREFIX}:`)) doomed.push(key)
    }
    // Collected first: removing while iterating renumbers the remaining keys.
    for (const key of doomed) storage.removeItem(key)
  } catch {
    // Storage disabled — nothing to clear.
  }
}

// Which of a user's households is currently active, so the choice survives reloads.
// Keyed to the user so switching accounts on one browser never carries over. The
// stored id is only a hint: HomeView uses it only if it still matches a live
// membership, otherwise it falls back to the first household.
const ACTIVE_HOUSEHOLD_KEY = 'famcart-active-household'
// Same story as the snapshot above: pre-rename builds wrote { userId, familyId }
// here. Losing it is milder — the user lands on their first household instead of
// the one they last picked — but it is still a visible wrong answer on the first
// load after the deploy, and reading one extra key avoids it.
const LEGACY_ACTIVE_KEY = 'famcart-active-family'

export function loadActiveHouseholdId(storage: Storage, userId: string): string | null {
  try {
    const raw = storage.getItem(ACTIVE_HOUSEHOLD_KEY) ?? storage.getItem(LEGACY_ACTIVE_KEY)
    if (!raw) return null
    const stored = JSON.parse(raw) as { userId?: string; householdId?: string; familyId?: string }
    if (stored.userId !== userId) return null
    // Same reasoning as the snapshot above. This one is checked against live
    // memberships before it is used, so it is the better-guarded of the two —
    // but both end up in the same place, and only one of them being validated
    // is how the unvalidated one gets forgotten.
    const active = stored.householdId || stored.familyId || null
    return isHouseholdId(active) ? active : null
  } catch {
    return null
  }
}

export function saveActiveHouseholdId(storage: Storage, userId: string, householdId: string): void {
  try {
    storage.setItem(ACTIVE_HOUSEHOLD_KEY, JSON.stringify({ userId, householdId }))
    storage.removeItem(LEGACY_ACTIVE_KEY)
  } catch {
    // Storage disabled — the active household just won't persist across reloads.
  }
}

export function clearActiveHouseholdId(storage: Storage): void {
  try {
    storage.removeItem(ACTIVE_HOUSEHOLD_KEY)
    storage.removeItem(LEGACY_ACTIVE_KEY)
  } catch {
    // Storage disabled — nothing to clear.
  }
}
