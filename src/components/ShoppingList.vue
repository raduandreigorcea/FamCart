<script setup>
import { computed, ref } from 'vue'
import ShoppingListItem from './ShoppingListItem.vue'
import SkeletonBlock from './SkeletonBlock.vue'
import { sumActiveQuantities, sumCheckedQuantities } from '../lib/shoppingList'
import cartIcon from '../assets/shopping-cart.svg?raw'
import checkIcon from '../assets/check.svg?raw'

// Presentational: renders the list with its move animations, the initial-load
// skeleton, and the empty state. All mutations stay with the parent, which owns
// the items.
const props = defineProps({
  items: { type: Array, default: () => [] },
  // Map<user_id, { display_name, image_url }> — the family roster, used to
  // resolve each row's author avatar/name from item.added_by at render time.
  memberProfiles: { type: Map, default: () => new Map() },
  loading: { type: Boolean, default: false },
  showEmpty: { type: Boolean, default: false },
})

function avatarUrl(item) {
  return props.memberProfiles.get(item.added_by)?.image_url || null
}

function avatarName(item) {
  return props.memberProfiles.get(item.added_by)?.display_name || 'Member'
}

const emit = defineEmits(['toggle', 'delete', 'checkout'])

const uncheckedItems = computed(() => props.items.filter((i) => !i.checked))
const checkedItems = computed(() => props.items.filter((i) => i.checked))
const leftCount = computed(() => sumActiveQuantities(props.items))
// Units, not rows: "grapes x4" counts as 4 on the buy button.
const checkedUnitCount = computed(() => sumCheckedQuantities(props.items))

const skeletonNameWidths = ['55%', '38%', '62%', '30%']

// ─── Checkout action ─────────────────────────────────────────────────────────
// The bar owns the celebration: it drains the checked rows into the cart and
// morphs to a check, then hands the ids up so the parent archives them. Removal
// is deferred to the end of the animation so the rows are still on screen while
// they drain.
const DRAIN_MS = 550
const STAGGER_MS = 55
const prefersReducedMotion =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const buying = ref(false)
const buttonSuccess = ref(false)
const drainingIds = ref([])
const isDraining = (id) => drainingIds.value.includes(id)
// Position among the draining rows, so they fall into the bar in a stagger.
// Checked rows now sit wherever they were added, so the order comes from the
// drain list rather than from a contiguous checked section.
const drainIndex = (id) => Math.max(0, drainingIds.value.indexOf(id))

function startCheckout() {
  if (buying.value || !checkedItems.value.length) return
  const ids = checkedItems.value.map((i) => i.id)
  buying.value = true
  buttonSuccess.value = true
  // Park the thumb at the end of the track for the success state, whichever
  // path got us here (a completed drag already has it there; the keyboard
  // path animates it across).
  maxTravel = maxTravel || measureTravel()
  dragX.value = maxTravel

  if (prefersReducedMotion) {
    finishCheckout(ids)
    return
  }

  drainingIds.value = ids
  // Wait out the last row's fall (its delay + one drain duration) before the
  // parent removes them, so nothing pops out mid-animation.
  const total = DRAIN_MS + Math.min(ids.length - 1, 6) * STAGGER_MS
  window.setTimeout(() => finishCheckout(ids), total)
}

function finishCheckout(ids) {
  emit('checkout', ids)
  drainingIds.value = []
  buying.value = false
  // Let the success tick linger a beat; the bar usually unmounts before this
  // fires because the checked list just emptied. On a failed checkout the parent
  // restores the items and the bar reappears cleanly in its idle state.
  window.setTimeout(() => {
    buttonSuccess.value = false
    dragX.value = 0
  }, 260)
}

// ─── Slide to confirm ─────────────────────────────────────────────────────────
// Checking out archives the whole checked section, so the bar is a
// slide-to-confirm control rather than a tap target: drag the thumb across the
// track to trigger it. Below the completion threshold the thumb snaps back.
// Keyboard users are not made to simulate a drag: Enter/Space on the focused
// thumb (a click with detail 0) checks out directly.
const THUMB_SIZE = 51 // px; bar height minus its borders; keep in sync with .buy-bar__thumb
const THUMB_INSET = 0 // px gap between thumb and track edge; the thumb sits flush
const COMPLETE_AT = 0.85 // fraction of the travel that counts as done

const barEl = ref(null)
const thumbEl = ref(null)
const dragging = ref(false)
const dragX = ref(0)
let activePointerId = null
let grabOffsetX = 0
let maxTravel = 0

