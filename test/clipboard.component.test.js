// @vitest-environment happy-dom
//
// The clipboard write and the "Copied" state that follows it.
//
// This is the whole of what OverviewPanel does — the rest of that panel is
// read-only — and it is shared with OnboardingTour and lib/inviteShare. It was
// three separate copies before it was one, and the copies had already drifted:
// two hold durations, only one clearing its timer, and a stacking bug where a
// second tap's confirmation could be cancelled by the first tap's expiry.
//
// So the tests worth having are about the timer rather than about the write.
// Mounted rather than called directly because onBeforeUnmount needs a component
// instance, and the unmount path is one of the two things that regressed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { copyText, useCopyFeedback } from '../src/lib/clipboard'

// A harness whose only job is to give the composable a lifecycle to hang off.
const Harness = defineComponent({
  props: { holdMs: { type: Number, default: 2000 } },
  setup(props) {
    const { copied, copy } = useCopyFeedback(props.holdMs)
    return { copied, copy }
  },
  render() {
    return h('div')
  },
})

let writeText

beforeEach(() => {
  vi.useFakeTimers()
  writeText = vi.fn(async () => {})
  // happy-dom ships no clipboard, and jsdom's is read-only, so define it.
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('copyText', () => {
  it('reports success when the write lands', async () => {
    await expect(copyText('ABCD2345')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('ABCD2345')
  })

  // A refusal is ordinary: a non-secure context, a denied permission, an older
  // WebView. Every caller's answer is the same — leave the code on screen to be
  // read — so this reports rather than throws.
  it('reports failure rather than throwing when the browser refuses', async () => {
    writeText.mockRejectedValueOnce(new Error('NotAllowedError'))
    await expect(copyText('ABCD2345')).resolves.toBe(false)
  })
})

describe('useCopyFeedback', () => {
  it('lights the confirmation and drops it after the hold', async () => {
    const wrapper = mount(Harness)

    await wrapper.vm.copy('ABCD2345')
    expect(wrapper.vm.copied).toBe(true)

    vi.advanceTimersByTime(1999)
    expect(wrapper.vm.copied).toBe(true)
    vi.advanceTimersByTime(1)
    expect(wrapper.vm.copied).toBe(false)

    wrapper.unmount()
  })

  // The stacking bug, pinned. Two taps 100ms apart used to queue two timers
  // against one boolean, and the first one's expiry turned the second tap's
  // confirmation off early.
  it('restarts the hold on a second copy rather than stacking timers', async () => {
    const wrapper = mount(Harness)

    await wrapper.vm.copy('ABCD2345')
    vi.advanceTimersByTime(1900)
    await wrapper.vm.copy('ABCD2345')

    // The first tap's timer would have fired here. It was cleared.
    vi.advanceTimersByTime(100)
    expect(wrapper.vm.copied).toBe(true)

    // And the second tap gets its own full hold.
    vi.advanceTimersByTime(1900)
    expect(wrapper.vm.copied).toBe(false)

    wrapper.unmount()
  })

  it('does not light the confirmation when the copy failed', async () => {
    writeText.mockRejectedValueOnce(new Error('NotAllowedError'))
    const wrapper = mount(Harness)

    await expect(wrapper.vm.copy('ABCD2345')).resolves.toBe(false)
    expect(wrapper.vm.copied).toBe(false)

    wrapper.unmount()
  })

  it('does not reach for the clipboard with nothing to copy', async () => {
    const wrapper = mount(Harness)

    await expect(wrapper.vm.copy('')).resolves.toBe(false)
    expect(writeText).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  // A dialog closed mid-hold used to leave a callback running against a
  // component that no longer existed.
  it('clears its timer on unmount', async () => {
    const wrapper = mount(Harness)
    await wrapper.vm.copy('ABCD2345')

    wrapper.unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
