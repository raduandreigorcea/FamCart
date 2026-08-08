// @vitest-environment happy-dom
//
// The camera lifecycle. Everything here is a failure the user would meet as
// either a scanner that does nothing or — worse, and silently — a camera light
// that stays on after the screen is gone, because releasing a MediaStream means
// stopping every track rather than dropping the reference to it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import BarcodeScannerModal from '../src/components/BarcodeScannerModal.vue'
import { useBarcodeScanner, __resetDetectorForTest } from '../src/lib/barcodeScanner'

// A frame is always ready: HAVE_CURRENT_DATA is the floor the loop checks before
// handing anything to the decoder.
const fakeVideo = () => ({
  readyState: 4,
  pause() {},
  play: async () => {},
  srcObject: null,
})

function fakeStream() {
  const tracks = [{ stopped: false, stop() { this.stopped = true } }]
  return { tracks, getTracks: () => tracks }
}

// Mounts the composable so onBeforeUnmount is wired the way it is in the modal.
function harness(onDetect = () => {}) {
  let api
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useBarcodeScanner({ onDetect })
        return () => h('div')
      },
    }),
  )
  api.videoRef.value = fakeVideo()
  return { api, wrapper }
}

let detected

beforeEach(() => {
  detected = []
  vi.useFakeTimers()
  // Which decoder won is cached for the life of the process, so one test's
  // answer would otherwise be handed to every test after it.
  __resetDetectorForTest()
  globalThis.BarcodeDetector = class {
    static async getSupportedFormats() {
      return ['ean_13', 'ean_8', 'upc_a']
    }
    async detect() {
      return detected
    }
  }
})

afterEach(() => {
  vi.useRealTimers()
  delete globalThis.BarcodeDetector
  delete navigator.mediaDevices
})

