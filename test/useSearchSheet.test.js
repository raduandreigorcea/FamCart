// @vitest-environment happy-dom
//
// The add search as a bottom sheet: where it thinks the viewport is, and how it
// gets off the screen again.
//
// This had no test of its own, and it is the composable that most needed one.
// Everything in it is a workaround for something that differs between two
// platforms or two browser states, so nothing here fails in an obvious way — it
// fails as a sheet rendered under the keyboard on one phone, or as a panel that
// never unmounts in a backgrounded tab. None of that is visible from the
// component tests that mount AddItemForm, because those run at a width where
// the sheet never opens.
//
// The four properties worth pinning, and why each one is a property rather than
// an implementation detail:
//
//   • The measurement is offsetTop + height, not innerHeight. Android resizes
//     the WebView and leaves offsetTop at 0; iOS does not resize and puts the
//     whole difference in offsetTop. Reading innerHeight is right on neither.
//   • The exit is on a TIMER, not on animationend. A backgrounded tab never
//     delivers animationend, and a sheet that never unmounts is worse than one
//     that unmounts a frame late.
//   • `expanded` goes false at the moment of dismissal, while `present` stays
//     true for the length of the exit. They answer different questions -- what
//     the user wants, and what is still drawn -- and the bar's centre button
//     reads the first.
//   • Teardown has to cancel that timer. It is the one thing here that can
//     outlive the component.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { isSheetWidth, useSearchSheet } from '../src/lib/useSearchSheet'

// Comfortably past the 400ms EXIT_TIMEOUT_MS the composable settles on.
const PAST_EXIT_MS = 500

// What matchMedia answers, per query, for the duration of one test.
let media = { sheet: true, reducedMotion: false }

function installMatchMedia() {
  window.matchMedia = (query) => ({
    matches: query.includes('prefers-reduced-motion') ? media.reducedMotion : media.sheet,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })
}

// A stand-in visual viewport, with the listener bookkeeping visible so a test
// can both drive it and check it was let go of.
function installVisualViewport({ offsetTop = 0, height = 800 } = {}) {
  const listeners = new Map()
  const vv = {
    offsetTop,
    height,
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
    },
    removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
    // Test-side helpers, not part of the real API.
    _count: (type) => listeners.get(type)?.size ?? 0,
    _emit: (type) => listeners.get(type)?.forEach((fn) => fn()),
  }
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true, writable: true })
  return vv
}

function removeVisualViewport() {
  Object.defineProperty(window, 'visualViewport', {
    value: null,
    configurable: true,
    writable: true,
  })
}

// The composable registers onBeforeUnmount, so it needs a real component to
// hang off — and unmounting one is half of what is being tested.
function mountSheet({ startOpen = false } = {}) {
  let api
  const Host = defineComponent({
    setup() {
      const expanded = ref(startOpen)
      api = { ...useSearchSheet({ expanded }), expanded }
      return () => null
    },
  })
  const wrapper = mount(Host)
  return { wrapper, api }
}

beforeEach(() => {
  vi.useFakeTimers()
  media = { sheet: true, reducedMotion: false }
  installMatchMedia()
  installVisualViewport()
})

afterEach(() => {
  vi.useRealTimers()
  removeVisualViewport()
})

describe('isSheetWidth', () => {
  it('is the 900px boundary the bar hands over at', () => {
    expect(isSheetWidth()).toBe(true)
    media.sheet = false
    expect(isSheetWidth()).toBe(false)
  })
})

