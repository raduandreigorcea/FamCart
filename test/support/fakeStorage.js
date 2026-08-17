// An in-memory stand-in for localStorage.
//
// Shared because the `length`/`key` half is easy to leave out and expensive to
// leave out: every unscoped clear in the app (clearOfflineQueue,
// clearHouseholdSnapshot, and forgetLocalUserState through both) enumerates the
// store to sweep every account's keys, and guards itself on those two members
// being present. A stub without them does not fail — the guard returns early and
// the branch under test silently never runs.
//
// `seed` fills the store up front, for tests that care what was already there.
// `map` is exposed so a test can assert on the raw contents.
export function makeStorage(seed = {}) {
  const map = new Map(Object.entries(seed).map(([k, v]) => [k, String(v)]))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    map,
  }
}
