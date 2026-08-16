<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, type PropType } from 'vue'
import { getProductEmoji } from '../lib/productEmoji'
import { ITEM_QUANTITY_MAX } from '../lib/limits'
import type { ShoppingItemRow } from '../lib/householdRealtime'
import checkIcon from '../assets/check.svg?raw'
import xIcon from '../assets/x.svg?raw'
import minusIcon from '../assets/minus.svg?raw'
import plusIcon from '../assets/plus.svg?raw'

const props = defineProps({
  item: {
    type: Object as PropType<ShoppingItemRow>,
    required: true
  },
  // Set while a purchase animation is playing on this checked row: it drains
  // toward the buy bar instead of using the list's normal leave transition.
  draining: {
    type: Boolean,
    default: false,
  },
  // Position among the draining rows, so they fall into the bar in a stagger.
  drainIndex: {
    type: Number,
    default: 0,
  },
  // Author avatar/name, resolved live from the household roster by item.added_by —
  // the row itself no longer carries a copied name/photo.
  avatarUrl: {
    type: String,
    default: null,
  },
  avatarName: {
    type: String,
    default: 'Member',
  },
  // Whether this row's quantity stepper is the open one. Held by the parent so
  // that opening one closes the last.
  qtyOpen: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['toggle', 'delete', 'set-quantity', 'open-quantity', 'close-quantity'])

const qty = computed(() => Number(props.item.quantity) || 1)

// ── The quantity stepper ────────────────────────────────────────────────────
// Quantity used to be picked in the add form, before the product it counted had
// been named, and could never be changed afterwards: the row printed x2 as plain
// text, so a wrong number meant deleting the item and adding it back. It lives
// here now, on the thing it describes.
//
// It opens on a press rather than sitting on every row, because a shopping list
// is mostly single items and three permanent targets per row would crowd both
// the swipe and the eye. Which row is open is the parent's to track -- only one
// at a time -- so this component only reports the press.
//
// Every control below stops its own pointer and click events. It sits inside the
// face, which is the surface the swipe reads, so a press that reached it would
// start dragging the row while a quantity was being set.
//
// There are two ways out of it, because pressing past it is not one -- the
// toggle beside it would tick the item off. So the number itself toggles, and
// the control puts itself away when left alone.

// How long the control waits, untouched, before putting itself away. Long enough
// to reach for the other button after a change, short enough that a stepper left
// open on a row you have moved on from is not still sitting there.
const QTY_IDLE_MS = 2000

let qtyIdleTimer: ReturnType<typeof setTimeout> | null = null

function clearQtyIdle() {
  if (!qtyIdleTimer) return
  clearTimeout(qtyIdleTimer)
  qtyIdleTimer = null
}

// Restarted by every press inside the control, so the countdown measures
// inactivity rather than how long the thing has been open. Setting a quantity
// from 1 to 6 is six taps and must not time out on the fourth.
function armQtyIdle() {
  clearQtyIdle()
  qtyIdleTimer = setTimeout(() => {
    qtyIdleTimer = null
    emit('close-quantity')
  }, QTY_IDLE_MS)
}

// immediate, because a row can arrive already open: the list re-renders around a
// row whose control is up (a filter change, a realtime edit landing) and Vue
// mounts a fresh component with qtyOpen already true. A plain watcher never sees
// a change there, so that row would sit open forever with nothing counting.
watch(
  () => props.qtyOpen,
  (open) => (open ? armQtyIdle() : clearQtyIdle()),
  { immediate: true },
)

// A row can be unmounted with its stepper open -- checked out, deleted, filtered
// away -- and a timer that outlives it would emit into nothing.
onBeforeUnmount(clearQtyIdle)

// A checked item is in the cart with its count settled -- the next thing that
// happens to it is a checkout, which copies the quantity into purchase history.
// So the number stays visible and stops being a control.
function toggleQty() {
  if (props.draining || props.item.checked) return
  if (props.qtyOpen) emit('close-quantity')
  else emit('open-quantity', props.item.id)
}

// A row can be ticked while its stepper is up: by a tap on the face, which does
// not go through the swipe path that closes it, or by another member's device
// over realtime. Either way the control has to come down with it, or it is left
// offering buttons for something that can no longer change.
watch(
  () => props.item.checked,
  (checked) => {
    if (checked && props.qtyOpen) emit('close-quantity')
  },
)

// Which way the number should travel on its way in and out. Set before the emit
// rather than derived from watching the quantity, because a change can also
// arrive from another member's device via realtime -- and there is no direction
// in that, only a new number.
const qtyDirection = ref<'up' | 'down'>('up')

function step(delta: number) {
  armQtyIdle()
  const next = qty.value + delta
  if (next < 1 || next > ITEM_QUANTITY_MAX) return
  qtyDirection.value = delta > 0 ? 'up' : 'down'
  emit('set-quantity', { item: props.item, quantity: next })
}

// Swiping a row with its stepper open would leave the stepper hanging over a
// moving face, so the gesture closes it on the way past.
function closeQtyForGesture() {
  if (props.qtyOpen) emit('close-quantity')
}

// ── Swipe gestures ──────────────────────────────────────────────────────────
// Swipe the row right to check/uncheck, left to delete — the two things you do
// to a shopping-list item. Only the drag lives here: a press that never travels
// is a tap, and the toggle button's own click answers that one, along with Enter
// and Space. touch-action:pan-y on the face lets the list scroll vertically
// while we own the horizontal drag.
//
// Two rules keep the gesture from firing when you didn't mean it:
//   1. Deleting asks for a longer pull than checking. A wrong check costs one
//      tap to undo; a wrong delete costs the item.
//   2. A shallow diagonal belongs to the scroller, not to us.
// And the row tells you where it stands the whole way: the panel fills in as
// you pull, then snaps to full colour, resists, and buzzes the moment letting
// go would actually do something.
const TRIGGER_CHECK = 72 // px of travel that commits a check/uncheck
const TRIGGER_DELETE = 104 // deliberately further: deleting is not reversible
const MAX_PULL = 150 // hard stop the row bottoms out against
const AXIS_LOCK = 10 // px of travel before we decide swipe vs. scroll
const AXIS_BIAS = 1.4 // how decisively sideways a swipe has to be

const offset = ref(0) // current horizontal translation of the face
const dragging = ref(false) // true only while actively tracking a horizontal drag
const armed = ref(false) // pulled far enough that releasing now commits

let pointerId: number | null = null
let startX = 0
let startY = 0
// 'x' once we've committed to a horizontal drag, 'y' for a scroll, null until
// the gesture has moved far enough to tell which it is.
let axis: 'x' | 'y' | null = null

const triggerFor = (value: number) => (value > 0 ? TRIGGER_CHECK : TRIGGER_DELETE)

// 0..1 toward the active side's commit distance. Drives the icon and label, so
// the panel reads as a gauge filling up rather than a fixed backdrop.
const pullProgress = computed(() => {
  if (!offset.value) return 0
  return Math.min(1, Math.abs(offset.value) / triggerFor(offset.value))
})

// Follow the finger 1:1 up to the commit distance, then push back hard. The row
// visibly slows at exactly the point where the action arms, so the threshold is
// something you feel rather than something you guess at.
function resist(dx: number): number {
  const dir = Math.sign(dx)
  const dist = Math.abs(dx)
  const trigger = triggerFor(dx)
  if (dist <= trigger) return dx
  const eased = trigger + (dist - trigger) * 0.45
  if (eased <= MAX_PULL) return dir * eased
  return dir * (MAX_PULL + (eased - MAX_PULL) * 0.15)
}

// A short buzz as the action arms, where the platform allows it. The colour
// change is the real signal; this is a bonus on hardware that can do it.
function tick() {
  try {
    navigator.vibrate?.(10)
  } catch {
    /* Vibration can be blocked by policy; the visual state still covers it. */
  }
}

// A drag that ends over the toggle still produces a click, and a swipe that has
// just checked the item must not immediately uncheck it. Set when a gesture
// resolves as a horizontal drag, spent by the click that follows, and cleared on
// the next press so it cannot outlive the gesture that armed it.
let swallowClick = false

function onPointerDown(event: PointerEvent) {
  // Ignore secondary buttons and anything mid-drain.
  if (props.draining || (event.pointerType === 'mouse' && event.button !== 0)) return
  swallowClick = false
  pointerId = event.pointerId
  startX = event.clientX
  startY = event.clientY
  axis = null
}

// The tap and the keyboard, in one place, because a real button gives us both.
function onToggleClick() {
  if (swallowClick) {
    swallowClick = false
    return
  }
  if (props.draining) return
  emit('toggle', props.item)
}

function onPointerMove(event: PointerEvent) {
  if (pointerId !== event.pointerId) return
  const dx = event.clientX - startX
  const dy = event.clientY - startY

  // Decide the gesture's axis once it has moved enough to tell, and require the
  // sideways component to clearly win: an ambiguous diagonal is someone
  // scrolling the list, so we bow out and never start the drag.
  if (axis === null) {
    if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return
    axis = Math.abs(dx) > Math.abs(dy) * AXIS_BIAS ? 'x' : 'y'
    if (axis === 'x') {
      dragging.value = true
      closeQtyForGesture()
      // currentTarget is the row this handler is bound to; pointerId is set
      // above on pointerdown, so both are present by here.
      ;(event.currentTarget as Element).setPointerCapture?.(pointerId as number)
    }
  }
  if (axis !== 'x') return

  offset.value = resist(dx)

  // Arm on the raw travel, not the resisted offset: they agree at the boundary,
  // and the finger's own distance is what the user is actually judging.
  const nextArmed = Math.abs(dx) >= triggerFor(dx)
  if (nextArmed !== armed.value) {
    armed.value = nextArmed
    if (nextArmed) tick()
  }
}

function onPointerUp(event: PointerEvent) {
  if (pointerId !== event.pointerId) return
  const swiped = axis === 'x'
  const committed = armed.value
  pointerId = null

  // Any horizontal drag, committed or not: the click it leaves behind belongs to
  // the gesture, not to the button it happened to finish over.
  if (swiped) swallowClick = true

  if (swiped && committed) {
    if (offset.value > 0) {
      // Swipe right: check / uncheck. Snap back so the row settles into its new
      // (checked) state rather than staying pulled aside.
      settle()
      emit('toggle', props.item)
    } else {
      // Swipe left: delete. Fling the face off-screen, then let the list remove
      // the row on the next tick.
      offset.value = -window.innerWidth
      dragging.value = false
      armed.value = false
      emit('delete', props.item)
    }
    return
  }

  // A press that never became a horizontal drag is left entirely alone. It is
  // either a tap, which the toggle button's own click handles, or a scroll --
  // and a scroll has to end as a scroll: releasing your finger after dragging
  // the list past a row must not tick that row off. The browser suppresses the
  // click after a pan, so nothing here has to tell the two apart any more.
  settle()
}

function settle() {
  dragging.value = false
  armed.value = false
  offset.value = 0
  axis = null
  // The gesture is over however it got here, so the pointer it belonged to is
  // no longer ours. onPointerUp clears this itself because its delete branch
  // deliberately does not settle — it leaves the face flung off-screen for the
  // removal animation — so the two together are what cover every exit.
  // pointercancel had only this one, and left the id behind.
  pointerId = null
}

</script>

<template>
  <li
    class="item"
    :class="{ 'item--checked': item.checked, 'item--draining': draining }"
    :style="draining ? { '--drain-index': drainIndex } : null"
  >
    <!-- Action revealed under a rightward swipe -->
    <div
      v-show="offset > 0"
      class="item-action item-action--check"
      :class="{ 'item-action--armed': armed }"
      :style="{ '--pull': pullProgress }"
      aria-hidden="true"
    >
      <span class="item-action__icon" aria-hidden="true" v-html="checkIcon"></span>
      <span class="item-action__label">{{ item.checked ? 'Uncheck' : 'Got it' }}</span>
    </div>
    <!-- Action revealed under a leftward swipe -->
    <div
      v-show="offset < 0"
      class="item-action item-action--delete"
      :class="{ 'item-action--armed': armed }"
      :style="{ '--pull': pullProgress }"
      aria-hidden="true"
    >
      <span class="item-action__label">Remove</span>
      <span class="item-action__icon" aria-hidden="true" v-html="xIcon"></span>
    </div>

    <!-- The gesture surface, and nothing more. It used to be role="button" with
         the tap and the keyboard on it, which made every control inside it an
         interactive descendant of a button -- markup a screen reader is entitled
         to flatten, and the quantity stepper is the thing it would flatten away.
         So the button is the real button below, and this is only what the finger
         drags. -->
    <div
      class="item-face"
      :class="{ 'item-face--dragging': dragging }"
      :style="{ transform: `translateX(${offset}px)` }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="settle"
    >
      <!-- Tap and Enter and Space, all from the browser rather than from three
           handlers of our own. It covers the product and its name, not the whole
           row: the avatar says who added it and the stepper counts it, and
           neither was ever a thing to press to tick the item off. -->
      <button
        type="button"
        class="item-toggle"
        :aria-pressed="item.checked"
        :aria-label="`${item.name}${qty > 1 ? `, quantity ${qty}` : ''}. Swipe right to ${item.checked ? 'uncheck' : 'check'}, left to remove`"
        @click="onToggleClick"
      >
        <span class="item-emoji" aria-hidden="true">{{ getProductEmoji(item.name, item.maker || '') }}</span>
        <span class="item-text">
          <span class="item-name">{{ item.name }}</span>
          <span v-if="item.maker" class="item-maker">{{ item.maker }}</span>
        </span>
      </button>
      <!-- The badge IS the stepper, closed. One element in both states rather
           than two that swap, because a swap can only be animated with
           mode="out-in" -- the old element has to finish leaving before the new
           one starts -- and that serialised pair is exactly what made the add
           form's stepper feel slow.

           So the minus and plus grow out of the number's sides instead, and the
           number itself never moves, never re-renders, and never changes place
           in the row. The thing you are looking at is the thing that stays put.

           A row of one carries the badge too, quietly: without it there is
           nothing to press on the rows that most need raising, and "press the
           number" stops being a rule you can rely on. -->
      <span
        class="item-qty"
        :class="{ 'item-qty--open': qtyOpen, 'item-qty--one': qty === 1 }"
        @pointerdown.stop
        @pointerup.stop
        @click.stop
      >
        <button
          type="button"
          class="item-qty__step"
          :disabled="qty <= 1"
          :tabindex="qtyOpen ? 0 : -1"
          :aria-hidden="qtyOpen ? undefined : 'true'"
          aria-label="One fewer"
          @keydown.stop
          @click.stop="step(-1)"
        >
          <span class="item-qty__glyph" aria-hidden="true" v-html="minusIcon"></span>
        </button>

        <!-- Press to open, press again to close. Paired with the idle timeout
             below, that is two ways out of a control that has no other exit --
             the row's own face is busy being the check toggle. -->
        <button
          type="button"
          class="item-qty__face"
          :disabled="item.checked"
          :aria-label="
            item.checked
              ? `Quantity ${qty}`
              : qtyOpen
                ? `Quantity ${qty}. Done`
                : `Quantity ${qty}. Change`
          "
          :aria-expanded="item.checked ? undefined : qtyOpen"
          @keydown.stop
          @click.stop="toggleQty"
        ><span class="item-qty__x" aria-hidden="true">x</span><span
            class="item-qty__value-wrap"
            aria-live="polite"
          ><Transition :name="qtyDirection === 'up' ? 'qty-up' : 'qty-down'"><span
              :key="qty"
              class="item-qty__value"
            >{{ qty }}</span></Transition></span></button>

        <button
          type="button"
          class="item-qty__step"
          :disabled="qty >= ITEM_QUANTITY_MAX"
          :tabindex="qtyOpen ? 0 : -1"
          :aria-hidden="qtyOpen ? undefined : 'true'"
          aria-label="One more"
          @keydown.stop
          @click.stop="step(1)"
        >
          <span class="item-qty__glyph" aria-hidden="true" v-html="plusIcon"></span>
        </button>
      </span>
      <img
        v-if="avatarUrl"
        :src="avatarUrl"
        :alt="avatarName + ' avatar'"
        class="item-avatar"
      />
      <span v-else class="item-avatar item-avatar--fallback" :title="avatarName">
        {{ (avatarName || '?').slice(0, 1).toUpperCase() }}
      </span>
    </div>
  </li>
</template>

<style scoped>
.item {
  position: relative;
  border-radius: var(--radius-xl);
  overflow: hidden;
  border: var(--border-width-base) solid var(--border-main);
  transition: opacity var(--transition-base);
}

.item--checked {
  opacity: 0.55;
}

/* ── Swipe action backdrops ── */
.item-action {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 1.25rem;
  color: var(--text-inverse);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

/* Held back at partial strength while the pull is still short of committing,
   then snapped to full colour the instant it arms. That snap, not the distance,
   is what tells you letting go will actually do something. */
.item-action--check {
  justify-content: flex-start;
  background: color-mix(in srgb, var(--color-primary) 55%, var(--bg-surface));
  transition: background var(--transition-fast) var(--ease-standard);
}

.item-action--check.item-action--armed {
  background: var(--color-primary);
}

.item-action--delete {
  justify-content: flex-end;
  background: color-mix(in srgb, var(--danger-solid) 55%, var(--bg-surface));
  transition: background var(--transition-fast) var(--ease-standard);
}

.item-action--delete.item-action--armed {
  background: var(--danger-solid);
}

/* Icon grows and label fades in with the pull, so the panel fills up as you go
   instead of looking the same at 5px and at 100px. */
.item-action__icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  display: inline-flex;
  transform: scale(calc(0.72 + var(--pull, 0) * 0.28));
}

/* v-html content carries no scope attribute, hence :deep. The assets ship at
   stroke-width 1 for a 24px box, which disappears at 20px on a solid panel. */
.item-action__icon :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  stroke: currentColor;
  stroke-width: 2.4;
}