function measureTravel() {
  if (!barEl.value || !thumbEl.value) return 0
  return Math.max(0, barEl.value.clientWidth - thumbEl.value.offsetWidth - THUMB_INSET * 2)
}

function onThumbDown(e) {
  if (buying.value) return
  maxTravel = measureTravel()
  if (!maxTravel) return
  dragging.value = true
  activePointerId = e.pointerId
  grabOffsetX = e.clientX - dragX.value
  e.currentTarget.setPointerCapture?.(e.pointerId)
}

function onThumbMove(e) {
  if (!dragging.value || e.pointerId !== activePointerId) return
  dragX.value = Math.min(Math.max(e.clientX - grabOffsetX, 0), maxTravel)
}

function onThumbUp(e) {
  if (!dragging.value || e.pointerId !== activePointerId) return
  dragging.value = false
  activePointerId = null
  if (dragX.value >= maxTravel * COMPLETE_AT) {
    startCheckout()
  } else {
    dragX.value = 0
  }
}

function onThumbCancel() {
  dragging.value = false
  activePointerId = null
  dragX.value = 0
}

// A pointer click must not check out — requiring the slide is the point. A
// keyboard activation of the button arrives as a click with detail === 0.
function onThumbClick(e) {
  if (e.detail === 0) startCheckout()
}

const thumbStyle = computed(() => ({ transform: `translateX(${dragX.value}px)` }))
// The green trail ends flush with the thumb's leading edge: the full-height
// thumb caps the trail like the rounded nose of one pill. At full travel this
// is exactly the bar's inner width; success pins it there.
const fillWidth = computed(() => THUMB_INSET * 2 + THUMB_SIZE + dragX.value)
const fillStyle = computed(() => ({
  width: buttonSuccess.value ? '100%' : `${fillWidth.value}px`,
}))
// A white copy of the label is clipped to the swept region, so the hint text
// turns white where the green has covered it. The clip line sits at the
// thumb's midline — under the solid knob — not at the trail's leading edge:
// clipping at the edge flipped letters white a few pixels ahead of the knob
// (visibly so around its rounded nose).
const inverseLabelStyle = computed(() => ({
  clipPath: buttonSuccess.value
    ? 'inset(0 0 0 0)'
    : `inset(0 calc(100% - ${THUMB_INSET + THUMB_SIZE / 2 + dragX.value}px) 0 0)`,
}))
const labelText = computed(() =>
  buttonSuccess.value
    ? 'Checked out!'
    : `Slide to check out ${checkedUnitCount.value} ${checkedUnitCount.value === 1 ? 'item' : 'items'}`,
)
</script>

<template>
  <div class="list-meta" v-if="uncheckedItems.length">
    <span class="list-meta__label">To buy</span>
    <span class="list-meta__count">{{ leftCount }} left</span>
  </div>

  <!-- Skeleton rows while the first fetch is in flight -->
  <ul v-if="loading" class="item-list" aria-hidden="true">
    <li v-for="(nameWidth, idx) in skeletonNameWidths" :key="idx" class="skeleton-item">
      <SkeletonBlock width="24px" height="24px" radius="50%" />
      <SkeletonBlock width="2.05rem" height="2.05rem" radius="0.65rem" />
      <SkeletonBlock class="skeleton-item__name" :width="nameWidth" height="0.95rem" />
      <SkeletonBlock width="var(--size-avatar-sm)" height="var(--size-avatar-sm)" radius="var(--radius-pill)" />
    </li>
  </ul>

  <!-- One list, in one order. Ticking a row restyles it in place instead of
       moving it to a section at the bottom. -->
  <TransitionGroup tag="ul" name="row" class="item-list">
    <ShoppingListItem
      v-for="item in items"
      :key="item.id"
      :item="item"
      :avatar-url="avatarUrl(item)"
      :avatar-name="avatarName(item)"
      :draining="isDraining(item.id)"
      :drain-index="drainIndex(item.id)"
      @toggle="$emit('toggle', $event)"
      @delete="$emit('delete', $event)"
    />
  </TransitionGroup>

  <!-- Keeps the last checked row clear of the fixed buy bar. -->
  <div v-if="checkedItems.length && !loading" class="buy-bar-spacer" aria-hidden="true"></div>

  <div v-if="showEmpty" class="empty-state">
    <span class="empty-state__art" aria-hidden="true">🧺</span>
    <p class="empty-state__title">Your list is empty</p>
    <p class="empty-state__text">Add your first item above and it shows up for the whole family right away.</p>
  </div>

  <!-- Floating checkout slider: appears whenever something is checked. -->
  <Transition name="buybar">
    <div v-if="checkedItems.length && !loading" class="buy-bar-wrap">
      <div
        ref="barEl"
        class="buy-bar"
        :class="{ 'buy-bar--success': buttonSuccess, 'buy-bar--dragging': dragging }"
      >
        <div class="buy-bar__fill" :style="fillStyle" aria-hidden="true"></div>
        <span class="buy-bar__label">{{ labelText }}</span>
        <span class="buy-bar__label buy-bar__label--inverse" :style="inverseLabelStyle" aria-hidden="true">
          {{ labelText }}
        </span>
        <button
          ref="thumbEl"
          class="buy-bar__thumb"
          type="button"
          :style="thumbStyle"
          :disabled="buying"
          :aria-label="`Check out ${checkedUnitCount} ${checkedUnitCount === 1 ? 'item' : 'items'}`"
          @pointerdown="onThumbDown"
          @pointermove="onThumbMove"
          @pointerup="onThumbUp"
          @pointercancel="onThumbCancel"
          @click="onThumbClick"
        >
          <span class="buy-bar__icon" aria-hidden="true">
            <span class="buy-bar__cart" v-html="cartIcon"></span>
            <span class="buy-bar__check" v-html="checkIcon"></span>
          </span>
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* Meta — a header for the active section, mirroring the "Checked" label below. */
.list-meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-top: 0.15rem;
  margin-bottom: 0.6rem;
  padding: 0 0.15rem;
}

