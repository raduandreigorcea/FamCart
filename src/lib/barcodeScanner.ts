import { Capacitor } from '@capacitor/core'
import { onBeforeUnmount, ref, type Ref } from 'vue'

// The camera half of scanning an item onto the list: getting a stream, getting a
// decoder, and turning frames into a barcode. What that barcode MEANS is
// productSuggestions' job (lookupBarcode), and drawing any of it is
// BarcodeScannerModal's.
//
// Two decoders, one interface. The browser's own BarcodeDetector is backed by
// Play Services on Android — which is what the APK's WebView and Chrome both
// run — so where it exists it is both the best decoder available and free. Where
// it does not (Firefox, Safari), `barcode-detector` provides the same API over a
// ZXing wasm build. That fallback is imported dynamically and only on the miss,
// so the bundle everyone downloads is unchanged and the wasm is fetched by the
// browsers that actually need it.

// Retail formats only, and deliberately all-numeric ones: a shelf edge is
// covered in Code 128 and QR codes that are not the product, and a decoder that
// reads them just gives us confident answers to the wrong question. Every format
// here yields digits that product_catalog.barcode could hold.
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf'] as const

// Roughly four looks per second. Fast enough that pointing at a barcode feels
// instant, slow enough that the decode is not competing with the preview for
// frames on a mid-range phone.
const SCAN_INTERVAL_MS = 240

// How long the same code is ignored after it lands. One barcode stays in frame
// for as long as it takes to move the phone away, which at four scans a second
// is a dozen more reads of a product already added. Long enough to cover that,
// short enough that deliberately scanning the same jar twice still works.
const REPEAT_WINDOW_MS = 2500

// Mirrors product_catalog_barcode_format in 006_product_catalog.sql. A decode
// that could not be stored is not a decode we can look up either.
const BARCODE_RE = /^[0-9]{8,14}$/

// How long the native decoder gets to say which formats it supports. No human is
// involved, so this is purely "is it going to answer" — and in an Android WebView
// it sometimes does not: the answer comes from a Play Services module that may
// still be downloading, and the promise can sit unresolved rather than reject.
// Past this we stop waiting and use the bundled decoder, which needs nobody.
const DETECTOR_TIMEOUT_MS = 4000

// How long the whole start gets, permission prompt included. A human tapping
// Allow is inside this window; a WebView that never answers the permission
// request at all is not. Without it that case is a spinner with no way out —
// getUserMedia simply never settles, so there is no error to catch.
const START_TIMEOUT_MS = 25000

// Resolves to null after ms rather than rejecting, so callers treat "no answer"
// and "no good answer" the same way.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms)
    }),
    // Cleared either way, so a call that answers immediately does not leave a
    // 25-second timer holding a closure alive behind it.
  ]).finally(() => clearTimeout(timer))
}

export type ScannerStatus =
  | 'idle'
  | 'starting'
  | 'scanning'
  /** The user said no, or the browser has the camera blocked for this origin. */
  | 'denied'
  /** No camera, or nothing on this device can decode. Never worth a retry. */
  | 'unavailable'
  /** Something else went wrong — in use by another app, a decoder that failed. */
  | 'error'
  /** Asked for the camera and never got an answer either way. Distinct from
   *  'denied' because nothing was refused, and from 'error' because there is no
   *  error: the request simply went unanswered, which is what a WebView that
   *  mishandles the permission prompt looks like from in here. */
  | 'timeout'

interface DetectedBarcode {
  rawValue: string
}

interface Detector {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>
}

interface DetectorConstructor {
  new (options?: { formats?: readonly string[] }): Detector
  getSupportedFormats?: () => Promise<string[]>
}

/**
 * Whether this device can scan at all — the question the add form asks before
 * offering the button. Camera access is the part that can be missing outright;
 * a decoder is always obtainable, because the fallback ships with the app.
 *
 * True on native regardless: the Google scanner needs no camera of our own.
 */
export function canScanBarcodes(): boolean {
  return (
    Capacitor.isNativePlatform() ||
    (typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getUserMedia === 'function')
  )
}

