// @vitest-environment happy-dom
//
// The early-capture window.
//
// Sentry installs its own global handlers inside init(), which is deferred to
// idle so the SDK stays out of the initial download. That leaves a gap at cold
// start where an unhandled rejection reaches nothing at all — the boot window,
// where the router guard, the Clerk load and the first fetches live.
//
// captureEarlyErrors() stands in for that window. The half worth pinning is the
// handover: these listeners must come off once the SDK is live, or every error
// gets reported twice, and a duplicate is the kind of regression nobody notices
// until they are reading the same stack trace in two issues.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { captureEarlyErrors, startErrorReporting } from '../src/lib/errorReporting'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('captureEarlyErrors', () => {
  it('listens for both kinds of unhandled failure', () => {
    const add = vi.spyOn(window, 'addEventListener')

    const stop = captureEarlyErrors()

    const events = add.mock.calls.map(([name]) => name)
    expect(events).toContain('error')
    expect(events).toContain('unhandledrejection')

    stop()
  })

  it('hands over cleanly, so nothing is reported twice', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')

    const stop = captureEarlyErrors()
    stop()

    // Same handler identities on the way out as on the way in: a removal that
    // passes a different function silently leaves the listener attached, which
    // is the exact shape of the double-reporting bug this guards.
    const added = add.mock.calls.filter(([n]) => n === 'error' || n === 'unhandledrejection')
    const removed = remove.mock.calls.filter(([n]) => n === 'error' || n === 'unhandledrejection')
    expect(removed).toHaveLength(added.length)
    for (const [name, handler] of added) {
      expect(removed.some(([n, h]) => n === name && h === handler)).toBe(true)
    }
  })

  it('ignores resource load failures, which are not exceptions', () => {
    const stop = captureEarlyErrors()

    // A 404 on an <img> raises an 'error' event with no `error` property. It is
    // not a thrown exception and reporting it would only add noise.
    expect(() => window.dispatchEvent(new Event('error'))).not.toThrow()

    stop()
  })

  // Without a DSN the SDK never loads, so startErrorReporting resolves straight
  // away — and main.ts drops the stand-ins on that resolution. This is the dev,
  // CI and test path: it must not leave listeners behind.
  it('is released immediately when there is no DSN to load', async () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const stop = captureEarlyErrors()

    await startErrorReporting({}, {}).finally(stop)

    const removed = remove.mock.calls.map(([n]) => n)
    expect(removed).toContain('error')
    expect(removed).toContain('unhandledrejection')
  })
})
