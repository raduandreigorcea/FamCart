<script setup>
import { computed, ref } from 'vue'
import PopoverMenu from './PopoverMenu.vue'
import slidersIcon from '../assets/sliders-horizontal.svg?raw'
import checkIcon from '../assets/check.svg?raw'

// The button that filters the list, and the rows it offers. PopoverMenu owns
// the panel itself — where it lands, how it dismisses, what a row looks like.
//
// Ticking a row leaves it where it sits (see sortItemsForDisplay) so a list you
// are working down never reshuffles under you. The cost is that a long list
// mixes what you still need with what is already in the cart; this is the way
// back out of that.
const model = defineModel({ type: String, default: 'all' })

const props = defineProps({
  // Every item, checked and unchecked. Counts are derived here rather than
  // passed in, so a row's number can never disagree with what picking it shows.
  items: { type: Array, default: () => [] },
})

const open = ref(false)
const btnEl = ref(null)

const counts = computed(() => {
  const checked = props.items.filter((i) => i.checked).length
  return { all: props.items.length, active: props.items.length - checked, checked }
})

// "In cart" rather than "Bought": a checked row is not bought until the buy bar
// checks it out, which is what moves it into purchase history.
const OPTIONS = [
  { value: 'all', label: 'Everything', hint: 'Both lists together' },
  { value: 'active', label: 'To buy', hint: 'Still to pick up' },
  { value: 'checked', label: 'In cart', hint: 'Ticked, not checked out' },
]

// A filtered list that looks unfiltered is how items get declared missing, so
// the button carries a mark whenever it is hiding something.
const isFiltered = computed(() => model.value !== 'all')
</script>

<template>
  <button
    ref="btnEl"
    type="button"
    class="filter-btn"
    :class="{ 'filter-btn--on': isFiltered }"
    aria-haspopup="menu"
    :aria-expanded="open"
    :aria-label="isFiltered ? 'Filter items (filtered)' : 'Filter items'"
    @click="open = !open"
  >
    <span class="filter-btn__icon" aria-hidden="true" v-html="slidersIcon"></span>
    <span v-if="isFiltered" class="filter-btn__dot" aria-hidden="true"></span>
  </button>

  <PopoverMenu v-model="open" :trigger="btnEl" align="right" label="Filter items">
    <template #default="{ close }">
      <p class="menu-heading">Show</p>
      <button
        v-for="option in OPTIONS"
        :key="option.value"
        type="button"
        class="menu-item filter-option"
        :class="{ 'menu-item--active': model === option.value }"
        role="menuitemradio"
        :aria-checked="model === option.value"
        @click="((model = option.value), close())"
      >
        <span class="filter-option__text">
          <span class="filter-option__label">{{ option.label }}</span>
          <span class="filter-option__hint">{{ option.hint }}</span>
        </span>
        <span class="filter-option__count">{{ counts[option.value] }}</span>
        <span
          v-if="model === option.value"
          class="menu-check"
          aria-hidden="true"
          v-html="checkIcon"
        ></span>
      </button>
    </template>
  </PopoverMenu>
</template>

<style scoped>
.filter-btn {
  position: relative;
  flex-shrink: 0;
  /* 32px box around a 15px icon. Smaller than a primary control — this sits in
     a meta line, not in the flow of the list — but the negative margin pushes
     its hit area back out over the row's padding. */
  width: var(--size-control-sm);
  height: var(--size-control-sm);
  margin: -0.35rem -0.35rem -0.35rem 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-disabled);
  border-radius: var(--radius-md);
  cursor: pointer;
  padding: 0;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.filter-btn:hover,
.filter-btn[aria-expanded='true'] {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.filter-btn--on {
  color: var(--color-primary);
}

.filter-btn__icon {
  width: 15px;
  height: 15px;
  display: block;
}

/* The asset ships at stroke-width 1, too fine to read at this size. */
.filter-btn__icon :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  stroke: currentColor;
  stroke-width: 2;
  fill: none;
}

.filter-btn__dot {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-primary);
  border: var(--border-width-thin) solid var(--bg-page);
}

/* Row internals; the row's own box comes from PopoverMenu's .menu-item. */
.filter-option__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.filter-option__label {
  line-height: 1.3;
}

.filter-option__hint {
  font-size: var(--text-2xs);
  font-weight: var(--weight-regular);
  color: var(--text-secondary);
  line-height: 1.3;
}

.filter-option__count {
  flex-shrink: 0;
  min-width: 1.5rem;
  text-align: right;
  font-size: var(--text-sm);
  color: var(--text-disabled);
  font-variant-numeric: tabular-nums;
}
</style>
