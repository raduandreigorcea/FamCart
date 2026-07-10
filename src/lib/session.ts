// Remembers which user was last confirmed signed in, so the app can boot into
// their cached list when offline — Clerk needs the network to verify a session
// and otherwise reports "signed out", which would bounce a logged-in user to a
// login page that also can't work offline. This is only a routing/cache hint;
// every authenticated request still carries a real Clerk token once online.

const KEY = 'famcart-last-user'

export function rememberUser(storage: Storage, userId: string): void {
  try {
    storage.setItem(KEY, userId)
  } catch {
    // Storage disabled — offline boot just won't be available; nothing breaks.
  }
}

export function getRememberedUser(storage: Storage): string | null {
  try {
    return storage.getItem(KEY)
  } catch {
    return null
  }
}

export function forgetUser(storage: Storage): void {
  try {
    storage.removeItem(KEY)
  } catch {
    // Nothing to clear.
  }
}
