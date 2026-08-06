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

const STORAGE_KEY = 'famcart-household-snapshot'
// What every build before the families→households rename wrote, under the old
// key and with familyId/familyMembers/... field names. It is still sitting in
// the browser of everyone who used the app before that deploy, so this is read
// once, rewritten under the key above, and then deleted. Dropping it instead
// would cost a returning user their instant-paint list for no reason.
const LEGACY_STORAGE_KEY = 'famcart-family-snapshot'
const VERSION = 1

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

export function loadHouseholdSnapshot(
  storage: Storage,
  userId: string,
  now: number = Date.now(),
): HouseholdSnapshot | null {
  try {
    const raw = storage.getItem(STORAGE_KEY) ?? storage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return null
    const stored = normaliseStored(JSON.parse(raw))
    if (stored.version !== VERSION) return null
    // Never show one account's list to another account on the same browser.
    if (stored.userId !== userId) return null
    if (now - stored.savedAt > SNAPSHOT_MAX_AGE_MS) return null
    if (!stored.householdId || !Array.isArray(stored.items) || !Array.isArray(stored.householdMembers)) {
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
    storage.setItem(STORAGE_KEY, JSON.stringify(stored))
    // The legacy copy has been superseded by this write. Removing it here rather
    // than on read means a browser that only ever reads (a session that never
    // saves) keeps its fallback instead of being left with neither.
    storage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    // Quota exceeded or storage disabled — skip; the app works without it.
  }
}

export function clearHouseholdSnapshot(storage: Storage): void {
  try {
    storage.removeItem(STORAGE_KEY)
    storage.removeItem(LEGACY_STORAGE_KEY)
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
    return stored.householdId || stored.familyId || null
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