.list-meta__label {
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-disabled);
}

.list-meta__count {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--text-disabled);
  font-variant-numeric: tabular-nums;
}

/* Mirrors ShoppingListItem's .item card so rows swap in without layout shift */
.skeleton-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: var(--bg-surface);
  border-radius: var(--radius-xl);
  padding: 0.875rem 0.875rem 0.875rem 0.75rem;
  border: var(--border-width-base) solid var(--border-main);
}

.skeleton-item__name {
  margin-right: auto;
}

.item-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  position: relative;
}

/* Rows still animate for the things that genuinely move them: something added,
   removed, or checked out. Ticking is no longer one of those. */
.row-move {
  transition: transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}

.row-enter-active {
  transition: opacity 0.32s ease, transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
}

.row-leave-active {
  transition: opacity var(--transition-base) ease, transform var(--transition-base) ease;
  position: absolute;
  width: 100%;
  pointer-events: none;
  z-index: 2;
}

.row-enter-from {
  opacity: 0;
  transform: translateY(-8px) scale(0.995);
}

.row-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.995);
}

/* Empty state */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  margin: 3rem auto 0;
  max-width: 20rem;
}

.empty-state__art {
  width: 4rem;
  height: 4rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  border-radius: var(--radius-2xl);
  background: color-mix(in srgb, var(--color-primary) 10%, var(--bg-surface));
  border: var(--border-width-thin) solid color-mix(in srgb, var(--color-primary) 18%, transparent);
  margin-bottom: var(--space-4);
}

.empty-state__title {
  margin: 0 0 var(--space-2);
  font-size: var(--text-lg);
  font-weight: var(--weight-extrabold);
  color: var(--text-primary);
}

.empty-state__text {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: 1.5;
}

/* Buy bar */
.buy-bar-spacer {
  height: 84px;
}

.buy-bar-wrap {
  position: fixed;
  left: 0;
  right: 0;
  bottom: calc(1rem + var(--safe-bottom));
  z-index: 50;
  display: flex;
  justify-content: center;
  padding: 0 1rem;
  /* Only the button should catch taps; the rest of the strip is see-through. */
  pointer-events: none;
}

.buy-bar {
  pointer-events: auto;
  position: relative;
  width: 100%;
  max-width: 480px;
  height: 54px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-pill);
  background: var(--bg-surface);
  border: var(--border-width-base) solid var(--border-main);
  color: var(--color-primary);
  box-shadow: var(--elevation-primary);
  overflow: hidden; /* fill and thumb stay inside the pill */
}

/* Green trail the thumb leaves behind as it crosses the white track. A tint
   of the thumb's green (mixed toward the surface so it tracks the theme) —
   light enough that the solid knob reads as a distinct button riding on its
   own trail, dark enough that the inverse (white) label stays readable. */
