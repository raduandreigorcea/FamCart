// Storing one record per account instead of one record with an account stamped
// on it.
//
// Three things on this device are per-account — the offline queue, the household
// snapshot and the notification preference — and all three arrived at the same
// key shape (`${prefix}:${userId}`) by being fixed one at a time, each copying
// the last. The copying is the problem this file exists to stop: the clear half
// is twelve lines with two non-obvious details in it, and a fix made to one copy
// reaches the other only if whoever makes it remembers there is another.
//
// The stamped design they all moved off is worth naming once, here, because the
// severity differs per record and the shape does not. Reading was always safe:
// every one of them checks the stored userId and ignores somebody else's. Writing
// was not, because the single key held whichever account saved last — so the next
// account's write destroyed the previous one's data outright. What that costs
// depends on the record (unsent writes, a re-fetched cache, a consent nobody
// gave), which is exactly why the answer should not be re-litigated per record.

/** The key one account's copy of `prefix` lives under. */
export function userScopedKey(prefix: string, userId: string): string {
  return `${prefix}:${userId}`
}

/**
 * Remove one account's record, or — given no `userId` — every account's.
 *
 * The unscoped sweep is for callers that cannot say who is signed in (a sign-out
 * from a screen that never learned). Clearing everybody's is the safer end of
 * that trade on a shared browser: leaving one behind is what the per-account
 * keying was introduced to prevent.
 *
 * Legacy device-wide keys are each caller's business, since only they know what
 * their old names were; this handles the current shape only.
 */
export function clearUserScopedKeys(storage: Storage, prefix: string, userId?: string): void {
  try {
    if (userId) {
      storage.removeItem(userScopedKey(prefix, userId))
      return
    }
    // Guarded: the Storage stub the unit tests hand in implements only the three
    // accessors, and enumeration is not part of what the scoped path needs.
    if (typeof storage.length !== 'number' || typeof storage.key !== 'function') return
    const doomed: string[] = []
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i)
      if (key && key.startsWith(`${prefix}:`)) doomed.push(key)
    }
    // Collected first: removing while iterating renumbers the remaining keys.
    for (const key of doomed) storage.removeItem(key)
  } catch {
    // Storage disabled — nothing to clear.
  }
}