.item-action--armed .item-action__icon {
  transform: scale(1.18);
  transition: transform var(--transition-fast) cubic-bezier(0.34, 1.56, 0.64, 1);
}

.item-action__label {
  opacity: var(--pull, 0);
}

/* ── Draggable face ── */
.item-face {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: var(--bg-surface);
  padding: 0.875rem 0.875rem 0.875rem 0.9rem;
  cursor: grab;
  touch-action: pan-y;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
}

/* Snap-back / settle is animated; the active drag follows the finger 1:1. */
.item-face:not(.item-face--dragging) {
  transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

.item-face--dragging {
  cursor: grabbing;
}

/* The toggle takes the whole row's height and all the width the stepper and the
   avatar leave it, so the press target is what it always was -- everything from
   the left edge up to the count. It carries the row's own padding on the sides
   it touches, because it is now the thing that reaches those edges. */
.item-toggle {
  flex: 1;
  min-width: 0;
  align-self: stretch;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: -0.875rem 0 -0.875rem -0.9rem;
  padding: 0.875rem 0 0.875rem 0.9rem;
  border: none;
  background: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: inherit;
  -webkit-tap-highlight-color: transparent;
}

/* Inset, so the ring follows the row's own edge rather than being clipped by the
   overflow: hidden on .item. */
.item-toggle:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--color-primary);
}

