<script setup>
import { computed, ref } from 'vue'
import ShoppingListItem from './ShoppingListItem.vue'
import SkeletonBlock from './SkeletonBlock.vue'
import { sumActiveQuantities, sumCheckedQuantities } from '../lib/shoppingList'

// Presentational: renders the unchecked/checked sections with their move
// animations, the initial-load skeleton, and the empty state. All mutations
// stay with the parent, which owns the items.
const props = defineProps({
  items: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  showEmpty: { type: Boolean, default: false },
})

const emit = defineEmits(['toggle', 'delete', 'buy'])

const uncheckedItems = computed(() => props.items.filter((i) => !i.checked))
const checkedItems = computed(() => props.items.filter((i) => i.checked))
const leftCount = computed(() => sumActiveQuantities(props.items))
// Units, not rows: "grapes x4" counts as 4 on the buy button.
const checkedUnitCount = computed(() => sumCheckedQuantities(props.items))

const skeletonNameWidths = ['55%', '38%', '62%', '30%']

// ─── Buy action ──────────────────────────────────────────────────────────────
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

function buyChecked() {
  if (buying.value || !checkedItems.value.length) return
  const ids = checkedItems.value.map((i) => i.id)
  buying.value = true
  buttonSuccess.value = true

  if (prefersReducedMotion) {
    finishBuy(ids)
    return
  }

  drainingIds.value = ids
  // Wait out the last row's fall (its delay + one drain duration) before the
  // parent removes them, so nothing pops out mid-animation.
  const total = DRAIN_MS + Math.min(ids.length - 1, 6) * STAGGER_MS
  window.setTimeout(() => finishBuy(ids), total)
}

function finishBuy(ids) {
  emit('buy', ids)
  drainingIds.value = []
  buying.value = false
  // Let the success tick linger a beat; the bar usually unmounts before this
  // fires because the checked list just emptied. On a failed buy the parent
  // restores the items and the bar reappears cleanly in its idle state.
  window.setTimeout(() => {
    buttonSuccess.value = false
  }, 260)
}
</script>

<template>
  <div class="list-meta" v-if="items.length">
    {{ leftCount }} left
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

  <!-- List -->
  <TransitionGroup tag="ul" name="unchecked" class="item-list">
    <ShoppingListItem
      v-for="item in uncheckedItems"
      :key="item.id"
      :item="item"
      @toggle="$emit('toggle', $event)"
      @delete="$emit('delete', $event)"
    />
  </TransitionGroup>

  <Transition name="section-fade">
    <p v-if="checkedItems.length" class="section-label">Checked</p>
  </Transition>

  <TransitionGroup tag="ul" name="checked" class="item-list" :class="{ 'item-list--checked': checkedItems.length }">
    <ShoppingListItem
      v-for="(item, idx) in checkedItems"
      :key="item.id"
      :item="item"
      :draining="isDraining(item.id)"
      :drain-index="idx"
      @toggle="$emit('toggle', $event)"
      @delete="$emit('delete', $event)"
    />
  </TransitionGroup>

  <!-- Keeps the last checked row clear of the fixed buy bar. -->
  <div v-if="checkedItems.length && !loading" class="buy-bar-spacer" aria-hidden="true"></div>

  <p v-if="showEmpty" class="empty-state">
    Nothing here yet. Add your first item above!
  </p>

  <!-- Floating "buy" action: appears whenever something is checked. -->
  <Transition name="buybar">
    <div v-if="checkedItems.length && !loading" class="buy-bar-wrap">
      <button
        class="buy-bar"
        :class="{ 'buy-bar--success': buttonSuccess }"
        type="button"
        :disabled="buying"
        @click="buyChecked"
      >
        <span class="buy-bar__icon" aria-hidden="true">
          <svg class="buy-bar__cart" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="8" cy="21" r="1" />
            <circle cx="19" cy="21" r="1" />
            <path d="M2.5 3h2l2.4 12.4a2 2 0 0 0 2 1.6h9.3a2 2 0 0 0 2-1.5L23 7H6" />
          </svg>
          <svg class="buy-bar__check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
        <span class="buy-bar__label">
          <template v-if="buttonSuccess">Bought!</template>
          <template v-else>Buy {{ checkedUnitCount }} {{ checkedUnitCount === 1 ? 'item' : 'items' }}</template>
        </span>
      </button>
    </div>
  </Transition>
</template>

<style scoped>
/* Meta */
.list-meta {
  text-align: right;
  margin-top: 0.15rem;
  margin-bottom: 0.9rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-disabled);
}

/* Mirrors ShoppingListItem's .item card so rows swap in without layout shift */
.skeleton-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: var(--bg-surface);
  border-radius: var(--radius-xl);
  padding: 0.875rem 0.875rem 0.875rem 0.75rem;
  border: 1.5px solid var(--border-main);
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

.item-list--checked {
  margin-top: 0.4rem;
}

.unchecked-move,
.checked-move {
  transition: transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}

.unchecked-enter-active,
.checked-enter-active {
  transition: opacity 0.32s ease, transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
}

.unchecked-leave-active,
.checked-leave-active {
  transition: opacity 0.24s ease, transform 0.24s ease;
  position: absolute;
  width: 100%;
  pointer-events: none;
  z-index: 2;
}

.unchecked-enter-from {
  opacity: 0;
  transform: translateY(-8px) scale(0.995);
}

.unchecked-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.995);
}

.checked-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(0.995);
}

.checked-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.995);
}

.section-fade-enter-active,
.section-fade-leave-active {
  transition: opacity 0.18s ease;
}

.section-fade-enter-from,
.section-fade-leave-to {
  opacity: 0;
}

.section-label {
  margin: 1rem 0 0.45rem;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-disabled);
}

/* Empty state */
.empty-state {
  text-align: center;
  font-size: 0.875rem;
  color: var(--text-disabled);
  margin: 2.5rem 0;
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
  width: 100%;
  max-width: 480px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  min-height: 54px;
  padding: 0 1.25rem;
  border: none;
  border-radius: var(--radius-pill);
  background: var(--color-primary);
  color: var(--text-inverse);
  font-size: 0.98rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  cursor: pointer;
  box-shadow: var(--elevation-primary, 0 10px 24px rgba(0, 0, 0, 0.22));
  transition: transform 0.16s ease, background 0.25s ease, box-shadow 0.2s ease;
}

.buy-bar:hover:not(:disabled) {
  transform: translateY(-1px);
}

.buy-bar:active:not(:disabled) {
  transform: translateY(1px) scale(0.995);
}

.buy-bar--success {
  cursor: default;
}

.buy-bar__icon {
  position: relative;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}

.buy-bar__cart,
.buy-bar__check {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  transition: opacity 0.24s ease, transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
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
  transition: opacity 0.22s ease, transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

.buybar-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.buybar-enter-from,
.buybar-leave-to {
  opacity: 0;
  transform: translateY(16px);
}

@media (prefers-reduced-motion: reduce) {
  .buy-bar,
  .buy-bar__cart,
  .buy-bar__check,
  .buybar-enter-active,
  .buybar-leave-active {
    transition: none;
  }
}
</style>
