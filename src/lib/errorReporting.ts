// Error reporting, kept out of the initial download.
//
// @sentry/vue is ~218 KB — about a third of the app's JavaScript — and it was
// imported at module scope in main.ts, so every cold start paid for it before
// the first item could be rendered. On a grocery list opened on a phone in a
// shop, that is the wrong thing to spend a connection on.
//
// So the SDK is loaded after the app is up and idle, and everything that wants
// to report an error talks to this module instead of importing Sentry directly.
// Reports raised before it lands are buffered and flushed on arrival.
//
// The cost, stated plainly: the initial pageload transaction is no longer
// traced, because tracing has to be installed before the load it measures. At a
// 10% trace sample rate that is a small loss against a third of the bundle, but
// it is a loss rather than a free win.

import type { App } from 'vue'
import type { Router } from 'vue-router'

// Only the one function is held, never the module namespace. Keeping the
// namespace alive (`sentry = module`) forces the bundler to retain every export
// the SDK has, because any of them might be reached through it — which turned
// the lazy chunk into 444 KB against the 142 KB the static import had been
// tree-shaken down to. Naming the three exports used is what lets that shaking
// still happen across a dynamic import.
let capture: ((error: unknown) => void) | null = null
let loading: Promise<void> | null = null

// Bounded on purpose. Without a DSN (local dev, CI, tests) the SDK never loads
// and this queue is the only thing holding the reports, so it must not become a
// leak in a long session.
const MAX_BUFFERED = 20
const buffered: unknown[] = []

// The one way the rest of the app reports an error. Safe before, during and
// after loading, and a no-op in an environment with no DSN.
export function captureException(error: unknown): void {
  if (capture) {
    capture(error)
    return
  }
  if (buffered.length < MAX_BUFFERED) buffered.push(error)
}

function flush(): void {
  if (!capture) return
  for (const error of buffered) capture(error)
  buffered.length = 0
}

// Stand-in global handlers for the window before the SDK lands.
//
// Sentry installs its own onerror/onunhandledrejection hooks inside init(),
// which is deliberately deferred to idle (see above). Until then nothing is
// listening: a Vue render error still reaches captureException through App.vue's
// onErrorCaptured, but a plain unhandled rejection simply vanishes — and this
// codebase has many fire-and-forget `void someAsync()` calls that produce
// exactly those. On a fast machine that window is milliseconds; on a slow phone
// it is the full idle timeout, which is precisely the boot window the router
// guard, the Clerk load and the first fetches occupy.
//
// These feed the same buffer everything else uses, so a report raised here is
// flushed to Sentry the moment it arrives. Returns an unregister function: the
// caller drops them once reporting is live, so nothing is reported twice.
export function captureEarlyErrors(): () => void {
  if (typeof window === 'undefined') return () => {}

  // event.error is absent for resource-load failures (a 404 on an <img> raises
  // an 'error' event too). Those are not exceptions and would only add noise.
  const onError = (event: ErrorEvent) => {
    if (event.error) captureException(event.error)
  }
  const onRejection = (event: PromiseRejectionEvent) => {
    captureException(event.reason)
  }

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)

  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}

// Defer to whenever the browser is next idle, so the SDK competes with nothing
// that matters. The timeout is the ceiling: on a busy page idle may never come,
// and an error reporter that waits forever reports nothing.
function whenIdle(run: () => void): void {
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void })
    .requestIdleCallback
  if (typeof idle === 'function') idle(run, { timeout: 4000 })
  else setTimeout(run, 2000)
}

// Called once from main.ts. Resolves when reporting is live, which tests use;
// nothing in the app awaits it.
export function startErrorReporting(app: App, router: Router): Promise<void> {
  if (loading) return loading
  const dsn = import.meta.env.VITE_SENTRY_DSN
  // No DSN means no reporting anywhere — dev, CI and tests all take this path,
  // and captureException stays a cheap no-op that never pulls the SDK in.
  if (!dsn) {
    loading = Promise.resolve()
    return loading
  }

  loading = new Promise<void>((resolve) => {
    whenIdle(() => {
      void import('@sentry/vue')
        .then(({ init, captureException: sentryCapture, browserTracingIntegration }) => {
          init({
            app,
            dsn,
            integrations: [browserTracingIntegration({ router })],
            tracesSampleRate: 0.1,
            // A fetch/websocket aborted because the user navigated mid-request
            // (e.g. Clerk during a login redirect) is expected teardown, not a
            // fault we can act on. Keep it out of the issue stream.
            ignoreErrors: ['AbortError: The connection was closed.'],
            beforeSend(event) {
              // Service-worker registration (vite-plugin-pwa's registerSW.js)
              // can reject while the OAuth callback page is already unloading to
              // redirect; the PWA re-registers on the next load, so there is
              // nothing to fix here.
              const frames = event.exception?.values?.flatMap(
                (value) => value.stacktrace?.frames ?? [],
              )
              if (frames?.some((frame) => (frame.filename ?? '').includes('registerSW.js'))) {
                return null
              }
              return event
            },
          })
          capture = sentryCapture
          flush()
        })
        .catch(() => {
          // The SDK failed to download. Reporting is the one feature allowed to
          // fail silently — surfacing it would be an error about errors.
        })
        .finally(resolve)
    })
  })

  return loading
}
