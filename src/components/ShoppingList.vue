<script setup lang="ts">
import { computed, ref, type PropType } from 'vue'
import ShoppingListItem from './ShoppingListItem.vue'
import SkeletonBlock from './SkeletonBlock.vue'
import ListFilterMenu from './ListFilterMenu.vue'
import { getProductEmoji } from '../lib/productEmoji'
import { productKey } from '../lib/productSearch'
import { sumActiveQuantities, sumCheckedQuantities } from '../lib/shoppingList'
import type { ShoppingItemRow, FamilyMemberProfile } from '../lib/familyRealtime'
import type { ProductSuggestion } from '../lib/productSearch'
import cartIcon from '../assets/shopping-cart.svg?raw'
import checkIcon from '../assets/check.svg?raw'

// Presentational: renders the list with its move animations, the initial-load
// skeleton, and the empty state. All mutations stay with the parent, which owns
// the items.
const props = defineProps({
  items: { type: Array as PropType<ShoppingItemRow[]>, default: () => [] },
  // Map<user_id, { display_name, image_url }> — the family roster, used to
  // resolve each row's author avatar/name from item.added_by at render time.
  memberProfiles: {
    type: Map as PropType<Map<string, FamilyMemberProfile>>,
    default: () => new Map(),
  },
  loading: { type: Boolean, default: false },
  showEmpty: { type: Boolean, default: false },
  // Whether this family has ever bought anything. An empty list means two
  // different things either side of that, and only one of them is a list
  // waiting to be started.
  hasShopped: { type: Boolean, default: false },
  // The regulars, [{ name, maker }], offered as one-tap adds on the empty
  // list. Empty for a family with no history, which then gets the words alone.
  suggestedProducts: { type: Array as PropType<ProductSuggestion[]>, default: () => [] },
})

// 'all' | 'active' | 'checked'. Applied to what is RENDERED only -- the counts
// and the buy bar below stay on the whole list, because a filter hides rows
// rather than removing them. Filtering to "To buy" while three things sit in
// the cart must not strand them behind a bar that vanished.
//
// A model rather than a prop: the control that changes it lives in this
// component's header, but the value belongs to the view that owns the list.
const filter = defineModel('filter', { type: String, default: 'all' })

const emit = defineEmits(['toggle', 'delete', 'checkout', 'add'])

const uncheckedItems = computed(() => props.items.filter((i) => !i.checked))
const checkedItems = computed(() => props.items.filter((i) => i.checked))

const visibleItems = computed(() => {
  if (filter.value === 'active') return uncheckedItems.value
  if (filter.value === 'checked') return checkedItems.value
  return props.items
})

// Everything each row needs, worked out once per render instead of four times
// per row inside the v-for. The drain lookups were the reason: indexOf() per row
// over the draining list is quadratic in the row count. Harmless at the 50-item
// cap, but a map costs nothing and the template reads as data rather than calls.
const visibleRows = computed(() => {
  const drainOrder = new Map(drainingIds.value.map((id, index) => [id, index]))
  return visibleItems.value.map((item) => {
    const profile = props.memberProfiles.get(item.added_by ?? '')
    return {
      item,
      avatarUrl: profile?.image_url || undefined,
      avatarName: profile?.display_name || 'Member',
      draining: drainOrder.has(item.id),
      // Position among the draining rows, so they fall into the bar in a
      // stagger. Checked rows sit wherever they were added, so the order comes
      // from the drain list rather than from a contiguous checked section.
      drainIndex: drainOrder.get(item.id) ?? 0,
    }
  })
})