.buy-bar__fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--color-primary) 80%, var(--bg-surface));
  pointer-events: none;
  transition: width var(--transition-slow) cubic-bezier(0.22, 1, 0.36, 1);
}

.buy-bar__label {
  position: relative;
  z-index: 1;
  /* Keep the hint clear of the thumb's resting spot. */
  padding: 0 3.4rem;
  font-size: var(--text-md);
  font-weight: var(--weight-extrabold);
  letter-spacing: -0.01em;
  pointer-events: none;
}

/* White copy of the label, clipped to the green fill: the text reads white
   exactly where the trail has swept over it and green where it hasn't. */
.buy-bar__label--inverse {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-inverse);
  transition: clip-path var(--transition-slow) cubic-bezier(0.22, 1, 0.36, 1);
}

/* The thumb keeps the full-strength green so it stands out as the grabbable
   knob against the lighter trail behind it. It must be painted (not
   transparent): it sits above the labels, so a solid thumb blots out text it
   crosses; a transparent one let the letters show through inside the knob. */
.buy-bar__thumb {
  position: absolute;
  /* Flush against the track's inner edges: absolute positioning is relative
     to the padding box (inside the 1.5px border), so 0/0 nests the circle
     right into the pill's rounded end with no gap. */
  left: 0;
  top: 0;
  z-index: 2;
  width: 51px; /* keep in sync with THUMB_SIZE */
  height: 51px;
  border: none;
  border-radius: 50%;
  background: var(--color-primary);
  color: var(--text-inverse);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  /* The drag owns the gesture; don't let touch scroll the page instead. */
  touch-action: none;
  transition: transform var(--transition-slow) cubic-bezier(0.22, 1, 0.36, 1);
}

.buy-bar__thumb:disabled {
  cursor: default;
}

/* The thumb is invisible, so keyboard focus draws its own ring on the green
   disc beneath. */
.buy-bar__thumb:focus-visible {
  outline: var(--border-width-thick) solid var(--text-inverse);
  outline-offset: -4px;
}

/* While the finger drives the thumb, everything follows it instantly; the
   transitions above are for the snap back/forward on release. */
.buy-bar--dragging .buy-bar__thumb,
.buy-bar--dragging .buy-bar__fill,
.buy-bar--dragging .buy-bar__label {
  transition: none;
}

.buy-bar--dragging .buy-bar__thumb {
  cursor: grabbing;
}

.buy-bar__icon {
  position: relative;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  transition: transform var(--transition-fast) ease;
}

/* Slight tactile swell while the finger is on it. */
.buy-bar--dragging .buy-bar__icon {
  transform: scale(1.12);
}

.buy-bar__cart,
.buy-bar__check {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  transition: opacity var(--transition-base) ease, transform var(--transition-slow) cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* Both assets ship at stroke-width 1, too fine for a 22px knob icon. */
.buy-bar__cart :deep(svg),
.buy-bar__check :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  stroke: currentColor;
  fill: none;
}

.buy-bar__cart :deep(svg) {
  stroke-width: 2;
}

.buy-bar__check :deep(svg) {
  stroke-width: 2.4;
}

/* Cart is the resting state; on success it lifts away and the check drops in. */
.buy-bar__cart {
  opacity: 1;
  transform: scale(1) translateY(0);
}

.buy-bar__check {
  opacity: 0;
  transform: scale(0.4) translateY(-6px);
}

.buy-bar--success .buy-bar__cart {
  opacity: 0;
  transform: scale(0.4) translateY(6px);
}

.buy-bar--success .buy-bar__check {
  opacity: 1;
  transform: scale(1) translateY(0);
}

/* Bar slide-in/out */
.buybar-enter-active {
  transition: opacity var(--transition-base) ease, transform var(--transition-slow) cubic-bezier(0.22, 1, 0.36, 1);
}

.buybar-leave-active {
  transition: opacity var(--transition-base) ease, transform var(--transition-base) ease;
}

.buybar-enter-from,
.buybar-leave-to {
  opacity: 0;
  transform: translateY(16px);
}

@media (prefers-reduced-motion: reduce) {
  .buy-bar__fill,
  .buy-bar__thumb,
  .buy-bar__label,
  .buy-bar__cart,
  .buy-bar__check,
  .buybar-enter-active,
  .buybar-leave-active {
    transition: none;
  }
}
</style>