.item--checked .item-name {
  text-decoration: line-through;
  color: var(--text-disabled);
}

/* Buy animation: the row lifts, then drops and shrinks toward the buy bar at the
   bottom of the screen, staggered so the rows drain in one after another. */
.item--draining {
  animation: itemDrain 0.55s cubic-bezier(0.5, 0, 0.75, 0) forwards;
  animation-delay: calc(var(--drain-index, 0) * 55ms);
  pointer-events: none;
  z-index: 3;
}

@keyframes itemDrain {
  0% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  32% {
    opacity: 1;
    transform: translateY(-7px) scale(1.02);
  }
  100% {
    opacity: 0;
    transform: translateY(52px) scale(0.4);
  }
}

@media (prefers-reduced-motion: reduce) {
  .item--draining {
    animation: none;
    opacity: 0;
  }
  .item-face:not(.item-face--dragging) {
    transition: none;
  }
  .item-action--armed .item-action__icon {
    transition: none;
  }
  /* The quantity control still opens and closes -- that is a state change, not
     decoration -- it just arrives rather than travelling. The glyphs lose their
     stagger too, or they would fade in against a width that no longer moves. */
  .item-qty,
  .item-qty__face,
  .item-qty__step,
  .item-qty__glyph,
  .item-qty__x,
  .item-qty__value-wrap {
    transition: none;
  }
  /* The number still swaps, it just does not travel to get there. */
  .qty-up-enter-active,
  .qty-up-leave-active,
  .qty-down-enter-active,
  .qty-down-leave-active {
    transition: none;
  }
}

