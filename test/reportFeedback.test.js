// @vitest-environment happy-dom
//
// Where a sent report actually lands, end to end: submitReport → captureReport
// → Sentry. Its own file because startErrorReporting resolves once per module
// registry, and the other errorReporting test pins the no-DSN branch.
//
// The thing being pinned is that this is feedback, not a message. captureMessage
// groups by message text, so reports would have collapsed into one issue per
// kind and place, each new one arriving as another event on an issue already
// triaged — which is how a report goes unread.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureFeedback: vi.fn(),
  browserTracingIntegration: vi.fn(() => ({ name: 'tracing' })),
}))
vi.mock('@sentry/vue', () => sentry)

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
}))

import { startErrorReporting } from '../src/lib/errorReporting'
import { collectDiagnostics, submitReport } from '../src/lib/issueReport'
import { __setOnlineForTest } from '../src/lib/connectivity'

beforeEach(() => {
  sentry.captureFeedback.mockClear()
  __setOnlineForTest(true)
  // The SDK load is deferred to idle; run it now rather than waiting it out.
  vi.stubGlobal('requestIdleCallback', (cb) => cb())
  vi.stubEnv('VITE_SENTRY_DSN', 'https://examplePublicKey@o0.ingest.sentry.io/0')
})

async function live() {
  await startErrorReporting({}, {})
}

describe('a sent report', () => {
  it('goes to the feedback inbox, one entry per report', async () => {
    await live()

    const ok = await submitReport({
      kind: 'bug',
      surface: 'scan',
      message: '  the scanner froze on the third item  ',
      diagnostics: collectDiagnostics({ householdId: 'h1', userId: 'u1' }),
    })

    expect(ok).toBe(true)
    expect(sentry.captureFeedback).toHaveBeenCalledTimes(1)
  })

  // The person's own words are the one thing in a report nobody else could
  // have written, so they travel verbatim rather than wrapped in a title.
  it('carries the message untouched but for trimming', async () => {
    await live()
    await submitReport({
      kind: 'bug',
      surface: 'scan',
      message: '  the scanner froze on the third item  ',
      diagnostics: collectDiagnostics({ userId: 'u1' }),
    })

    expect(sentry.captureFeedback.mock.calls[0][0].message).toBe(
      'the scanner froze on the third item',
    )
  })

  // Everything the app worked out for itself becomes a tag, so the inbox can
  // be filtered by it — and the place is tagged by its label, because a person
  // reads it: "Barcode scanner" says what "scan" only implies.
  it('tags what the app knew so the inbox can be filtered', async () => {
    await live()
    await submitReport({
      kind: 'bug',
      surface: 'scan',
      message: 'the scanner froze',
      diagnostics: collectDiagnostics({ householdId: 'h1', userId: 'u1' }),
    })

    const { tags } = sentry.captureFeedback.mock.calls[0][0]
    expect(tags.report).toBe('user')
    expect(tags.kind).toBe('bug')
    expect(tags.place).toBe('Barcode scanner')
    expect(tags.householdId).toBe('h1')
    expect(tags.version).toBeTruthy()
  })

  // Sentry's inbox shows this as who reported it. An opaque Clerk id is not a
  // name, but it is what traces a report back to an account.
  it('names the reporter by account rather than leaving it anonymous', async () => {
    await live()
    await submitReport({
      kind: 'idea',
      surface: '',
      message: 'removing someone is hard to find',
      diagnostics: collectDiagnostics({ userId: 'u1' }),
    })

    const params = sentry.captureFeedback.mock.calls[0][0]
    expect(params.name).toBe('u1')
    // Feedback with no place picked must not ship an empty tag.
    expect(params.tags.place).toBeUndefined()
  })

  it('reports failure without sending when offline', async () => {
    await live()
    __setOnlineForTest(false)

    const ok = await submitReport({
      kind: 'bug',
      surface: 'list',
      message: 'items keep coming back',
      diagnostics: collectDiagnostics({ userId: 'u1' }),
    })

    expect(ok).toBe(false)
    expect(sentry.captureFeedback).not.toHaveBeenCalled()
  })
})
