<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type PropType } from 'vue'
import { closeModal, openModal } from '../lib/modalStack'
import { getProductEmoji } from '../lib/productEmoji'
import BackButton from './BackButton.vue'
import SkeletonBlock from './SkeletonBlock.vue'
import checkIcon from '../assets/check.svg?raw'
import scanBarcodeIcon from '../assets/scan-barcode.svg?raw'
import { productKey, type ProductSuggestion } from '../lib/productSearch'

// Phone search mode: the same boundary PopoverMenu uses to pick sheet over
// popover. Above it nothing below changes and the form stays in the flow.
const PHONE_QUERY = '(max-width: 599.98px)'
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

const mediaMatches = (query: string) =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia(query).matches

// How long the form is allowed to be mid-slide before we tidy up regardless.
// Comfortably past --transition-base, so it only ever fires when the
// transitionend was swallowed rather than racing a real one.
const SLIDE_TIMEOUT_MS = 400

// Presentational: the typed name lives in the parent (via v-model) so the add
// flow can restore it when an optimistic insert fails. The suggestions list is
// likewise owned by the parent (it queries the product catalog); this component
// only renders it and reports the pick.
//
// There is no quantity here any more. A stepper used to sit at the head of this
// row, which asked how many before anything had said of what, reset itself after
// every add, and spent the width that made the row need one button for two jobs.
// It is on the list row now, where the product it counts exists and can still be
// corrected. Adding is one tap; adding the same thing twice sums, as it always
// has.
const name = defineModel('name', { type: String, default: '' })
// Whether the form is currently lifted to the top of a phone screen. Exposed
// because the parent widens the search while it is: the panel has room for
// twice the rows, so capping the query at six would waste it.
const expanded = defineModel('expanded', { type: Boolean, default: false })

const props = defineProps({
  adding: { type: Boolean, default: false },
  maxLength: { type: Number, default: 120 },
  // Product catalog matches for the current input: [{ name, maker }].
  suggestions: { type: Array as PropType<ProductSuggestion[]>, default: () => [] },
  // What this household buys most, same shape as suggestions. Shown on the phone
  // search screen before anything is typed; ignored everywhere else, where
  // there is no screen to fill.
  recents: { type: Array as PropType<ProductSuggestion[]>, default: () => [] },
  // The product that just landed on the list, as a fresh object each time so
  // adding the same thing twice still reads as two adds. Only the search screen
  // shows it: everywhere else the list is right there and the row arriving in
  // it is the confirmation.
  lastAdded: {
    type: Object as PropType<{ name: string; maker: string | null } | null>,
    default: null,
  },
  // A search is running (or debouncing) for what is currently typed, so the
  // matches below are not the answer yet.
  suggestionsLoading: { type: Boolean, default: false },
  // Whether to offer the "add your own" escape hatch. Owned by the parent,
  // which knows when the query is long enough to have been searched for.
  canAddCustom: { type: Boolean, default: false },
  // Whether this device can scan at all — a camera it can reach, and something
  // that can decode. Asked once by the parent; a browser that cannot scan is
  // never offered the button rather than being offered one that fails.
  canScan: { type: Boolean, default: false },
})

// Uneven widths so the placeholder reads as products rather than a bar chart.
const skeletonWidths = ['58%', '41%', '66%']

const emit = defineEmits(['submit', 'select', 'add-custom', 'scan'])

// ─── The button at the end of the row ────────────────────────────────────────
// With nothing typed there is nothing to add, so the add button spends most of
// its life disabled — which is most of the time the form is on screen at all,
// since an empty field is what you come back to after every add. That dead state
// is where scanning goes: same button, same place, no extra control on a row
// that has no width to spare. The first keystroke hands it back to Add, which is
// the action that has become available.
const showScan = computed(() => props.canScan && !name.value.trim())

function onAction() {
  // Not a scan means this is the submit button, and the form's own submit
  // handler is already on its way. Nothing to do here.
  if (!showScan.value) return
  // Hand the screen over rather than stacking a camera on top of a search. The
  // collapse runs behind the dialog that is about to cover it, so the only thing
  // the user sees is the scanner arriving — and the way back is the list, which
  // is where the scanned items are.
  close()
  emit('scan')
}

// The dropdown shows only while the input has focus; mousedown.prevent on the
// options keeps focus in the input, so picking one never races the blur.
const inputFocused = ref(false)

const slotRef = ref<HTMLElement | null>(null)
const rowRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)

// Freezes the gap the form leaves behind once it goes fixed, so the list below
// does not jump up to meet it.
const slotStyle = ref<Record<string, string> | null>(null)
// The screen the search fills: the visual viewport, so it ends where the
// keyboard starts. Null until measured — the stylesheet's 100dvh covers that
// frame.
const screenBox = ref<Record<string, string> | null>(null)
// The field is on its way back down. Everything in the band that is not the
// field fades over exactly that journey, so the screen is empty by the time it
// lands rather than resolving in pieces afterwards.
const closing = ref(false)

