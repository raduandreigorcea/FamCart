// @vitest-environment happy-dom
//
// The report library's job is to make a report actionable without asking the
// person for anything the app can read itself. These pin the two halves of
// that: what counts as sendable, and what gets attached.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  REPORT_SURFACES,
  collectDiagnostics,
  describeDiagnostics,
  isReportSendable,
  submitReport,
  surfaceLabel,
} from '../src/lib/issueReport'
import { __setOnlineForTest } from '../src/lib/connectivity'
import { enqueueOfflineMutation } from '../src/lib/offlineQueue'

beforeEach(() => {
  localStorage.clear()
  __setOnlineForTest(true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('what can be sent', () => {
  // A bug with no place is the report this whole design exists to prevent.
  it('holds a bug back until it says where', () => {
    expect(isReportSendable({ kind: 'bug', surface: '', message: 'the list broke' })).toBe(false)
    expect(isReportSendable({ kind: 'bug', surface: 'list', message: 'the list broke' })).toBe(true)
  })

  // An idea is not about a defect, so there is no place to ask for.
  it('asks an idea for nothing but the idea', () => {
    expect(isReportSendable({ kind: 'idea', surface: '', message: 'sort by aisle' })).toBe(true)
  })

  it('rejects an empty or throwaway message', () => {
    expect(isReportSendable({ kind: 'idea', surface: '', message: '   ' })).toBe(false)
    expect(isReportSendable({ kind: 'idea', surface: '', message: 'no' })).toBe(false)
  })

  it('names every place it offers, and falls back rather than showing an id', () => {
    for (const place of REPORT_SURFACES) {
      expect(surfaceLabel(place.id)).toBe(place.label)
    }
    expect(surfaceLabel('nonexistent')).toBe('Somewhere else')
  })
})

describe('what rides along', () => {
  it('reads the version and platform without being asked', () => {
    const diagnostics = collectDiagnostics({ householdId: 'h1', userId: 'u1' })

    expect(diagnostics.version).toBeTruthy()
    expect(diagnostics.platform).toBeTruthy()
    expect(diagnostics.householdId).toBe('h1')
  })

  // Sending needs a connection, so a report that arrives is always from someone
  // who was online. A field with one possible value is a line to read past.
  it('does not carry a connection state, which could only ever say one thing', () => {
    expect(collectDiagnostics({ userId: 'u1' })).not.toHaveProperty('connection')

    __setOnlineForTest(false)
    const lines = describeDiagnostics(collectDiagnostics({ userId: 'u1' }))
    expect(lines.join(' ')).not.toMatch(/online|offline|connected/i)
  })

  // "My items keep disappearing" is nearly always this, and it is invisible
  // from the outside — so the report says it without anyone knowing to.
  it('flags edits that are still waiting to sync', () => {
    expect(collectDiagnostics({ userId: 'u1' }).pendingOfflineEdits).toBe(false)

    enqueueOfflineMutation(localStorage, 'u1', { type: 'check', itemId: 'i1', checked: true })
    expect(collectDiagnostics({ userId: 'u1' }).pendingOfflineEdits).toBe(true)
  })

  // The disclosure in the dialog is generated from the same object that is
  // sent, so it cannot drift from what actually travels.
  it('describes itself in sentences, not key/value pairs', () => {
    const lines = describeDiagnostics({
      version: '0.1.9',
      platform: 'browser',
      pendingOfflineEdits: true,
      householdId: 'h1',
      userId: 'u1',
    })

    expect(lines[0]).toContain('0.1.9')
    expect(lines).toContain('Has edits waiting to sync')
    expect(lines.join(' ')).not.toContain('h1')
  })
})

describe('sending', () => {
  // Offline it does not pretend. The dialog turns this into "nothing was sent",
  // which is the one thing a report form must never get wrong.
  it('refuses rather than silently dropping the report when offline', async () => {
    __setOnlineForTest(false)

    const ok = await submitReport({
      kind: 'bug',
      surface: 'list',
      message: 'ticked milk and it came back',
      diagnostics: collectDiagnostics({ userId: 'u1' }),
    })

    expect(ok).toBe(false)
  })

  // No DSN in dev, CI or tests, so there is genuinely nowhere for it to go.
  it('reports failure when there is no reporting backend configured', async () => {
    const ok = await submitReport({
      kind: 'idea',
      surface: '',
      message: 'sort the list by aisle',
      diagnostics: collectDiagnostics({ userId: 'u1' }),
    })

    expect(ok).toBe(false)
  })
})