// The header names whichever list is on screen. It stays put in every filter
// state, because it is also where the filter button lives -- hiding it while
// viewing the cart would take away the only way back.
//
// Which is why the unfiltered case has to check what is actually there: this
// header used to disappear once the last row was ticked, and now that it
// cannot, "To buy - 0 left" would sit over a list that is entirely cart. Under
// an explicit filter the label follows the filter, even when it comes up empty,
// because there the count is the answer to a question you asked.
const viewingChecked = computed(
  () =>
    filter.value === 'checked' ||
    (filter.value === 'all' && props.items.length > 0 && uncheckedItems.value.length === 0),
)
const metaLabel = computed(() => (viewingChecked.value ? 'Checked' : 'To buy'))
const metaCount = computed(() =>
  viewingChecked.value
    ? `${checkedItems.value.length} ${checkedItems.value.length === 1 ? 'item' : 'items'}`
    : `${leftCount.value} left`,
)

// The list has rows, the filter just hides all of them. Distinct from the empty
// state, which means there is nothing to buy at all.
const filteredToNothing = computed(
  () => !props.loading && props.items.length > 0 && visibleItems.value.length === 0,
)

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
const drainingIds = ref<string[]>([])

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

function finishCheckout(ids: string[]) {
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

const barEl = ref<HTMLElement | null>(null)
const thumbEl = ref<HTMLElement | null>(null)
const dragging = ref(false)
const dragX = ref(0)
let activePointerId: number | null = null
let grabOffsetX = 0
let maxTravel = 0

function measureTravel() {
  if (!barEl.value || !thumbEl.value) return 0
  return Math.max(0, barEl.value.clientWidth - thumbEl.value.offsetWidth - THUMB_INSET * 2)
}

function onThumbDown(e: PointerEvent) {
  if (buying.value) return
  maxTravel = measureTravel()
  if (!maxTravel) return
  dragging.value = true
  activePointerId = e.pointerId
  grabOffsetX = e.clientX - dragX.value
  ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
}

function onThumbMove(e: PointerEvent) {
  if (!dragging.value || e.pointerId !== activePointerId) return
  dragX.value = Math.min(Math.max(e.clientX - grabOffsetX, 0), maxTravel)
}

function onThumbUp(e: PointerEvent) {
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
function onThumbClick(e: MouseEvent) {
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
  <div class="list-meta" v-if="!loading && items.length">
    <span class="list-meta__label">{{ metaLabel }}</span>
    <span class="list-meta__count">{{ metaCount }}</span>
    <ListFilterMenu v-model="filter" :items="items" />
  </div>

  <!-- Skeleton rows while the first fetch is in flight, or the real list: never
       both. They are separate <ul>s stacked in flow, so rendering them together
       showed placeholders sitting on top of the rows they stand in for, which
       then jumped up as the skeletons unmounted. -->
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
  <TransitionGroup v-else tag="ul" name="row" class="item-list">
    <ShoppingListItem
      v-for="row in visibleRows"
      :key="row.item.id"
      :item="row.item"
      :avatar-url="row.avatarUrl"
      :avatar-name="row.avatarName"
      :draining="row.draining"
      :drain-index="row.drainIndex"
      @toggle="$emit('toggle', $event)"
      @delete="$emit('delete', $event)"
    />
  </TransitionGroup>

  <p v-if="filteredToNothing" class="filter-empty">
    {{ filter === 'checked' ? 'Nothing checked yet.' : 'Everything here is checked.' }}
  </p>

  <!-- Keeps the last checked row clear of the fixed buy bar. -->
  <div v-if="checkedItems.length && !loading" class="buy-bar-spacer" aria-hidden="true"></div>

  <!-- An empty grocery list is usually a finished one, not a broken one: for a
       family that shops, this screen is what checking out leaves behind. And
       the thing they are most likely to want from it is not a message — it is
       the next list, which for groceries is largely the same as the last one.
       So the regulars are here as one tap each, and the screen is a way to
       start rather than a notice that there is nothing to see. -->
  <div v-if="showEmpty" class="empty-state">
    <p class="empty-state__title">{{ hasShopped ? 'All bought' : 'Nothing here yet' }}</p>
    <p class="empty-state__text">
      {{ hasShopped
        ? 'Nothing left to pick up.'
        : 'Add the first thing and everyone in the family sees it straight away.' }}
    </p>

    <!-- Same name as the search screen's section, because it is the same idea
         and one name for it is how it gets learned. -->
    <div v-if="suggestedProducts.length" class="restart">
      <p class="restart__label">Buy again</p>
      <div class="restart__chips">
        <button
          v-for="product in suggestedProducts"
          :key="productKey(product.name, product.maker)"
          type="button"
          class="chip"
          :aria-label="`Add ${product.name}`"
          @click="emit('add', product)"
        >
          <span class="chip__emoji" aria-hidden="true">
            {{ getProductEmoji(product.name, product.maker || '') }}
          </span>
          <span class="chip__name">{{ product.name }}</span>
          <span class="chip__plus" aria-hidden="true"></span>
        </button>
      </div>
    </div>
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
/* Meta — names whichever list is on screen, and carries the filter button.
   Centred rather than baseline-aligned now that a control sits in the row. */
.list-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--size-control-sm);
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

/* Pushed right, with the filter button following it — the count reads as the
   label's answer, and the button as the thing that changes both. */
.list-meta__count {
  margin-left: auto;
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

/* Not the empty state: the list has rows, this filter just has none of them.
   Quieter than the real empty state, because nothing is wrong. */
.filter-empty {
  margin: var(--space-6) 0 var(--space-4);
  text-align: center;
  font-size: var(--text-sm);
  color: var(--text-disabled);
}

/* Empty state.
   Left-aligned on .list-meta's inset — the list's own left edge — so it reads
   as this list having nothing in it rather than as a widget parked in the
   middle of the screen. No card and no tinted icon tile; the chips below are
   the substance, and the words are just enough to say where you are. */
.empty-state {
  margin: 2.25rem 0 0;
  padding: 0 0.15rem;
}

.empty-state__title {
  margin: 0 0 var(--space-1);
  font-size: var(--text-xl);
  font-weight: var(--weight-extrabold);
  /* The app's heading tracking. At this size the default spacing reads loose. */
  letter-spacing: -0.02em;
  line-height: 1.2;
  color: var(--text-primary);
}

/* ~34ch is the measure where a line of this size still scans in one go. */
.empty-state__text {
  margin: 0;
  max-width: 34ch;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: 1.6;
}

/* Deliberately NOT the shape of an item row — these are things that are not on
   the list yet, and a row would say the opposite. Pills, wrapping, sized to
   their own names. */
.restart {
  margin-top: var(--space-5);
}

/* Mirrors .list-meta__label: both name what the things under them are. */
.restart__label {
  margin: 0 0 var(--space-3);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-disabled);
}

.restart__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  /* 40px: comfortably tappable without the pills turning into buttons. */
  min-height: 40px;
  max-width: 100%;
  padding: 0.3rem 0.7rem 0.3rem 0.45rem;
  background: var(--bg-surface);
  border: var(--border-width-thin) solid var(--border-main);
  border-radius: var(--radius-pill);
  font-family: inherit;
  font-size: var(--text-sm);
  color: var(--text-primary);
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast),
    transform var(--transition-fast) var(--ease-standard);
}

.chip:hover,
.chip:focus-visible {
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 7%, var(--bg-surface));
}

/* Presses in rather than lifting: the chip is going onto the list, not away. */
.chip:active {
  transform: scale(0.97);
}

.chip__emoji {
  flex-shrink: 0;
  font-size: var(--text-md);
  line-height: 1;
}

/* The catalog carries some long names; the emoji does most of the recognising,
   so the tail can go rather than the row wrapping to three lines. */
.chip__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The same plus as the add button, at the size of a hint: what the tap does,
   said once per chip without a word. */
.chip__plus {
  flex-shrink: 0;
  width: 0.85rem;
  height: 0.85rem;
  margin-left: 0.05rem;
  background-color: var(--color-primary);
  mask: url('../assets/plus.svg') no-repeat center / contain;
  -webkit-mask: url('../assets/plus.svg') no-repeat center / contain;
}

@media (prefers-reduced-motion: reduce) {
  .chip {
    transition: border-color var(--transition-fast), background var(--transition-fast);
  }

  .chip:active {
    transform: none;
  }
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