let slideTimer: ReturnType<typeof setTimeout> | null = null

// ─── Counting the taps out loud ──────────────────────────────────────────────
// Tapping a row again adds another of that product (the merge sums them), and
// the row's flash says a tap landed but not how many. So from the second tap on,
// the running count flies off the spot that was pressed: x2, x3, x4.
//
// They are thrown in scattered directions on purpose. Three tidy badges stacking
// in the same place would read as one badge being replaced, which is the thing
// the count is there to disprove -- and the third one has to look different from
// the second or the tap did not visibly do anything.

// Long enough to read, short enough to be gone before the next tap needs the
// space. Mirrors the pop-drift animation below.
const POP_MS = 900

interface TapPop {
  id: number
  x: number
  y: number
  label: string
  dx: number
  dy: number
  rot: number
}

const pops = ref<TapPop[]>([])
const wrapRef = ref<HTMLElement | null>(null)
// Taps per product, for as long as this panel has been open.
const tapCounts = ref<Map<string, number>>(new Map())
let popId = 0

function throwPop(event: MouseEvent, label: string) {
  const wrap = wrapRef.value
  if (!wrap) return
  const rect = wrap.getBoundingClientRect()
  // A wide fan, biased upward: a counter that drifts down goes straight under
  // the finger that just pressed there, which is the one place it cannot be read.
  const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.6
  const distance = 34 + Math.random() * 26
  const id = ++popId

  pops.value = [
    ...pops.value,
    {
      id,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      label,
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance,
      rot: (Math.random() - 0.5) * 34,
    },
  ]

  setTimeout(() => {
    pops.value = pops.value.filter((pop) => pop.id !== id)
  }, POP_MS)
}

function selectSuggestion(product: ProductSuggestion, event?: MouseEvent) {
  const key = productKey(product.name, product.maker)
  const count = (tapCounts.value.get(key) ?? 0) + 1
  tapCounts.value = new Map(tapCounts.value).set(key, count)
  // Nothing on the first: one tap is one item, and the row's own flash and tick
  // already say it landed. The count only becomes news once there is more than
  // one of something.
  if (count > 1 && event) throwPop(event, `x${count}`)
  emit('select', product)
}

// Before anything is typed the screen shows what this household buys, so the
// common case — the same bread as last week — is one tap and no typing. Once
// there is a query it is the matches' screen, and these step aside.
const showingRecents = computed(
  () => expanded.value && !name.value.trim() && props.recents.length > 0,
)

const rows = computed(() => (showingRecents.value ? props.recents : props.suggestions))

// There is something to say when a search is running, when it found something,
// or when the escape hatch is on offer. Lifted, the results are the screen's
// body rather than a dropdown, so they stay mounted either way — including
// empty, in the keystroke between a query starting and its skeleton.
const hasResults = computed(
  () => props.suggestionsLoading || rows.value.length > 0 || props.canAddCustom,
)
const panelOpen = computed(() => inputFocused.value && (expanded.value || hasResults.value))

// A household with no history yet gets a line telling them what to do rather than
// a blank screen. Only on an empty query: telling someone who has typed a
// character to type a product name is worse than saying nothing, and that
// single keystroke before the search starts is the only other time this would
// come up.
const showingHint = computed(
  () =>
    expanded.value &&
    !name.value.trim() &&
    !props.suggestionsLoading &&
    !rows.value.length &&
    !props.canAddCustom,
)

// ─── Confirming the add ──────────────────────────────────────────────────────
// Picking a product adds it and hands the screen straight back, ready for the
// next item — which on the search screen means the tap has no visible result at
// all, because the list it landed on is the thing this screen is covering.
//
// The answer is on the row that was tapped. It is still on screen: a pick no
// longer clears the query, so the matches it came from are all still there. The
// mark stays for as long as the panel is open rather than timing out, so the
// results double as a record of what this search has already contributed — which
// is the question you actually have on the third pass through "milk".
//
// Tapping an already-marked row still adds again; the merge sums it. The mark
// says "this is on the list", not "this is spent".

// How long the tapped row stays lit. Only the highlight is timed; the tick it
// leaves behind is not.
const ADDED_VISIBLE_MS = 2400

const justAdded = ref<{ name: string; maker: string | null } | null>(null)
let addedTimer: ReturnType<typeof setTimeout> | null = null

// Every product added while this panel has been open, by productKey.
const addedKeys = ref<Set<string>>(new Set())

const justAddedKey = computed(() =>
  justAdded.value ? productKey(justAdded.value.name, justAdded.value.maker) : '',
)