// ─── The native scanner ──────────────────────────────────────────────────────
// In the app, scanning is Google's job rather than ours. GmsBarcodeScanning
// (behind the plugin's scan()) brings two things the code below cannot:
// auto-zoom, which finds and magnifies a barcode anywhere in frame instead of
// asking the user to fill a rectangle with it, and no camera permission at all —
// the capture happens inside Play Services, not in our process.
//
// The cost is Google's own full-screen UI, which cannot be styled. That was a
// poor trade while a scan added items and the screen stayed open for the next
// one; it is a good one now that a scan just fills the add form and closes,
// because "hand me one barcode" is exactly the shape of scan().
//
// Everything after the code is unchanged and shared with the web path: the
// catalog lookup, filling the form, and naming a product the catalog missed.

/** Whether to use the native scanner rather than our own camera screen. */
export function nativeScanAvailable(): boolean {
  return Capacitor.isNativePlatform()
}

export type NativeScanResult =
  /** The native scanner ran. `code` is null when it ended without one — backed
   *  out of, or failed inside a UI the user was already looking at. */
  | { ok: true; code: string | null }
  /** Never got as far as scanning: no Play Services, the module would not
   *  install, the plugin is not there. The caller falls back to our own camera
   *  screen, which is the only way this device is going to scan anything. */
  | { ok: false }

export async function scanWithNativeScanner(): Promise<NativeScanResult> {
  // ── Can this device use Google's scanner at all? ───────────────────────────
  // Everything in this block runs before any UI appears, so a failure here means
  // the user has seen nothing and falling back to our camera screen is simply
  // how their tap gets answered.
  let plugin: typeof import('@capacitor-mlkit/barcode-scanning')
  try {
    // Imported here rather than at module scope so the plugin never lands in the
    // web bundle's critical path — on a browser this function is not called at
    // all, and the chunk is never fetched.
    plugin = await import('@capacitor-mlkit/barcode-scanning')

    const { supported } = await plugin.BarcodeScanner.isSupported()
    if (!supported) return { ok: false }

    // The scanner is a Play Services module that may not be on the device yet.
    // Installing it is a download, so it is only requested when actually absent.
    const { available } = await plugin.BarcodeScanner.isGoogleBarcodeScannerModuleAvailable()
    if (!available) await plugin.BarcodeScanner.installGoogleBarcodeScannerModule()
  } catch {
    return { ok: false }
  }

  // ── The scan itself ───────────────────────────────────────────────────────
  // Past this line Google's UI is on screen and owns the interaction, so
  // whatever comes back ends it — a code, or nothing. Nothing is overwhelmingly
  // a Back press, and the one thing Back must not do is open a second camera
  // and ask for a permission the user did not want to give. It is not a
  // fallback-worthy failure: this device demonstrably can scan, the user just
  // stopped.
  //
  // Deliberately not read off the rejection. The plugin rejects a cancel with
  // the message "scan canceled." and every other failure with
  // exception.getMessage(), and Capacitor's reject(String) carries no code
  // alongside it (BarcodeScannerPlugin.java) — so from here a cancel and an
  // internal error are the same value, and sniffing for the word "cancel" was
  // matching a string Google never promised. Treating the whole block as "the
  // scanner is done" needs no such promise. The cost is that a genuine mid-scan
  // failure lands the user back where they were with nothing added, which is
  // recoverable by tapping the button again.
  try {
    const { barcodes } = await plugin.BarcodeScanner.scan({
      // The same retail, all-numeric set the web path uses, for the same reason:
      // a shelf edge is full of QR codes that are not the product.
      formats: [
        plugin.BarcodeFormat.Ean13,
        plugin.BarcodeFormat.Ean8,
        plugin.BarcodeFormat.UpcA,
        plugin.BarcodeFormat.UpcE,
        plugin.BarcodeFormat.Itf,
      ],
      autoZoom: true,
    })

    const code =
      barcodes
        .map((barcode) => String(barcode?.rawValue ?? '').trim())
        .find((value) => BARCODE_RE.test(value)) ?? null
    return { ok: true, code }
  } catch {
    return { ok: true, code: null }
  }
}