.item-emoji {
  flex-shrink: 0;
  font-size: var(--text-lg);
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.05rem;
  height: 2.05rem;
  border-radius: 0.65rem;
  background: color-mix(in srgb, var(--color-primary) 10%, var(--bg-surface));
  border: var(--border-width-thin) solid color-mix(in srgb, var(--color-primary) 22%, var(--bg-surface));
}

.item-avatar {
  width: var(--size-avatar-sm);
  height: var(--size-avatar-sm);
  border-radius: var(--radius-pill);
  object-fit: cover;
  flex-shrink: 0;
  border: var(--border-width-thin) solid var(--border-main);
}

.item-avatar--fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-hover);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.item-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.item-name {
  font-size: var(--text-md);
  color: var(--text-primary);
  line-height: 1.4;
  word-break: break-word;
}

.item-maker {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--text-secondary);
  line-height: 1.25;
}

.item--checked .item-maker {
  color: var(--text-disabled);
}

.item-qty {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--color-primary) 10%, var(--bg-surface));
  border: var(--border-width-thin) solid color-mix(in srgb, var(--color-primary) 28%, var(--bg-surface));
  padding: 0.05rem;
  transition:
    background var(--transition-base) var(--ease-standard),
    border-color var(--transition-base) var(--ease-standard);
}