// Which of the two identical flash classes is in play. Tapping the same row
// again has to flash it again -- that is how you see the third one land -- but
// the row is already wearing the class, so nothing changes in the DOM and a CSS
// animation only restarts when its declaration does. Alternating between two
// rules that differ in name and nothing else is what forces that: one class
// comes off, the other goes on, and the browser starts the animation over.
const litPhase = ref(0)

const isAdded = (product: ProductSuggestion) =>
  addedKeys.value.has(productKey(product.name, product.maker))

// The key of the most recent add, kept past the highlight's timer so a late
// failure still knows which mark to take back.
const lastAddedKey = ref('')

watch(
  () => props.lastAdded,
  (product) => {
    if (addedTimer) clearTimeout(addedTimer)
    if (!product) {
      // The parent only clears this when the add did not land after all (see
      // clearLastAdded, "it did not land"). The mark has to come off with it, or
      // a failed add leaves a product ticked as on a list it never reached.
      justAdded.value = null
      if (lastAddedKey.value) {
        const next = new Set(addedKeys.value)
        next.delete(lastAddedKey.value)
        addedKeys.value = next
        lastAddedKey.value = ''
      }
      return
    }
    justAdded.value = product
    lastAddedKey.value = productKey(product.name, product.maker)
    litPhase.value = litPhase.value === 0 ? 1 : 0
    // Replaced rather than mutated: a Set added to in place is the same object,
    // so the rows would not re-render and the tick would not appear until
    // something else happened to redraw them.
    addedKeys.value = new Set(addedKeys.value).add(productKey(product.name, product.maker))
    addedTimer = setTimeout(() => {
      justAdded.value = null
      addedTimer = null
    }, ADDED_VISIBLE_MS)
  },
)

// The record is of this visit to the search, not of the session. Leaving the
// panel and coming back should not show ticks against a trip already finished.
watch(panelOpen, (open) => {
  if (!open) {
    addedKeys.value = new Set()
    tapCounts.value = new Map()
  }
})

// ─── Phone search mode ───────────────────────────────────────────────────────
// On a phone the dropdown has nowhere to go: 72px of fixed topbar above it and
// the keyboard below leave it a 275px slot in the middle of an empty screen.
// Focusing the input turns the whole thing into a screen instead — the field
// rises into a header band at the top edge and the matches run edge to edge
// beneath it, on one surface, down to wherever the keyboard starts.
//
// Only the field travels; the band, the results and the way out fade in around
// it. It is the one thing the user touched, so it is the one thing that should
// not blink out and reappear somewhere else.

// offsetTop + height is the visual viewport in layout coordinates, which is
// what makes this right both on Android (the WebView resizes, offsetTop stays
// 0) and on iOS (it does not resize, and offsetTop carries the difference).
function measureScreen() {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null
  if (!vv) {
    screenBox.value = typeof window !== 'undefined' ? { top: '0px', height: `${window.innerHeight}px` } : null
    return
  }
  screenBox.value = { top: `${Math.round(vv.offsetTop)}px`, height: `${Math.round(vv.height)}px` }
}

// A rotation can cross out of phone width with the screen still open, and a
// phone's search screen stretched across a desktop column is not a layout.
function onResize() {
  if (!expanded.value) return
  if (!mediaMatches(PHONE_QUERY)) collapse()
  else measureScreen()
}

