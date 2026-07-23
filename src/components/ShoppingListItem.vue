<script setup>
import { computed, ref } from 'vue'
import { getProductEmoji } from '../lib/productEmoji'

const props = defineProps({
  item: {
    type: Object,
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
  // Author avatar/name, resolved live from the family roster by item.added_by —
  // the row itself no longer carries a copied name/photo.
  avatarUrl: {
    type: String,
    default: null,
  },
  avatarName: {
    type: String,
    default: 'Member',
  },
})

const emit = defineEmits(['toggle', 'delete'])

// ── Swipe gestures ──────────────────────────────────────────────────────────
// Swipe the row right to check/uncheck, left to delete — the two things you do
// to a shopping-list item. A short press with no travel is a tap, which also
// toggles (the keyboard/mouse path). touch-action:pan-y on the face lets the
// list scroll vertically while we own the horizontal drag.
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

let pointerId = null
let startX = 0
let startY = 0
let axis = null // 'x' once we've committed to a horizontal drag, 'y' for a scroll

const triggerFor = (value) => (value > 0 ? TRIGGER_CHECK : TRIGGER_DELETE)

// 0..1 toward the active side's commit distance. Drives the icon and label, so
// the panel reads as a gauge filling up rather than a fixed backdrop.
const pullProgress = computed(() => {
  if (!offset.value) return 0
  return Math.min(1, Math.abs(offset.value) / triggerFor(offset.value))
})

// Follow the finger 1:1 up to the commit distance, then push back hard. The row
// visibly slows at exactly the point where the action arms, so the threshold is
// something you feel rather than something you guess at.
function resist(dx) {
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

function onPointerDown(event) {
  // Ignore secondary buttons and anything mid-drain.
  if (props.draining || (event.pointerType === 'mouse' && event.button !== 0)) return
  pointerId = event.pointerId
  startX = event.clientX
  startY = event.clientY
  axis = null
}

function onPointerMove(event) {
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
      event.currentTarget.setPointerCapture?.(pointerId)
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

function onPointerUp(event) {
  if (pointerId !== event.pointerId) return
  const swiped = axis === 'x'
  const tapped = axis === null
  const committed = armed.value
  pointerId = null

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

  // Only a press that never became a drag counts as a tap. A gesture that
  // resolved as a scroll has to end as a scroll: releasing your finger after
  // dragging the list past a row must not toggle that row.
  if (tapped) emit('toggle', props.item)
  settle()
}

function settle() {
  dragging.value = false
  armed.value = false
  offset.value = 0
  axis = null
}

function onKeydown(event) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    emit('toggle', props.item)
  }
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
      <svg class="item-action__icon" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
        <polyline points="2,7 6,11 12,3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
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
      <svg class="item-action__icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6m2 0v9a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 6 15V6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>

    <div
      class="item-face"
      :class="{ 'item-face--dragging': dragging }"
      :style="{ transform: `translateX(${offset}px)` }"
      role="button"
      tabindex="0"
      :aria-pressed="item.checked"
      :aria-label="`${item.name}${item.checked ? ', checked' : ''}. Swipe right to ${item.checked ? 'uncheck' : 'check'}, left to remove`"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="settle"
      @keydown="onKeydown"
    >
      <span class="item-emoji" aria-hidden="true">{{ getProductEmoji(item.name, item.maker || '') }}</span>
      <span class="item-text">
        <span class="item-name">{{ item.name }}</span>
        <span v-if="item.maker" class="item-maker">{{ item.maker }}</span>
      </span>
      <span v-if="item.quantity > 1" class="item-qty">x{{ item.quantity }}</span>
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
  color: #fff;
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
  transform: scale(calc(0.72 + var(--pull, 0) * 0.28));
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

.item-face:focus-visible {
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
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 10%, var(--bg-surface));
  border: var(--border-width-thin) solid color-mix(in srgb, var(--color-primary) 28%, var(--bg-surface));
  border-radius: var(--radius-pill);
  padding: 0.15rem 0.45rem;
}
</style>
