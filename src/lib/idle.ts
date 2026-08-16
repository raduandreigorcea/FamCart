// Running something once the app is up and the browser has nothing better to do.
//
// Two things defer work this way, for the same reason and with the same
// trade-off: the Sentry SDK (lib/errorReporting) and the OneSignal web SDK
// (lib/pushNotifications). Both are large third-party downloads that no part of
// opening a shopping list depends on, and both were once paid for during boot.
//
// The timeout is the ceiling rather than the target. On a busy page idle may
// never arrive, and work that waits forever never happens — so this is "soon,
// but not now", not "maybe".
export function whenIdle(run: () => void): void {
  const idle = (
    globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }
  ).requestIdleCallback
  if (typeof idle === 'function') idle(run, { timeout: 4000 })
  else setTimeout(run, 2000)
}