function bindViewportListeners(on: boolean) {
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
function slideFrom(startTop: number) {
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

async function expand() {
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

function collapse() {
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
function onSlideEnd(event: TransitionEvent) {
  if (event.target !== rowRef.value || event.propertyName !== 'transform') return
  settle()
}

function clearSlideTimer() {
  if (slideTimer) clearTimeout(slideTimer)
  slideTimer = null
}

async function settle() {
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

function onFocus() {
  inputFocused.value = true
  if (mediaMatches(PHONE_QUERY)) void expand()
}

// The one way out, whether it came from the cover, Escape or an ordinary
// blur. Blurring re-enters through @blur, which is why expand/collapse both
// no-op when there is nothing to do.
function close() {
  inputFocused.value = false
  inputRef.value?.blur()
  collapse()
}

// ─── Android's Back button ───────────────────────────────────────────────────
// This form's place in the layer stack, joined for the same reason PopoverMenu
// joins it: on a phone a focused field is not a field, it is a screen covering
// the list, and Back has to mean "put that away". Without this the press fell
// through an empty stack to Home's root-route case and exited the app with the
// search still up — losing whatever had been typed, which is the one thing Back
// is never supposed to do.
//
// Keyed on focus rather than on `expanded`, because the lift is phone-only: on a
// wider screen the field takes focus without becoming a screen, and Back should
// still hand the focus back rather than quit. close() no-ops on the half that
// does not apply.
//
// It does not lock the page's scroll. Lifted, the form owns the viewport itself
// and its cover already swallows touch; collapsed, a text cursor is no reason to
// freeze the list.
const layer = Symbol('add-item-search')

watch(inputFocused, (focused) => {
  if (focused) openModal(layer, { close, locksScroll: false })
  else closeModal(layer)
})

onBeforeUnmount(() => {
  closeModal(layer)
  clearSlideTimer()
  if (addedTimer) clearTimeout(addedTimer)
  bindViewportListeners(false)
  rowRef.value?.removeEventListener('transitionend', onSlideEnd)
})

</script>

<template>
  <!-- Holds the form's place in the flow while it is lifted to the top of a
       phone screen; the height is frozen at that moment so nothing below moves. -->
  <div class="add-slot" ref="slotRef" :style="slotStyle">
    <Transition name="add-cover">
      <!-- mousedown, not click, for the same reason the options use it: the tap
           must not steal focus before we decide what to do with it. -->
      <div
        v-if="expanded"
        class="add-cover"
        @mousedown.prevent="close"
        @touchmove.prevent
      ></div>
    </Transition>

    <form
      class="add-form"
      :class="{ 'add-form--expanded': expanded, 'add-form--closing': closing }"
      :style="screenBox"
      @submit.prevent="emit('submit')"
    >
      <!-- Lifted, this is the header band: the field, and the one way out that
           the keyboard can never cover. Collapsed it draws nothing at all. -->
      <div class="add-head">
        <!-- No leave transition, deliberately. A fading element stays mounted,
             and by the time this one unmounts the band's padding is gone, so it
             would take ordinary layout above the field and shove the field —
             which has just landed — back down for the length of the fade. It
             fades on the way out via .add-form--closing instead, which leaves
             the layout alone, and is already invisible when it goes. -->
        <div v-if="expanded" class="add-head__bar">
          <!-- mousedown holds focus through the tap the way the option rows
               do; click is what a keyboard sends, and close() no-ops on the
               second call. -->
          <BackButton @mousedown.prevent="close" @click="close" />
        </div>

        <div class="add-row" ref="rowRef">
          <!-- The button uses mousedown.prevent for the same reason the option
               rows do: pressing it must not take focus off the input. Adding an
               item is the middle of the job, not the end of it, and losing focus
               here would drop the keyboard and put the search screen away
               mid-flow. -->
          <input
            v-model="name"
            ref="inputRef"
            type="text"
            placeholder="Add an item…"
            :maxlength="maxLength"
            autocomplete="off"
            @focus="onFocus"
            @blur="close"
            @keydown.esc="close"
          />
          <!-- One control, two jobs. type follows the job so Enter in the field
               still submits when there is something to add, and the scan state is
               never a submit button that would fire on it. -->
          <button
            :type="showScan ? 'button' : 'submit'"
            class="add-btn"
            @mousedown.prevent
            @click="onAction"
            :disabled="adding || (!showScan && !name.trim())"
            :aria-label="showScan ? 'Scan a barcode' : 'Add'"
          >
            <Transition name="btn-swap" mode="out-in">
              <span v-if="adding" key="busy" class="spinner"></span>
              <span
                v-else-if="showScan"
                key="scan"
                class="scan-icon"
                aria-hidden="true"
                v-html="scanBarcodeIcon"
              ></span>
              <span v-else key="add" class="add-icon"></span>
            </Transition>
          </button>
        </div>
      </div>

      <!-- Collapsed this is the dropdown, open only when there is something to
           say. Lifted it is the screen's body and stays mounted, because a
           screen with nothing under its header is still the screen.

           The fade is likewise for the dropdown, which appears and goes in
           place. Lifted, the results are a screen-tall surface hanging off a
           field that is itself moving, and fading them out means sweeping all
           of that down the page on the way out; cutting is quieter. -->
      <Transition name="suggest" :css="!expanded">
        <div v-if="panelOpen" ref="wrapRef" class="suggestions-wrap">
          <!-- Always mounted so a screen reader is already listening when the
               confirmation arrives; announcing depends on the region
               pre-existing, not on it appearing with the news.

               The add is confirmed on the row that was tapped, which is still
               sitting there now that a pick no longer clears the query. This
               used to be a band above the results restating the product, which
               said the same thing twice and said it away from the thing.

               The band was also the live region, so it stays as one -- announced
               and not drawn, because the visible half of its job now belongs to
               the row. -->
          <p class="added-announce" role="status" aria-live="polite">
            {{ justAdded ? `${justAdded.name} added to your list` : '' }}
          </p>

          <!-- Outside the listbox: a listbox exposes only its options, so a
               heading inside it would be dropped on the way to a screen reader.
               Out here it is ordinary text, and aria-label carries the name. -->
          <p v-if="showingRecents" class="suggestions-label">Buy again</p>

          <ul
            class="suggestions"
            role="listbox"
            :aria-label="showingRecents ? 'Products you buy often' : 'Product suggestions'"
            :aria-busy="suggestionsLoading"
          >
            <!-- While searching, the skeleton is all there is: the previous query's
                 matches are not this query's answers, and offering "Can't find it?"
                 before the search returns would be a lie. -->
            <template v-if="suggestionsLoading">
              <li v-for="(width, idx) in skeletonWidths" :key="`skeleton-${idx}`" class="suggestion-skeleton">
                <SkeletonBlock width="1.9rem" height="1.9rem" radius="0.6rem" />
                <span class="suggestion-skeleton__text">
                  <SkeletonBlock :width="width" height="0.8rem" />
                  <SkeletonBlock width="26%" height="0.6rem" />
                </span>
              </li>
            </template>

            <template v-else>
              <li v-for="product in rows" :key="productKey(product.name, product.maker)">
                <button
                  type="button"
                  class="suggestion"
                  :class="{
                    'suggestion--added': isAdded(product),
                    'suggestion--lit-a':
                      litPhase === 0 && productKey(product.name, product.maker) === justAddedKey,
                    'suggestion--lit-b':
                      litPhase === 1 && productKey(product.name, product.maker) === justAddedKey,
                  }"
                  role="option"
                  @mousedown.prevent="selectSuggestion(product, $event)"
                >
                  <span class="suggestion-emoji" aria-hidden="true">
                    {{ getProductEmoji(product.name, product.maker || '') }}
                    <!-- On the tile, the way the row on the list wears its own
                         mark. Rendering it only when added would pop the layout;
                         it scales in from nothing instead. -->
                    <span class="suggestion-tick" v-html="checkIcon"></span>
                  </span>
                  <span class="suggestion-text">
                    <span class="suggestion-name">{{ product.name }}</span>
                    <span v-if="product.maker" class="suggestion-maker">{{ product.maker }}</span>
                  </span>
                  <!-- The tick is decoration; this is what carries the state into
                       the option's accessible name. -->
                  <span v-if="isAdded(product)" class="added-announce">on your list</span>
                </button>
              </li>

              <li v-if="canAddCustom" class="suggestions-hatch">
                <button
                  type="button"
                  class="suggestion suggestion--custom"
                  @mousedown.prevent="emit('add-custom')"
                >
                  <span class="suggestion-emoji suggestion-emoji--custom" aria-hidden="true">
                    <span class="suggestion-icon"></span>
                  </span>
                  <span class="suggestion-text">
                    <span class="suggestion-name suggestion-name--custom">Can't find it?</span>
                    <span class="suggestion-maker suggestion-maker--custom">Add your own</span>
                  </span>
                </button>
              </li>
            </template>
          </ul>

          <!-- A household with nothing bought yet has no usuals to open on. An
               empty screen should say what to do with it. -->
          <p v-if="showingHint" class="suggestions-hint">Type a product name to search.</p>

          <!-- Last in the wrap and outside the scrolling results, so a counter
               thrown from the top row is not sliced off by the list's own edge.
               Decorative: the count it reports is already in the row's tick and
               in the announcement, so there is nothing here for a reader. -->
          <div class="pop-layer" aria-hidden="true">
            <span
              v-for="pop in pops"
              :key="pop.id"
              class="pop"
              :style="{
                left: `${pop.x}px`,
                top: `${pop.y}px`,
                '--pop-dx': `${pop.dx}px`,
                '--pop-dy': `${pop.dy}px`,
                '--pop-rot': `${pop.rot}deg`,
              }"
            >{{ pop.label }}</span>
          </div>
        </div>
      </Transition>
    </form>
  </div>
</template>

<style scoped>
/* Carries the margin the form used to, so that when the form goes fixed the
   slot's frozen height is exactly the space it vacated. */
.add-slot {
  position: relative;
  margin-bottom: 1.25rem;
}

.add-form {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

/* ─── Phone search screen ────────────────────────────────────────────────────
   The whole viewport, top-anchored, transparent: the surface underneath it is
   .add-cover. `top` and `height` arrive inline from the visual viewport, so the
   screen ends where the keyboard starts; 100dvh is only the frame before that
   measurement lands. */
.add-form--expanded {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 100dvh;
  z-index: 61;
  gap: 0;
}

/* The header band. Collapsed it draws nothing — no padding, no rule — so the
   field sits exactly where the flow puts it and the slot's frozen height is
   right. */
.add-head {
  display: flex;
  flex-direction: column;
}

.add-form--expanded .add-head {
  flex-shrink: 0;
  width: 100%;
  /* +2rem so the field inside spans the same box it did in the column: the
     gutter lives in this padding rather than in the max-width. */
  max-width: calc(480px + 2rem);
  margin-inline: auto;
  padding: calc(var(--safe-top) + 0.35rem) 1rem 0.7rem;
  /* On top of the button's own bottom padding: leaving the two edges nearly
     touching read as one control rather than a way out above a field. */
  gap: 0.5rem;
  border-bottom: var(--border-width-thin) solid var(--border-light);
}

/* The one exit the keyboard can never cover. Leading, because that is the shape
   a back affordance has everywhere else in the app; the negative margin pulls
   the button's own padding out so the arrow lines up with the gutter rather
   than sitting a few pixels inside it. */
.add-head__bar {
  display: flex;
  justify-content: flex-start;
  margin-left: -0.4rem;
}

/* Fades over exactly the field's journey home — same duration, same curve as
   the field's fall and the cover's — so the screen resolves in one moment
   rather than the field landing and something else finishing afterwards. It
   keeps its layout box the whole way, so nothing it does moves the field. */
.add-form--expanded .add-head__bar {
  transition: opacity var(--transition-fast) var(--ease-fall);
}

.add-form--closing .add-head__bar {
  opacity: 0;
}

/* Opaque, and in the surface colour rather than the page's: the results are the
   content now, and content sits on a surface everywhere else in the app. The
   page colour would say "you are still on the list", which is the lie that
   makes a half-dimmed list behind the matches feel wrong. Fading this in is
   what takes the list away, so it doubles as the dismissal target — above the
   buy bar (50) and the topbar (10), below the teleported menus (1000). */
.add-cover {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: var(--bg-surface);
}

.add-cover-enter-active {
  transition: opacity var(--transition-fast) var(--ease-standard);
}

/* The same duration AND the same curve as the field's fall (set inline in
   collapse()), so the list comes back at exactly the rate the field travels
   rather than being most of the way there while it is still barely moving. */
.add-cover-leave-active {
  transition: opacity var(--transition-fast) var(--ease-fall);
}

.add-cover-enter-from,
.add-cover-leave-to {
  opacity: 0;
}

.suggest-enter-active,
.suggest-leave-active {
  transition: opacity var(--transition-fast) var(--ease-standard);
}

.suggest-enter-from,
.suggest-leave-to {
  opacity: 0;
}

/* Overlay under the input row rather than in-flow, so opening the dropdown
   never pushes the list down. */
.suggestions-wrap {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 0.35rem;
  z-index: 20;
}

/* Lifted, it is not an overlay at all: it is what is left of the screen under
   the band, and it takes the rest of the height. */
.add-form--expanded .suggestions-wrap {
  /* relative rather than static: it still has to sit in the flow, but it is also
     what the tap counters are positioned against, and they must not be clipped
     by the scrolling results inside it.

     inset and z-index have to be put back by hand. The rule above is the
     DROPDOWN's, and its top/left/right and stacking only ever applied because it
     was absolute there; static ignored them silently. Turning this relative
     hands them all back — top: 100% on a relative box shifts it down a full
     container height, which puts the entire results panel off the bottom of the
     screen and looks exactly like search having stopped working. */
  position: relative;
  inset: auto;
  z-index: auto;
  margin-top: 0;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: calc(480px + 2rem);
  margin-inline: auto;
}

.suggestions {
  list-style: none;
  margin: 0;
  padding: 0.3rem;
  background: var(--bg-surface);
  border: var(--border-width-base) solid var(--border-main);
  border-radius: var(--radius-xl);
  box-shadow: 0 10px 28px color-mix(in srgb, var(--text-primary) 14%, transparent);
  max-height: 275px;
  overflow-y: auto;
}

/* Lifted, every one of those is wrong: a border, a radius and a drop shadow are
   how a dropdown says it is floating over a page, and the page is gone. The
   rows run edge to edge on the screen's own surface instead, and the only cap
   left is the screen. */
.add-form--expanded .suggestions {
  flex: 1;
  min-height: 0;
  max-height: none;
  padding: 0.35rem 0 calc(1.5rem + var(--safe-bottom));
  background: none;
  border: none;
  border-radius: 0;
  box-shadow: none;
  overscroll-behavior: contain;
}

.suggestion {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  padding: 0.5rem 0.6rem;
  background: none;
  border: none;
  border-radius: var(--radius-lg);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}

/* Full-bleed rows with the gutter inside them, so a long product name gets the
   whole width and the touch target runs to both edges. */
.add-form--expanded .suggestion {
  min-height: 56px;
  gap: 0.75rem;
  padding: 0.6rem 1rem;
  border-radius: 0;
}

.add-form--expanded .suggestion-emoji {
  width: 2.15rem;
  height: 2.15rem;
  font-size: var(--text-xl);
}

/* Mirrors .list-meta__label in the shopping list: the two are the same kind of
   thing — a quiet word naming what the rows under it are. */
.suggestions-label {
  flex-shrink: 0;
  margin: 0;
  padding: 0.85rem 1rem 0.3rem;
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-disabled);
}

.suggestions-hint {
  margin: 0;
  padding: 1.5rem 1rem;
  text-align: center;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

/* ─── The add, confirmed ─────────────────────────────────────────────────────
   Announced, not drawn. The confirmation that used to be a band above the
   results is a mark on the row now, so this carries only what a tick cannot. */
.added-announce {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.suggestion:hover,
.suggestion:focus-visible {
  background: var(--bg-hover);
}

/* ─── A row that is already on the list ──────────────────────────────────────
   The tick rides the product tile, the way the row on the list wears its own
   mark. It is always rendered and scaled to nothing, so appearing costs no
   layout -- the row's height and the name's position never move. */
.suggestion-emoji {
  position: relative;
}

.suggestion-tick {
  position: absolute;
  right: -4px;
  bottom: -4px;
  width: 1rem;
  height: 1rem;
  border-radius: var(--radius-pill);
  background: var(--color-primary);
  color: var(--text-inverse);
  border: var(--border-width-base) solid var(--bg-surface);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transform: scale(0);
  transition: transform var(--transition-base) var(--ease-rise);
}

.suggestion--added .suggestion-tick {
  transform: scale(1);
}

.suggestion-tick :deep(svg) {
  width: 0.62rem;
  height: 0.62rem;
  display: block;
  stroke: currentColor;
  stroke-width: 3.5;
  fill: none;
}

/* The name steps back once its product is on the list: still readable, no longer
   the thing being offered. */
.suggestion--added .suggestion-name {
  color: var(--text-secondary);
}

/* The moment of adding, on the row that was tapped: one pass, leaving the tick
   behind as the standing answer.

   Two rules and two keyframes, identical in everything but their names. The row
   that was just tapped is very often the row that was tapped a moment ago --
   that is how you add three of something -- and re-applying the same animation
   to an element already wearing it does nothing at all. Swapping which of these
   two is on the row is a real declaration change, so the flash starts over. */
.suggestion--lit-a {
  animation: suggestion-lit-a var(--transition-slow) var(--ease-standard);
}

.suggestion--lit-b {
  animation: suggestion-lit-b var(--transition-slow) var(--ease-standard);
}

@keyframes suggestion-lit-a {
  50% {
    background: color-mix(in srgb, var(--color-primary) 16%, var(--bg-surface));
  }
}

@keyframes suggestion-lit-b {
  50% {
    background: color-mix(in srgb, var(--color-primary) 16%, var(--bg-surface));
  }
}

/* ─── The tap counters ───────────────────────────────────────────────────────
   A layer of its own, over the results and outside their scroll box, so a
   counter thrown from the top row is not sliced off by the list's edge. It never
   takes a press: the row underneath is still the thing being tapped, and being
   tapped repeatedly is the entire point. */
.pop-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 3;
}

.pop {
  position: absolute;
  padding: 0.1rem 0.45rem;
  border-radius: var(--radius-pill);
  background: var(--color-primary);
  color: var(--text-inverse);
  font-size: var(--text-sm);
  font-weight: var(--weight-extrabold);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  box-shadow: var(--elevation-primary-soft);
  /* left/top put it under the finger; the keyframes carry the centring, because
     an animated transform replaces any transform set here. */
  animation: pop-drift 0.9s var(--ease-fall) forwards;
}

@keyframes pop-drift {
  0% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.6);
  }
  /* Overshoots its final size on the way out of the finger, which is what makes
     it read as thrown rather than faded up. */
  22% {
    opacity: 1;
    transform: translate(
        calc(-50% + var(--pop-dx) * 0.35),
        calc(-50% + var(--pop-dy) * 0.35)
      )
      scale(1.08);
  }
  100% {
    opacity: 0;
    transform: translate(calc(-50% + var(--pop-dx)), calc(-50% + var(--pop-dy)))
      scale(0.92) rotate(var(--pop-rot));
  }
}

/* Mirrors .suggestion's box exactly, so real rows land where the placeholder
   stood instead of shifting the list as they arrive. */
.suggestion-skeleton {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0.6rem;
}

.suggestion-skeleton__text {
  display: flex;
  flex-direction: column;
  gap: 0.32rem;
  flex: 1;
  min-width: 0;
}

.suggestion-emoji {
  flex-shrink: 0;
  font-size: var(--text-lg);
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.9rem;
  height: 1.9rem;
  border-radius: 0.6rem;
  background: color-mix(in srgb, var(--color-primary) 10%, var(--bg-surface));
  border: var(--border-width-thin) solid color-mix(in srgb, var(--color-primary) 22%, var(--bg-surface));
}

.suggestion-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.suggestion-name {
  font-size: var(--text-md);
  color: var(--text-primary);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.suggestion-maker {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--text-secondary);
  line-height: 1.3;
}

/* The escape hatch is an action, not a product: a rule separates it from the
   matches above, and it takes the primary colour so it reads as a way out
   rather than as one more thing to buy. When it is the only row there is
   nothing to separate it from, so the rule collapses. */
.suggestions-hatch:not(:only-child) {
  border-top: var(--border-width-thin) solid var(--border-light);
  margin-top: 0.3rem;
  padding-top: 0.3rem;
}

/* Edge to edge with the rows it sits under, rather than inset by a card's
   padding that is no longer there. */
.add-form--expanded .suggestions-hatch:not(:only-child) {
  margin-top: 0.35rem;
  padding-top: 0.35rem;
}

/* Same icon as the modal this row opens, so the two read as one action. */
.suggestion-icon {
  width: 1.05rem;
  height: 1.05rem;
  background-color: var(--color-primary);
  mask: url('../assets/package-search.svg') no-repeat center / contain;
  -webkit-mask: url('../assets/package-search.svg') no-repeat center / contain;
}

/* Quieter than the products it sits under: this is the way out, not a thing to
   buy. Only the action line takes the primary colour, and it keeps the same
   weight as a real product's maker so it never out-shouts the matches. */
.suggestion-name--custom {
  color: var(--text-secondary);
}

.suggestion-maker--custom {
  color: var(--color-primary);
}

.add-row {
  display: flex;
  align-items: center;
  background: var(--bg-surface);
  border: var(--border-width-base) solid var(--border-main);
  border-radius: var(--radius-2xl);
  overflow: hidden;
  transition: border-color var(--transition-fast);
}

/* The field is the only thing that travels between the list and the search
   screen — the band, the results and Cancel fade in around it. It is what the
   user touched, so it is the one thing that should not blink out and reappear
   somewhere else. The fall back down is set inline in collapse(). */
.add-form--expanded .add-row {
  flex-shrink: 0;
  transition: border-color var(--transition-fast),
    transform var(--transition-base) var(--ease-rise);
}

.add-row:focus-within {
  border-color: var(--color-primary);
}

.add-row input {
  flex: 1;
  padding: 0.85rem 1rem;
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: var(--text-md);
  color: var(--text-primary);
  outline: none;
  min-width: 0;
}

.add-row input::placeholder {
  color: var(--text-disabled);
}


.add-btn {
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  /* Even on all four sides: the row has no padding of its own, so this margin
     is the whole gap to its inner edge. */
  margin: 4px;
  background: var(--color-primary);
  color: var(--text-inverse);
  border: none;
  border-radius: var(--radius-lg);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity var(--transition-fast);
  padding: 0;
}

.add-icon {
  width: var(--size-icon-lg);
  height: var(--size-icon-lg);
  background-color: var(--text-inverse);
  mask: url('../assets/add.svg') no-repeat center / contain;
  -webkit-mask: url('../assets/add.svg') no-repeat center / contain;
}

/* Inlined rather than masked like its neighbours, for the reason .suggestion-tick
   is: the asset ships at stroke-width 1, and a barcode glyph is nothing BUT thin
   strokes — masked at this size it dissolves into the green. A shade larger than
   the plus, too, since seven hairlines read lighter than one stroked cross. */
.scan-icon {
  width: calc(var(--size-icon-lg) + 2px);
  height: calc(var(--size-icon-lg) + 2px);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.scan-icon :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  stroke: currentColor;
  stroke-width: 2.1;
  fill: none;
}

.add-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* The swap between the two jobs. Short enough that mode="out-in" never reads as
   a gap — this is the only place in the row that still animates, now that the
   quantity stepper it used to keep time with has gone. */
.btn-swap-enter-active,
.btn-swap-leave-active {
  transition: opacity 0.11s ease, transform 0.11s ease;
}

.btn-swap-enter-from,
.btn-swap-leave-to {
  opacity: 0;
  transform: scale(0.7);
}


.spinner {
  width: 16px;
  height: 16px;
  border: var(--border-width-thick) solid var(--spinner-stroke);
  border-top-color: var(--text-inverse);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* The screen still opens — it is where the room comes from — it just opens at
   once. The JS checks the same query and skips its half of the slide. */
@media (prefers-reduced-motion: reduce) {
  .add-form--expanded .add-row,
  .add-form--expanded .add-head__bar,
  .add-cover-enter-active,
  .add-cover-leave-active,
  .suggest-enter-active,
  .suggest-leave-active,
  .suggestion,
  .suggestion-tick,
  .btn-swap-enter-active,
  .btn-swap-leave-active {
    transition: none;
  }

  /* The tick still arrives, it just does not grow into place. */
  .suggestion-tick {
    transform: scale(1);
  }

  .suggestion--lit-a,
  .suggestion--lit-b {
    animation: none;
  }

  /* The count still appears and still goes away on its own — it is the answer to
     "did that tap count", not decoration — it just does not fly to get there. */
  @keyframes pop-drift {
    0% {
      opacity: 0;
      transform: translate(-50%, -50%);
    }
    22% {
      opacity: 1;
      transform: translate(-50%, -50%);
    }
    100% {
      opacity: 0;
      transform: translate(-50%, -50%);
    }
  }

  .btn-swap-enter-from,
  .btn-swap-leave-to {
    transform: none;
  }
}
</style>

