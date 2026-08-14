import { nextTick, onBeforeUnmount, ref, type Ref } from 'vue'

// The add form becoming a screen, on a phone.
//
// On a phone the suggestions dropdown has nowhere to go: 72px of fixed topbar
// above it and the keyboard below leave it a 275px slot in the middle of an
// empty screen. Focusing the input turns the whole thing into a screen instead —
// the field rises into a header band at the top edge and the matches run edge to
// edge beneath it, on one surface, down to wherever the keyboard starts.
//
// Only the field travels; the band, the results and the way out fade in around
// it. It is the one thing the user touched, so it is the one thing that should
// not blink out and reappear somewhere else.
//
// Extracted from AddItemForm, where it was the largest of that component's four
// jobs and the one least related to the others: everything here is measurement
// and transition timing, and none of it knows what a product is. It is also the
// part most likely to need changing for a new device or WebView, which is a poor
// argument for it living inside a 1,300-line component.

// The same boundary PopoverMenu uses to pick sheet over popover. Above it
// nothing here applies and the form stays in the flow.
const PHONE_QUERY = '(max-width: 599.98px)'
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

// How long the form is allowed to be mid-slide before we tidy up regardless.
// Comfortably past --transition-base, so it only ever fires when the
// transitionend was swallowed rather than racing a real one.
const SLIDE_TIMEOUT_MS = 400

export function mediaMatches(query: string): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(query).matches
  )
}

/** Whether the viewport is narrow enough for the form to become a screen. */
export function isPhoneWidth(): boolean {
  return mediaMatches(PHONE_QUERY)
}

export interface PhoneSearchScreen {
  /** Frozen height for the slot, so the list below does not jump up. */
  slotStyle: Ref<Record<string, string> | null>
  /** The band's box, measured from the visual viewport. */
  screenBox: Ref<Record<string, string> | null>
  /** True while the field is travelling back down. */
  closing: Ref<boolean>
  expand: () => Promise<void>
  collapse: () => void
}

export function usePhoneSearchScreen(options: {
  /** The caller's expanded model — owned there because the parent reads it too. */
  expanded: Ref<boolean>
  // The two template refs, declared by the component rather than here. They
  // belong to its markup, and a string `ref="slotRef"` only resolves against a
  // directly-declared const — a binding destructured out of this function is not
  // one, so vue-tsc reports it unused and the element never populates it.
  /** Holds the form's place in the flow while it is lifted. */
  slotRef: Ref<HTMLElement | null>
  /** The row that actually travels. */
  rowRef: Ref<HTMLElement | null>
}): PhoneSearchScreen {
  const { expanded, slotRef, rowRef } = options

  const slotStyle = ref<Record<string, string> | null>(null)
  const screenBox = ref<Record<string, string> | null>(null)
  const closing = ref(false)

  let slideTimer: ReturnType<typeof setTimeout> | null = null

  // offsetTop + height is the visual viewport in layout coordinates, which is
  // what makes this right both on Android (the WebView resizes, offsetTop stays
  // 0) and on iOS (it does not resize, and offsetTop carries the difference).
  function measureScreen(): void {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) {
      screenBox.value =
        typeof window !== 'undefined' ? { top: '0px', height: `${window.innerHeight}px` } : null
      return
    }
    screenBox.value = {
      top: `${Math.round(vv.offsetTop)}px`,
      height: `${Math.round(vv.height)}px`,
    }
  }

  // A rotation can cross out of phone width with the screen still open, and a
  // phone's search screen stretched across a desktop column is not a layout.
  function onResize(): void {
    if (!expanded.value) return
    if (!isPhoneWidth()) collapse()
    else measureScreen()
  }

  function bindViewportListeners(on: boolean): void {
    if (typeof window === 'undefined') return
    const method = on ? 'addEventListener' : ('removeEventListener' as const)
    window[method]('resize', onResize)
    window.visualViewport?.[method]('resize', measureScreen)
    window.visualViewport?.[method]('scroll', measureScreen)
  }

  // Move the field back to where it just was, with transitions off, then release
  // it: the browser animates the release rather than the jump. Without silencing
  // the transition first, this inverting step would itself animate — the wrong
  // way, at the wrong time.
  function slideFrom(startTop: number): void {
    const row = rowRef.value
    if (!row) return
    const delta = Math.round(startTop - row.getBoundingClientRect().top)
    if (!delta || mediaMatches(REDUCED_MOTION_QUERY)) return
    row.style.transition = 'none'
    row.style.transform = `translateY(${delta}px)`
    void row.offsetHeight
    row.style.transition = ''
    row.style.transform = ''
  }

  async function expand(): Promise<void> {
    const slot = slotRef.value
    if (!slot || expanded.value) return

    clearSlideTimer()
    const from = slot.getBoundingClientRect()
    slotStyle.value = { height: `${from.height}px` }
    measureScreen()
    closing.value = false
    expanded.value = true

    // The band's back row pushes the field down as it mounts, so the landing
    // spot is only knowable once the screen has rendered.
    await nextTick()
    slideFrom(from.top)
    bindViewportListeners(true)
  }

  function collapse(): void {
    const slot = slotRef.value
    const row = rowRef.value
    // Escape closes by blurring, so this arrives twice: once from the key and
    // once from the blur it caused. The second must not restart the slide.
    if (!expanded.value || slideTimer) return
    bindViewportListeners(false)

    // The slot never left the flow, so its rect is the destination. Measured
    // before `closing` changes anything, though nothing it fades takes the field
    // out of the flow.
    if (!slot || !row) {
      settle()
      return
    }
    const delta = Math.round(slot.getBoundingClientRect().top - row.getBoundingClientRect().top)
    if (!delta || mediaMatches(REDUCED_MOTION_QUERY)) {
      settle()
      return
    }
    closing.value = true

    row.addEventListener('transitionend', onSlideEnd)
    slideTimer = setTimeout(settle, SLIDE_TIMEOUT_MS)
    // Leaving, not arriving: --ease-rise decelerates into its destination, which
    // on the way back down is the shape of a swiped row snapping into place. The
    // fall curve at the cover's own duration reads as getting out of the way
    // instead, and brings the field and the list back together. Inline rather
    // than a class so it takes effect in the same recalc as the transform below.
    row.style.transition = `border-color var(--transition-fast), transform var(--transition-fast) var(--ease-fall)`
    row.style.transform = `translateY(${delta}px)`
  }

  // .add-row transitions its border colour on focus too, on this very element —
  // only the transform means the slide is over.
  function onSlideEnd(event: TransitionEvent): void {
    if (event.target !== rowRef.value || event.propertyName !== 'transform') return
    settle()
  }

  function clearSlideTimer(): void {
    if (slideTimer) clearTimeout(slideTimer)
    slideTimer = null
  }

  async function settle(): Promise<void> {
    clearSlideTimer()
    const row = rowRef.value
    if (row) {
      row.removeEventListener('transitionend', onSlideEnd)
      // Silenced first: the offset is dropped while the screen is still open and
      // the field still carries a transform transition, so clearing it live would
      // animate the field back up to the top it just came down from.
      row.style.transition = 'none'
      row.style.transform = ''
    }
    expanded.value = false
    closing.value = false
    slotStyle.value = null
    screenBox.value = null

    await nextTick()
    if (rowRef.value) rowRef.value.style.transition = ''
  }

  onBeforeUnmount(() => {
    clearSlideTimer()
    bindViewportListeners(false)
    rowRef.value?.removeEventListener('transitionend', onSlideEnd)
  })

  return { slotStyle, screenBox, closing, expand, collapse }
}
