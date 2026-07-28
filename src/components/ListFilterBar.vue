<script setup>
import { computed } from 'vue'
import slidersIcon from '../assets/sliders-horizontal.svg?raw'

// Presentational: the parent owns the list and the chosen filter, this only
// renders the choices and reports a pick.
//
// Ticking a row leaves it where it sits (see sortItemsForDisplay) so a list you
// are working down never reshuffles under you. The cost is that a long list
// mixes what you still need with what is already in the cart, and this is the
// way back out of that.
const model = defineModel({ type: String, default: 'all' })

const props = defineProps({
  // Every item in the list, checked and unchecked. Counts come from here rather
  // than from the parent so the bar can never disagree with what it filters.
  items: { type: Array, default: () => [] },
})

const counts = computed(() => {
  const checked = props.items.filter((i) => i.checked).length
  return { all: props.items.length, active: props.items.length - checked, checked }
})

// "In cart" rather than "Bought": a checked row is not bought until the buy bar
// checks it out, which is what moves it to purchase history.
const FILTERS = [
  { value: 'all', label: 'All', key: 'all' },
  { value: 'active', label: 'To buy', key: 'active' },
  { value: 'checked', label: 'In cart', key: 'checked' },
]
</script>

<template>
  <div class="filter-bar" role="group" aria-label="Filter items">
    <span class="filter-bar__icon" aria-hidden="true" v-html="slidersIcon"></span>
    <div class="filter-bar__options">
      <button
        v-for="filter in FILTERS"
        :key="filter.value"
        type="button"
        class="filter-chip"
        :class="{ 'filter-chip--active': model === filter.value }"
        :aria-pressed="model === filter.value"
        @click="model = filter.value"
      >
        {{ filter.label }}
        <span class="filter-chip__count">{{ counts[filter.key] }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.filter-bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
  /* Lines up with .list-meta below, which pads its label by the same amount. */
  padding: 0 0.15rem;
}

.filter-bar__icon {
  flex-shrink: 0;
  width: var(--size-icon-md);
  height: var(--size-icon-md);
  color: var(--text-disabled);
  display: inline-flex;
}

/* The asset ships at stroke-width 1, too fine to read at 16px. */
.filter-bar__icon :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  stroke: currentColor;
  stroke-width: 2;
  fill: none;
}

/* Scrolls rather than wraps: a second row would push the list down every time a
   filter is added, and there are more coming than these three. */
.filter-bar__options {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  overflow-x: auto;
  scrollbar-width: none;
}

.filter-bar__options::-webkit-scrollbar {
  display: none;
}

.filter-chip {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.65rem;
  border: var(--border-width-thin) solid var(--border-main);
  border-radius: var(--radius-pill);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-family: inherit;
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  line-height: 1.4;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast),
    color var(--transition-fast);
}

.filter-chip:hover:not(.filter-chip--active) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.filter-chip--active {
  background: color-mix(in srgb, var(--color-primary) 12%, var(--bg-surface));
  border-color: color-mix(in srgb, var(--color-primary) 40%, transparent);
  color: var(--color-primary);
  cursor: default;
}

/* Tabular so the chips do not resize as items are ticked, which would shift the
   ones beside them mid-tap. */
.filter-chip__count {
  font-variant-numeric: tabular-nums;
  font-weight: var(--weight-bold);
  opacity: 0.75;
}

@media (prefers-reduced-motion: reduce) {
  .filter-chip {
    transition: none;
  }
}
</style>
