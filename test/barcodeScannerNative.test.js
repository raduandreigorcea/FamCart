// Where a native scan ENDS UP, which is the half a user actually feels.
//
// The app hands scanning to Google's own scanner, and that scanner has exactly
// two ways to finish: with a code, or without one. The second is nearly always a
// Back press, and what happens next is the whole subject here — because getting
// it wrong is not a no-op. Falling through to our own camera screen answers
// "I've changed my mind" by opening a second camera and asking for a permission
// the user was in the middle of walking away from.
//
// The boundary these tests pin down is WHERE the fallback lives: before the
// scanner appears (this device cannot use it — our camera screen is the only way
// it will scan anything) and never after (the scanner ran; whatever it returned
// is final).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  isSupported: null,
  moduleAvailable: null,
  installModule: null,
  scan: null,
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}))

vi.mock('@capacitor-mlkit/barcode-scanning', () => ({
  BarcodeScanner: {
    isSupported: () => mocks.isSupported(),
    isGoogleBarcodeScannerModuleAvailable: () => mocks.moduleAvailable(),
    installGoogleBarcodeScannerModule: () => mocks.installModule(),
    scan: () => mocks.scan(),
  },
  BarcodeFormat: {
    Ean13: 'EAN_13',
    Ean8: 'EAN_8',
    UpcA: 'UPC_A',
    UpcE: 'UPC_E',
    Itf: 'ITF',
  },
}))

const { scanWithNativeScanner } = await import('../src/lib/barcodeScanner')

beforeEach(() => {
  // The happy path by default; each test breaks the one thing it is about.
  mocks.isSupported = async () => ({ supported: true })
  mocks.moduleAvailable = async () => ({ available: true })
  mocks.installModule = async () => {}
  mocks.scan = async () => ({ barcodes: [{ rawValue: '5941234567890' }] })
})

describe('scanWithNativeScanner', () => {
  it('returns the code Google read', async () => {
    expect(await scanWithNativeScanner()).toEqual({ ok: true, code: '5941234567890' })
  })

  it('ignores a decode the catalog could never be holding', async () => {
    // The format list should make this impossible, but a scanner that hands
    // back a shelf label has not read a product and must not send one on to the
    // lookup.
    mocks.scan = async () => ({ barcodes: [{ rawValue: 'SHELF-42' }] })
    expect(await scanWithNativeScanner()).toEqual({ ok: true, code: null })
  })

  // ─── The bug this file exists for ──────────────────────────────────────────
  // Backing out REJECTS rather than resolving empty, and the rejection is a bare
  // message string: Capacitor's reject(String) carries no error code, so from
  // JavaScript a cancel is indistinguishable from an internal failure. The old
  // code sniffed for the word "cancel" to tell them apart, which meant any
  // wording Google did not match sent the user to our camera screen and its
  // permission prompt — with no way to say "I just wanted out".
  it('treats a Back press out of the scanner as the end of it, not a reason to fall back', async () => {
    mocks.scan = async () => {
      throw new Error('scan canceled.')
    }
    expect(await scanWithNativeScanner()).toEqual({ ok: true, code: null })
  })

  it('does the same for a rejection that says nothing recognisable at all', async () => {
    // The case the substring match got wrong. Nothing here is worth reading:
    // the scanner was on screen, and it is gone.
    mocks.scan = async () => {
      throw new Error('17: API_UNAVAILABLE')
    }
    expect(await scanWithNativeScanner()).toEqual({ ok: true, code: null })
  })

  it('does the same for a rejection carrying no message', async () => {
    mocks.scan = async () => {
      throw new Error()
    }
    expect(await scanWithNativeScanner()).toEqual({ ok: true, code: null })
  })

  // ─── Before the scanner appears, falling back is the right answer ──────────
  it('falls back when the device cannot use Google’s scanner', async () => {
    mocks.isSupported = async () => ({ supported: false })
    expect(await scanWithNativeScanner()).toEqual({ ok: false })
  })

  it('falls back when the scanner module will not install', async () => {
    // A download that fails leaves nothing on screen, so the user's tap has not
    // been answered yet — our camera screen is what answers it.
    mocks.moduleAvailable = async () => ({ available: false })
    mocks.installModule = async () => {
      throw new Error('module install failed')
    }
    expect(await scanWithNativeScanner()).toEqual({ ok: false })
  })

  it('installs the module only when it is actually missing', async () => {
    const install = vi.fn(async () => {})
    mocks.installModule = install
    await scanWithNativeScanner()
    expect(install).not.toHaveBeenCalled()

    mocks.moduleAvailable = async () => ({ available: false })
    await scanWithNativeScanner()
    expect(install).toHaveBeenCalledOnce()
  })
})