/**
 * The forms of one scanned code that might be sitting in the catalog.
 *
 * A UPC-A barcode is a 13-digit EAN with a leading zero that the printed symbol
 * leaves off, and Open Food Facts — where the catalog's codes come from — stores
 * the padded form. So a scanner reporting the 12 digits it saw would miss a
 * product that is in there under 13. Both directions are covered because ITF-14
 * cases and older rows can go the other way.
 *
 * Returned longest-first only for stable ordering; the lookup matches any of
 * them.
 */
export function barcodeCandidates(code: string): string[] {
  const digits = String(code ?? '').trim()
  if (!BARCODE_RE.test(digits)) return []

  const forms = new Set<string>([digits])
  // 12 -> 13, the UPC-A case.
  if (digits.length < 14) forms.add(digits.padStart(digits.length + 1, '0'))
  // 13 -> 12, the same product filed under what the symbol prints.
  if (digits.length > 8 && digits.startsWith('0')) forms.add(digits.slice(1))

  return [...forms].filter((form) => BARCODE_RE.test(form))
}

// Resolved once per session and shared: constructing a detector is cheap, but
// deciding which one — and, on the fallback path, fetching a wasm module — is
// not something to repeat every time the scanner opens.
let detectorPromise: Promise<DetectorConstructor | null> | null = null

async function nativeDetector(): Promise<DetectorConstructor | null> {
  const native = (globalThis as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector
  if (typeof native !== 'function') return null
  // Present but useless is a real state: a browser can expose the constructor and
  // support no retail format at all (no Play Services, a desktop build without
  // the decoding backend). Asking is what separates that from a working one, and
  // it is the difference between falling back and shipping a scanner that never
  // sees anything.
  try {
    const ask = native.getSupportedFormats?.()
    // A pending answer is as useless as a bad one, and rather more dangerous:
    // awaited plainly it would hold the whole screen on "starting the camera"
    // with nothing to time out against.
    const supported = ask ? await withTimeout(ask, DETECTOR_TIMEOUT_MS) : []
    if (!supported || !FORMATS.some((format) => supported.includes(format))) return null
  } catch {
    return null
  }
  return native
}

async function resolveDetector(): Promise<DetectorConstructor | null> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      // Nothing below caches a failure: the promise itself is the cache, and it
      // is dropped again if it comes back empty (see the catch on the caller).
      // Caching "no decoder" would make one bad first attempt permanent and turn
      // Try again into a button that reuses the same dead answer forever.
      const native = await nativeDetector()
      if (native) return native
      try {
        // The wasm is served from our own origin, not from the CDN the library
        // reaches for by default. Two reasons, and either alone would be enough:
        // the app is installable, and a scanner that needs jsdelivr is a scanner
        // that stops working on a weak connection in a shop; and a page load
        // should not tell a third party anything about who is using this. Vite
        // fingerprints and precaches the file like any other asset.
        //
        // zxing-wasm is pinned to the exact version barcode-detector depends on
        // (see package.json). A second copy at a different version would pair
        // this binary with mismatched glue code.
        const [ponyfill, wasm] = await Promise.all([
          import('barcode-detector/ponyfill'),
          import('zxing-wasm/reader/zxing_reader.wasm?url'),
        ])
        ponyfill.setZXingModuleOverrides({
          locateFile: (path: string, prefix: string) =>
            path.endsWith('.wasm') ? wasm.default : prefix + path,
        })
        return ponyfill.BarcodeDetector as unknown as DetectorConstructor
      } catch {
        // The wasm did not load — offline on a browser that has never fetched
        // it, most likely. Nothing to scan with, and nothing to retry.
        return null
      }
    })()
  }
  const resolved = await detectorPromise
  if (!resolved) detectorPromise = null
  return resolved
}

// Test seam: forget which decoder was chosen. The cache is deliberately
// process-wide, so without this one test's decoder is every later test's.
export function __resetDetectorForTest(): void {
  detectorPromise = null
}

export interface BarcodeScanner {
  status: Ref<ScannerStatus>
  /** Bind to the <video> the preview plays in. */
  videoRef: Ref<HTMLVideoElement | null>
  /** Stops handing codes to onDetect without dropping the camera. */
  paused: Ref<boolean>
  start: () => Promise<void>
  stop: () => void
}