describe('measuring the visual viewport', () => {
  // The iOS shape: the WebView does not resize, so the keyboard's height shows
  // up as an offset rather than as a smaller viewport. A sheet positioned from
  // innerHeight here runs underneath the keyboard.
  it('takes the offset into account rather than reading innerHeight', () => {
    installVisualViewport({ offsetTop: 120, height: 560 })
    const { api } = mountSheet({ startOpen: true })
    expect(api.screenBox.value).toEqual({ top: '120px', height: '560px' })
  })

  // The Android shape: the WebView resizes and the offset stays at zero.
  it('handles a viewport that resized instead of offsetting', () => {
    installVisualViewport({ offsetTop: 0, height: 430 })
    const { api } = mountSheet({ startOpen: true })
    expect(api.screenBox.value).toEqual({ top: '0px', height: '430px' })
  })

  it('rounds, so the box is never a fractional pixel', () => {
    installVisualViewport({ offsetTop: 12.4, height: 559.6 })
    const { api } = mountSheet({ startOpen: true })
    expect(api.screenBox.value).toEqual({ top: '12px', height: '560px' })
  })

  // Desktop Safari before 15.4, and any environment without the API. The sheet
  // does not open at these widths in practice, but falling back to innerHeight
  // is the difference between a full-height panel and one with no height at all.
  it('falls back to innerHeight where there is no visual viewport', () => {
    removeVisualViewport()
    window.innerHeight = 900
    const { api } = mountSheet({ startOpen: true })
    expect(api.screenBox.value).toEqual({ top: '0px', height: '900px' })
  })

  // The keyboard coming up is a resize, not a re-open, so nothing else fires.
  it('re-measures when the keyboard moves the viewport', () => {
    const vv = installVisualViewport({ offsetTop: 0, height: 800 })
    const { api } = mountSheet({ startOpen: true })
    expect(api.screenBox.value.height).toBe('800px')

    vv.offsetTop = 260
    vv.height = 540
    vv._emit('resize')
    expect(api.screenBox.value).toEqual({ top: '260px', height: '540px' })

    vv.offsetTop = 0
    vv.height = 800
    vv._emit('scroll')
    expect(api.screenBox.value).toEqual({ top: '0px', height: '800px' })
  })

  it('stops listening to the viewport once the sheet is gone', () => {
    const vv = installVisualViewport()
    const { api } = mountSheet({ startOpen: true })
    expect(vv._count('resize')).toBe(1)
    expect(vv._count('scroll')).toBe(1)

    api.collapse()
    vi.advanceTimersByTime(PAST_EXIT_MS)
    expect(vv._count('resize')).toBe(0)
    expect(vv._count('scroll')).toBe(0)
  })
})

