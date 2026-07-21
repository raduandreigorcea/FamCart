import type { FamilyMemberProfile, ShoppingItemRow } from './familyRealtime'

// Last known family state, keyed to one user. Read on startup so a returning
// user sees their list instantly (stale-while-revalidate) instead of skeletons
// while Clerk and the first Supabase fetches warm up; the fresh data then
// overwrites it. The cache is an optimization only — every failure mode
// degrades to "no snapshot".

export interface FamilySnapshot {
  familyId: string
  familyName: string
  familyInviteCode: string
  familyOwnerId: string
  familyItemLimit: number
  familyMembers: FamilyMemberProfile[]
  items: ShoppingItemRow[]
}

interface StoredSnapshot extends FamilySnapshot {
  version: number
  userId: string
  savedAt: number
}

const STORAGE_KEY = 'famcart-family-snapshot'
const VERSION = 1

// Older than this and the snapshot is more likely to confuse than help.
export const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export function loadFamilySnapshot(
  storage: Storage,
  userId: string,
  now: number = Date.now(),
): FamilySnapshot | null {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return null
    const stored = JSON.parse(raw) as StoredSnapshot
    if (stored.version !== VERSION) return null
    // Never show one account's list to another account on the same browser.
    if (stored.userId !== userId) return null
    if (now - stored.savedAt > SNAPSHOT_MAX_AGE_MS) return null
    if (!stored.familyId || !Array.isArray(stored.items) || !Array.isArray(stored.familyMembers)) {
      return null
    }
    return {
      familyId: stored.familyId,
      familyName: stored.familyName ?? '',
      familyInviteCode: stored.familyInviteCode ?? '',
      familyOwnerId: stored.familyOwnerId ?? '',
      familyItemLimit: typeof stored.familyItemLimit === 'number' ? stored.familyItemLimit : 50,
      familyMembers: stored.familyMembers,
      items: stored.items,
    }
  } catch {
    return null
  }
}

export function saveFamilySnapshot(
  storage: Storage,
  userId: string,
  snapshot: FamilySnapshot,
  now: number = Date.now(),
): void {
  const stored: StoredSnapshot = { ...snapshot, version: VERSION, userId, savedAt: now }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // Quota exceeded or storage disabled — skip; the app works without it.
  }
}

export function clearFamilySnapshot(storage: Storage): void {
  try {
    storage.removeItem(STORAGE_KEY)
  } catch {
    // Storage disabled — nothing to clear.
  }
}

// Which of a user's families is currently active, so the choice survives reloads.
// Keyed to the user so switching accounts on one browser never carries over. The
// stored id is only a hint: HomeView uses it only if it still matches a live
// membership, otherwise it falls back to the first family.
const ACTIVE_FAMILY_KEY = 'famcart-active-family'

export function loadActiveFamilyId(storage: Storage, userId: string): string | null {
  try {
    const raw = storage.getItem(ACTIVE_FAMILY_KEY)
    if (!raw) return null
    const stored = JSON.parse(raw) as { userId?: string; familyId?: string }
    if (stored.userId !== userId) return null
    return stored.familyId || null
  } catch {
    return null
  }
}

export function saveActiveFamilyId(storage: Storage, userId: string, familyId: string): void {
  try {
    storage.setItem(ACTIVE_FAMILY_KEY, JSON.stringify({ userId, familyId }))
  } catch {
    // Storage disabled — the active family just won't persist across reloads.
  }
}

export function clearActiveFamilyId(storage: Storage): void {
  try {
    storage.removeItem(ACTIVE_FAMILY_KEY)
  } catch {
    // Storage disabled — nothing to clear.
  }
}