/* A list is mostly rows of one, so those wear the badge without its colour --
   present enough to press, quiet enough that a full list does not read as
   covered in numbers. Open, it takes the full colour like any other: it is
   being used. */
.item-qty--one:not(.item-qty--open) {
  background: transparent;
  border-color: var(--border-main);
}

/* ── The number ────────────────────────────────────────────────────────────
   Fixed width, so counting 9 -> 10 does not shove the buttons outward mid-tap.
   Tabular figures for the same reason at one digit. */
.item-qty__face {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.5rem;
  height: 1.5rem;
  padding: 0 0.3rem;
  border: none;
  background: none;
  border-radius: var(--radius-pill);
  font-family: inherit;
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  font-variant-numeric: tabular-nums;
  color: var(--color-primary);
  cursor: pointer;
  transition: color var(--transition-base) var(--ease-standard);
}

.item-qty--one:not(.item-qty--open) .item-qty__face {
  color: var(--text-disabled);
}

/* Checked: still the count, no longer a control. No extra dimming -- the whole
   row is already at 0.55 -- just nothing that invites a press. */
.item-qty__face:disabled {
  cursor: default;
}

.item-qty__face:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-primary-soft);
}

/* ── The number that moves ─────────────────────────────────────────────────
   Counting up sends the digits upward and counting down sends them down, so the
   direction of the change is legible without reading the number. The clip is
   what makes it a counter rather than two numbers crossfading.

   Closed, it hugs the digit: the reserve is only there to stop 9 -> 10 shoving
   the plus button out from under the thumb still pressing it, and closed there
   is no button to shove. Holding it open at two digits' width instead left a
   single digit floating in the middle of the box, away from the x in front of
   it. */