export function useBarcodeScanner(options: {
  /** Called with a validated, digits-only code. Never called twice in a row for
   *  the same one — see REPEAT_WINDOW_MS. */
  onDetect: (code: string) => void
}): BarcodeScanner {
  const status = ref<ScannerStatus>('idle')
  const videoRef = ref<HTMLVideoElement | null>(null)
  const paused = ref(false)

  let stream: MediaStream | null = null
  let detector: Detector | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  // Guards the loop against itself: a decode can outlast the interval on a slow
  // device, and stacking them turns a busy frame into a queue of busy frames.
  let detecting = false
  let lastCode = ''
  let lastCodeAt = 0
  // Which start() call owns the scanner. getUserMedia is slow enough that the
  // modal can close and reopen mid-await; without this the first call's stream
  // would be adopted by the second's state and never stopped.
  let runId = 0

  async function tick() {
    if (detecting || paused.value || !detector) return
    const video = videoRef.value
    // readyState below HAVE_CURRENT_DATA means there is no frame to decode yet,
    // and passing one to the detector is an exception rather than an empty result.
    if (!video || video.readyState < 2) return

    detecting = true
    try {
      const found = await detector.detect(video)
      for (const barcode of found) {
        const code = String(barcode?.rawValue ?? '').trim()
        if (!BARCODE_RE.test(code)) continue
        const now = Date.now()
        if (code === lastCode && now - lastCodeAt < REPEAT_WINDOW_MS) continue
        lastCode = code
        lastCodeAt = now
        options.onDetect(code)
        // One code per frame. Two barcodes genuinely in shot at once is a
        // packaging accident, not an instruction to add two things.
        break
      }
    } catch {
      // A single bad frame is not a broken scanner. The next tick gets a new one.
    } finally {
      detecting = false
    }
  }

  async function start(): Promise<void> {
    if (status.value === 'starting' || status.value === 'scanning') return
    const run = ++runId
    status.value = 'starting'
    lastCode = ''

    if (!canScanBarcodes()) {
      status.value = 'unavailable'
      return
    }

    const Detector = await resolveDetector()
    if (run !== runId) return
    if (!Detector) {
      status.value = 'unavailable'
      return
    }

    try {
      // The rear camera, at a resolution that can actually resolve the bars.
      // `ideal` rather than `exact` throughout: a laptop has one camera facing
      // the wrong way and should still scan rather than refuse.
      //
      // Timed, because this is the call that hangs. In a WebView the permission
      // prompt is put up by the host app rather than the browser, and a host
      // that neither grants nor denies leaves this promise pending for good —
      // no rejection, no error, just a spinner. The window is long enough to
      // contain a person reading the prompt and tapping Allow.
      const opened = await withTimeout(
        navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        }),
        START_TIMEOUT_MS,
      )
      if (run !== runId) {
        opened?.getTracks().forEach((track) => track.stop())
        return
      }
      if (!opened) {
        status.value = 'timeout'
        return
      }
      stream = opened
    } catch (error) {
      if (run !== runId) return
      const name = (error as { name?: string })?.name
      status.value =
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'denied'
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? 'unavailable'
            : 'error'
      return
    }

    detector = new Detector({ formats: FORMATS })

    const video = videoRef.value
    if (video) {
      video.srcObject = stream
      // Deliberately not awaited. A preview that has not painted yet is not a
      // reason to keep saying "starting the camera": we hold a live stream and a
      // decoder, which is the whole of what scanning needs, and the read loop
      // checks readyState per frame anyway. Awaiting it also meant a play() that
      // never settled — which a WebView can do — stranded the screen exactly
      // where a failed permission would have. The catch is for the ordinary
      // rejection; muted + playsinline on the element are what make it rare.
      void video.play().catch(() => {})
    }

    status.value = 'scanning'
    timer = setInterval(() => void tick(), SCAN_INTERVAL_MS)
  }

  function stop(): void {
    runId++
    if (timer) clearInterval(timer)
    timer = null
    detecting = false
    paused.value = false

    const video = videoRef.value
    if (video) {
      video.pause()
      video.srcObject = null
    }
    // Releasing every track is what turns the camera indicator off. Dropping the
    // reference alone leaves it on until GC decides otherwise.
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    detector = null
    status.value = 'idle'
  }

  onBeforeUnmount(stop)

  return { status, videoRef, paused, start, stop }
}