describe('the scanner camera', () => {
  it('releases every track when it stops', async () => {
    const stream = fakeStream()
    navigator.mediaDevices = { getUserMedia: async () => stream }
    const { api } = harness()

    await api.start()
    expect(api.status.value).toBe('scanning')

    api.stop()

    // The whole point: a stream that is merely dereferenced keeps the camera
    // indicator lit until the collector gets round to it.
    expect(stream.tracks.every((track) => track.stopped)).toBe(true)
    expect(api.status.value).toBe('idle')
  })

  it('releases the camera when the screen is unmounted without stopping', async () => {
    const stream = fakeStream()
    navigator.mediaDevices = { getUserMedia: async () => stream }
    const { api, wrapper } = harness()
    await api.start()

    wrapper.unmount()

    expect(stream.tracks.every((track) => track.stopped)).toBe(true)
  })

  it('releases a stream that arrived after the screen was already closed', async () => {
    // The permission prompt can outlast the dialog: the user opens the scanner,
    // taps Back, then answers Allow. Nothing is going to show that stream.
    const stream = fakeStream()
    let release
    navigator.mediaDevices = { getUserMedia: () => new Promise((r) => (release = r)) }
    const { api } = harness()

    const starting = api.start()
    // start() resolves a decoder before it asks for the camera, so the prompt is
    // not up yet on the tick start() was called.
    while (!release) await Promise.resolve()
    api.stop()
    release(stream)
    await starting

    expect(stream.tracks.every((track) => track.stopped)).toBe(true)
    expect(api.status.value).toBe('idle')
  })

  // The APK's failure: the scanner sat on "Starting the camera" for good. In a
  // WebView the permission prompt belongs to the host app, and a host that
  // neither grants nor denies leaves getUserMedia pending — no rejection to
  // catch, no error to report, and nothing on screen but a spinner.
  it('gives up on a camera request that is never answered', async () => {
    navigator.mediaDevices = { getUserMedia: () => new Promise(() => {}) }
    const { api } = harness()

    const starting = api.start()
    await vi.advanceTimersByTimeAsync(30000)
    await starting

    expect(api.status.value).toBe('timeout')
  })

  it('goes live without waiting for the preview to start playing', async () => {
    // play() can also hang in a WebView. Holding "starting" until it resolves
    // put the screen in the same dead state as an unanswered permission — and a
    // stream plus a decoder is already everything scanning needs.
    navigator.mediaDevices = { getUserMedia: async () => fakeStream() }
    const { api } = harness()
    api.videoRef.value = { ...fakeVideo(), play: () => new Promise(() => {}) }

    await api.start()

    expect(api.status.value).toBe('scanning')
  })

  it('falls back to the bundled decoder when the native one never answers', async () => {
    // The third way this screen could hang. On Android the native decoder is
    // backed by a Play Services module, and asking it which formats it supports
    // can sit unresolved while that module downloads — no error, no answer.
    // Awaited plainly it would hold the screen on "starting the camera" with
    // nothing to time out against, so it is raced and the WASM decoder — which
    // ships inside the app and needs nobody — takes over.
    globalThis.BarcodeDetector = class {
      static getSupportedFormats() {
        return new Promise(() => {})
      }
      async detect() {
        return detected
      }
    }
    navigator.mediaDevices = { getUserMedia: async () => fakeStream() }
    const { api } = harness()

    const starting = api.start()
    await vi.advanceTimersByTimeAsync(6000)
    await starting

    expect(api.status.value).toBe('scanning')
  })

  // The one that shipped broken. HomeView renders the scanner under a v-if that
  // flips in the same tick as `open`, so the component MOUNTS already open and
  // `open` never changes afterwards. A plain watcher on it never ran, so the
  // camera was never asked for — no permission prompt on the phone, ever, and a
  // screen that sat on "starting the camera" with nothing in flight to time out.
  //
  // Mounted here the way HomeView mounts it, rather than through the composable,
  // because the composable was never the part that was wrong.
  it('asks for the camera when it is mounted already open', async () => {
    // A real MediaStream, not the plain stub the other tests use: this one
    // reaches an actual <video>, and srcObject rejects anything else. happy-dom
    // does not give it getTracks, which teardown calls, so that part is stubbed.
    const stream = Object.assign(new window.MediaStream(), { getTracks: () => [] })
    const getUserMedia = vi.fn(async () => stream)
    navigator.mediaDevices = { getUserMedia }

    const wrapper = mount(BarcodeScannerModal, { props: { open: true } })
    await flushPromises()

    expect(getUserMedia).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('opens without focusing the way out', async () => {
    // AppModal used to focus the first control in a dialog, which here is Back —
    // so the scanner arrived with the exit looking pressed-ready and Enter wired
    // to close a screen just opened. Nothing is focused now.
    const stream = Object.assign(new window.MediaStream(), { getTracks: () => [] })
    navigator.mediaDevices = { getUserMedia: async () => stream }

    const wrapper = mount(BarcodeScannerModal, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    expect(document.activeElement).not.toBe(wrapper.find('.back-btn').element)
    expect(wrapper.find('.scanner').element.contains(document.activeElement)).toBe(false)
    wrapper.unmount()
  })

  it('tells a refusal apart from a missing camera', async () => {
    navigator.mediaDevices = {
      getUserMedia: async () => {
        throw Object.assign(new Error('no'), { name: 'NotAllowedError' })
      },
    }
    const { api } = harness()

    await api.start()

    // Denied is worth a retry button; unavailable is not, and offering one that
    // can never work is worse than saying so.
    expect(api.status.value).toBe('denied')
  })

  it('reports a device with no camera as unavailable', async () => {
    navigator.mediaDevices = {
      getUserMedia: async () => {
        throw Object.assign(new Error('none'), { name: 'NotFoundError' })
      },
    }
    const { api } = harness()

    await api.start()

    expect(api.status.value).toBe('unavailable')
  })

  it('reads a barcode once, however long it sits in front of the camera', async () => {
    navigator.mediaDevices = { getUserMedia: async () => fakeStream() }
    const seen = []
    const { api } = harness((code) => seen.push(code))
    await api.start()

    detected = [{ rawValue: '5941234567890' }]
    // Several loop ticks with the same package in shot — which is what actually
    // happens between reading a code and moving the phone away.
    for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(250)

    expect(seen).toEqual(['5941234567890'])
  })

  it('ignores anything the catalog could not be holding', async () => {
    navigator.mediaDevices = { getUserMedia: async () => fakeStream() }
    const seen = []
    const { api } = harness((code) => seen.push(code))
    await api.start()

    // A QR code on a shelf label decodes perfectly and is not a product.
    detected = [{ rawValue: 'https://example.com' }]
    await vi.advanceTimersByTimeAsync(250)

    expect(seen).toEqual([])
  })

  it('stops reading while it is paused', async () => {
    navigator.mediaDevices = { getUserMedia: async () => fakeStream() }
    const seen = []
    const { api } = harness((code) => seen.push(code))
    await api.start()

    api.paused.value = true
    detected = [{ rawValue: '5941234567890' }]
    await vi.advanceTimersByTimeAsync(500)

    // One code must not start a second lookup on top of its own.
    expect(seen).toEqual([])
  })

  it('reads nothing at all once stopped', async () => {
    navigator.mediaDevices = { getUserMedia: async () => fakeStream() }
    const seen = []
    const { api } = harness((code) => seen.push(code))
    await api.start()
    api.stop()

    detected = [{ rawValue: '5941234567890' }]
    await vi.advanceTimersByTimeAsync(1000)

    expect(seen).toEqual([])
  })
})