.item-qty__value-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  height: 1.5rem;
  overflow: hidden;
  transition: min-width var(--transition-base) var(--ease-rise);
}

.item-qty--open .item-qty__value-wrap {
  min-width: 1.15rem;
}

.item-qty__value {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-variant-numeric: tabular-nums;
}

/* The number leaving is taken out of flow so the one arriving does not have to
   wait for it. The old add-form stepper used mode="out-in", which plays the two
   halves end to end -- 110ms out, then 110ms in -- and that is a control you
   cannot tap faster than. Overlapping them is the same journey at half the wait,
   and reads more like an odometer besides. */
.qty-up-leave-active,
.qty-down-leave-active {
  position: absolute;
  inset: 0;
}

.qty-up-enter-active,
.qty-up-leave-active,
.qty-down-enter-active,
.qty-down-leave-active {
  transition: transform 0.11s ease, opacity 0.11s ease;
}

.qty-up-enter-from {
  transform: translateY(10px);
  opacity: 0;
}

.qty-up-leave-to {
  transform: translateY(-10px);
  opacity: 0;
}

.qty-down-enter-from {
  transform: translateY(-10px);
  opacity: 0;
}

.qty-down-leave-to {
  transform: translateY(10px);
  opacity: 0;
}

/* Collapses rather than unmounting, so the number beside it does not jump the
   width of a character on the way open. Never shown on a row of one, where
   "x1" would be saying nothing twice. */