describe('opening and closing', () => {
  // `present` is a computed and answers in the same tick; the measurement is a
  // watcher on `expanded` and lands on the next one. That gap is why
  // AddItemForm focuses the field inside nextTick rather than straight after
  // setting the model -- focusing an element with no layout is what iOS answers
  // by declining to raise the keyboard at all.
  it('is not present until it is expanded', async () => {
    const { api } = mountSheet()
    expect(api.present.value).toBe(false)
    expect(api.screenBox.value).toBeNull()

    api.expand()
    expect(api.expanded.value).toBe(true)
    expect(api.present.value).toBe(true)

    await nextTick()
    expect(api.screenBox.value).not.toBeNull()
  })

  // The two answer different questions. `expanded` is "does the user want the
  // search open", and they have just said no — held true for the length of the
  // exit, the bar's centre button could not raise the sheet again until the
  // travel finished.
  it('stops being expanded at the dismissal and stays drawn through the exit', () => {
    const { api } = mountSheet({ startOpen: true })

    api.collapse()
    expect(api.expanded.value).toBe(false)
    expect(api.closing.value).toBe(true)
    expect(api.present.value).toBe(true)

    vi.advanceTimersByTime(PAST_EXIT_MS)
    expect(api.closing.value).toBe(false)
    expect(api.present.value).toBe(false)
    expect(api.screenBox.value).toBeNull()
  })

  // animationend would be tighter and is the wrong event: a backgrounded tab
  // never delivers it, and the sheet would stay mounted over the list forever.
  it('takes the sheet down on a timer rather than waiting for an event', () => {
    const { api } = mountSheet({ startOpen: true })
    api.collapse()

    // Still drawn a moment later — this is the travel, not a stuck sheet.
    vi.advanceTimersByTime(100)
    expect(api.present.value).toBe(true)

    vi.advanceTimersByTime(PAST_EXIT_MS)
    expect(api.present.value).toBe(false)
  })

  it('skips the travel entirely when motion is reduced', () => {
    media.reducedMotion = true
    const { api } = mountSheet({ startOpen: true })

    api.collapse()
    // Gone in the same tick: no closing flag to drive an animation that is not
    // going to run.
    expect(api.closing.value).toBe(false)
    expect(api.present.value).toBe(false)
    expect(api.screenBox.value).toBeNull()
  })

  // Escape closes by blurring, so collapse arrives twice — once from the key and
  // once from the blur it caused. The second must not restart the exit.
  it('ignores a second dismissal', () => {
    const { api } = mountSheet({ startOpen: true })
    api.collapse()
    vi.advanceTimersByTime(200)

    api.collapse()
    // If the second call had restarted the timer, the sheet would still be here
    // 300ms later.
    vi.advanceTimersByTime(250)
    expect(api.present.value).toBe(false)
  })

  // Reachable from the item-limit popup: a dialog opened from the search hands
  // focus back to the field when it closes, and the tap that dismissed it has
  // already started the exit.
  it('reverses an exit that is still running', async () => {
    const { api } = mountSheet({ startOpen: true })
    api.collapse()
    // The tick matters and is not test scaffolding. Both calls ride the watcher
    // on `expanded`, and Vue compares against the value the watcher last SAW --
    // so a collapse and an expand inside one synchronous block would net out to
    // no change and fire nothing. They are never in one block: the exit runs
    // over 400ms, and the reopen is a later gesture (a dialog closing over the
    // search hands focus back to the field). Awaiting here is what makes the
    // test that sequence rather than a hypothetical one.
    await nextTick()
    vi.advanceTimersByTime(100)
    expect(api.closing.value).toBe(true)

    api.expand()
    expect(api.expanded.value).toBe(true)

    // The re-attach rides the same watcher as the first open, so it is a tick
    // behind the model -- and it is what cancels the exit timer.
    await nextTick()
    expect(api.closing.value).toBe(false)
    expect(api.screenBox.value).not.toBeNull()

    // And the exit timer that was already running must not take it down again.
    vi.advanceTimersByTime(PAST_EXIT_MS)
    expect(api.present.value).toBe(true)
  })

  // A rotation can cross the boundary with the search still open, and a phone's
  // sheet stretched across a desktop column is not a layout.
  it('settles at once when a rotation crosses out of sheet width', () => {
    const { api } = mountSheet({ startOpen: true })

    media.sheet = false
    window.dispatchEvent(new Event('resize'))

    expect(api.expanded.value).toBe(false)
    expect(api.present.value).toBe(false)
    expect(api.screenBox.value).toBeNull()
  })

  it('only re-measures on a resize that stays within sheet width', () => {
    const vv = installVisualViewport({ offsetTop: 0, height: 800 })
    const { api } = mountSheet({ startOpen: true })

    vv.height = 600
    window.dispatchEvent(new Event('resize'))
    expect(api.expanded.value).toBe(true)
    expect(api.screenBox.value).toEqual({ top: '0px', height: '600px' })
  })
})

describe('teardown', () => {
  // The exit timer is the one thing here that can outlive the component. Left
  // running, it fires settle() against refs nobody is rendering.
  it('cancels an exit still in flight when the view goes', () => {
    const { wrapper, api } = mountSheet({ startOpen: true })
    api.collapse()
    expect(api.closing.value).toBe(true)

    wrapper.unmount()
    // The assertion is that this does not throw and does not write: closing is
    // still true because settle() never ran, which is exactly right — the
    // component is gone and nothing is reading it.
    expect(() => vi.advanceTimersByTime(PAST_EXIT_MS)).not.toThrow()
    expect(api.closing.value).toBe(true)
  })

  it('lets go of the viewport listeners on unmount', () => {
    const vv = installVisualViewport()
    const { wrapper } = mountSheet({ startOpen: true })
    expect(vv._count('resize')).toBe(1)

    wrapper.unmount()
    expect(vv._count('resize')).toBe(0)
    expect(vv._count('scroll')).toBe(0)
  })
})
