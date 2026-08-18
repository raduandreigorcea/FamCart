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

// Every export startErrorReporting destructures has to be here, including ones
// this file never asserts on. Vitest throws on reading an export the mock does
// not declare, that throw lands in the SDK load's deliberately silent .catch(),
// and the symptom is not "setUser is missing" but every test below failing with
// captureFeedback never called. setUser arrived exactly that way.
//
// getClient is here for a second reason on top of that one: the delivery check
// below is the only thing that can tell a report that reached Sentry from one an
// ad blocker ate, and it hangs off the client's afterSendEvent hook.
const sentry = vi.hoisted(() => {
  const hooks = {}
  // Stands in for Sentry accepting the envelope, which is what happens unless
  // something eats the request. Tests that want the other answer override the
  // implementation for one call.
  const deliver = (response) => {
    queueMicrotask(() => hooks.afterSendEvent?.({ event_id: 'evt-1' }, response))
  }
  return {
    hooks,
    deliver,
    init: vi.fn(),
    captureException: vi.fn(),
    captureFeedback: vi.fn(() => {
      deliver({ statusCode: 200 })
      return 'evt-1'
    }),
    setUser: vi.fn(),
    getClient: vi.fn(() => ({
      on: (name, handler) => {
        hooks[name] = handler
      },
    })),
    browserTracingIntegration: vi.fn(() => ({ name: 'tracing' })),
  }
})
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

// The reason this file exists in the shape it does.
//
// captureFeedback hands the envelope to the transport and returns an id; the POST
// happens after. So "we called captureFeedback" is not "the report arrived", and
// the difference is not hypothetical: Sentry's ingest host is on EasyPrivacy, so
// every ad blocker drops the request, and three reports sent from a desktop
// browser were lost this way while the dialog said they had been sent. Telling
// someone their report went when it did not is worse than telling them it didn't
// — they are waiting on an answer that is never coming.
//
// afterSendEvent is what distinguishes the two. A blocked or failed request still
// fires it, but with no statusCode, because the client swallows the transport
// error and hands back an empty response.
describe('a report that never reaches Sentry', () => {
  it('is reported as failed when the request is blocked', async () => {
    await live()
    sentry.captureFeedback.mockImplementationOnce(() => {
      // What a blocked POST looks like from here: fired, but empty.
      sentry.deliver({})
      return 'evt-1'
    })

    const ok = await submitReport({
      kind: 'bug',
      surface: 'list',
      message: 'the list forgets what I ticked',
      diagnostics: collectDiagnostics({ userId: 'u1' }),
    })

    expect(ok).toBe(false)
  })

  // A 429 means Sentry got it and threw it away, which is still not a report
  // anyone will read.
  it('is reported as failed when Sentry rejects the envelope', async () => {
    await live()
    sentry.captureFeedback.mockImplementationOnce(() => {
      sentry.deliver({ statusCode: 429 })
      return 'evt-1'
    })

    const ok = await submitReport({
      kind: 'idea',
      surface: '',
      message: 'let me sort the list by aisle',
      diagnostics: collectDiagnostics({ userId: 'u1' }),
    })

    expect(ok).toBe(false)
  })
})