.item-qty__x {
  overflow: hidden;
  max-width: 1ch;
  opacity: 1;
  transition:
    max-width var(--transition-base) var(--ease-standard),
    opacity var(--transition-fast) var(--ease-standard);
}

.item-qty--one .item-qty__x,
.item-qty--open .item-qty__x {
  max-width: 0;
  opacity: 0;
}

/* ── The two buttons ───────────────────────────────────────────────────────
   Closed they are zero-width rather than absent: width is animatable and
   presence is not, so this is what lets them grow out of the number's sides
   instead of appearing beside it. They keep their height either way, so the
   control -- and the row -- is exactly as tall open as closed.

   Zero-width buttons are still focusable and still clickable, so both are taken
   away explicitly while they are collapsed. */
.item-qty__step {
  width: 0;
  height: 1.5rem;
  flex-shrink: 0;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: none;
  border-radius: var(--radius-pill);
  color: var(--color-primary);
  cursor: pointer;
  transition:
    width var(--transition-base) var(--ease-rise),
    opacity var(--transition-fast) var(--ease-standard),
    background var(--transition-fast) var(--ease-standard);
}

.item-qty--open .item-qty__step {
  width: 1.5rem;
  opacity: 1;
  pointer-events: auto;
}

.item-qty--open .item-qty__step:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-primary) 20%, transparent);
}

.item-qty__step:disabled {
  color: var(--text-disabled);
  cursor: not-allowed;
}

.item-qty__step:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-primary-soft);
}

/* Fades a beat behind its button's width, so the mark arrives once there is room
   for it rather than being squeezed out of a slot still opening. */
.item-qty__glyph {
  width: 13px;
  height: 13px;
  display: inline-flex;
  opacity: 0;
  transition: opacity var(--transition-fast) var(--ease-standard) 0.06s;
}

.item-qty--open .item-qty__glyph {
  opacity: 1;
}

/* The assets ship at stroke-width 1 for a 24px box; at 13px that is a hairline
   next to the bold number between them. */
.item-qty__glyph :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  stroke: currentColor;
  stroke-width: 2.5;
  fill: none;
}

</style>
