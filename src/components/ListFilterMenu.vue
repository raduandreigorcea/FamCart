<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import slidersIcon from '../assets/sliders-horizontal.svg?raw'
import checkIcon from '../assets/check.svg?raw'

// The button that filters the list, and the menu it opens.
//
// Ticking a row leaves it where it sits (see sortItemsForDisplay) so a list you
// are working down never reshuffles under you. The cost is that a long list
// mixes what you still need with what is already in the cart; this is the way
// back out of that.
//
// Follows the family switcher in AppTopbar: teleported past the list's stacking
// context, a full-screen overlay to catch the outside click, and menuitemradio
// rows with a check on the chosen one. On a phone it lands as a bottom sheet
// instead of a popover — a menu anchored to a control near the top of the
// screen is a reach, and thumbs live at the bottom.
const model = defineModel({ type: String, default: 'all' })

const props = defineProps({
  // Every item, checked and unchecked. Counts are derived here rather than
  // passed in, so a row's number can never disagree with what picking it shows.
  items: { type: Array, default: () => [] },
})

const open = ref(false)
const btnEl = ref(null)

// Where the popover hangs on a wide screen. Measured from the button rather
// than written as a fixed offset from the top of the page: the add form above
// it changes height (the suggestions dropdown, a wrapped family name), and a
// magic number drifts the first time any of that moves.
//
// Null on a phone, where the menu is a bottom sheet and the stylesheet owns its
// position entirely.
const anchor = ref(null)

const isWide = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(min-width: 600px)').matches

function measure() {
  if (!open.value || !btnEl.value || !isWide()) {
    anchor.value = null
    return
  }
  const rect = btnEl.value.getBoundingClientRect()
  anchor.value = {
    top: `${Math.round(rect.bottom + 8)}px`,
    right: `${Math.round(window.innerWidth - rect.right)}px`,
  }
}

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

function choose(value) {
  model.value = value
  open.value = false
}

function onKeydown(e) {
  if (e.key === 'Escape') open.value = false
}

// A resize can cross the sheet/popover breakpoint or move the button, and
// re-measuring is cheaper than reasoning about which happened.
function onResize() {
  measure()
}

// Bound only while the menu is open; a document listener that outlives the menu
// would swallow Escape for the modals above it.
watch(open, (isOpen) => {
  if (typeof document === 'undefined') return
  if (isOpen) {
    measure()
    document.addEventListener('keydown', onKeydown)
    window.addEventListener('resize', onResize)
  } else {
    anchor.value = null
    document.removeEventListener('keydown', onKeydown)
    window.removeEventListener('resize', onResize)
  }
})

onBeforeUnmount(() => {
  if (typeof document === 'undefined') return
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onResize)
})
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

  <Teleport to="body">
    <Transition name="filter-menu">
      <div v-if="open" class="filter-overlay" @click.self="open = false">
        <div class="filter-menu" :style="anchor" role="menu" aria-label="Filter items">
          <p class="filter-menu__heading">Show</p>
          <button
            v-for="option in OPTIONS"
            :key="option.value"
            type="button"
            class="filter-menu__item"
            :class="{ 'filter-menu__item--active': model === option.value }"
            role="menuitemradio"
            :aria-checked="model === option.value"
            @click="choose(option.value)"
          >
            <span class="filter-menu__text">
              <span class="filter-menu__label">{{ option.label }}</span>
              <span class="filter-menu__hint">{{ option.hint }}</span>
            </span>
            <span class="filter-menu__count">{{ counts[option.value] }}</span>
            <span
              v-if="model === option.value"
              class="filter-menu__check"
              aria-hidden="true"
              v-html="checkIcon"
            ></span>
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.filter-btn {
  position: relative;
  flex-shrink: 0;
  /* 32px box around a 15px icon. Smaller than a primary control — this sits in
     a meta line, not in the flow of the list — but still a real tap target,
     which is why the hit area is padded out below. */
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

.filter-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
}

.filter-menu {
  position: fixed;
  background: var(--bg-surface);
  border: var(--border-width-thin) solid var(--border-main);
  box-shadow: var(--elevation-modal);
  padding: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.filter-menu__heading {
  margin: var(--space-2) var(--space-3) var(--space-1);
  font-size: var(--text-2xs);
  font-weight: var(--weight-extrabold);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-disabled);
}

.filter-menu__item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  /* 48px tall on touch: this is the whole point of the sheet. */
  min-height: 48px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-lg);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: background var(--transition-fast);
}

.filter-menu__item:hover {
  background: var(--bg-hover);
}

.filter-menu__item--active {
  background: var(--bg-hover);
}

.filter-menu__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.filter-menu__label {
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
  line-height: 1.3;
}

.filter-menu__hint {
  font-size: var(--text-2xs);
  color: var(--text-secondary);
  line-height: 1.3;
}

.filter-menu__count {
  flex-shrink: 0;
  min-width: 1.5rem;
  text-align: right;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  color: var(--text-disabled);
  font-variant-numeric: tabular-nums;
}

.filter-menu__check {
  flex-shrink: 0;
  width: var(--size-icon-md);
  height: var(--size-icon-md);
  color: var(--color-primary);
  display: block;
}

.filter-menu__check :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  stroke: currentColor;
  stroke-width: 2.5;
  fill: none;
}

/* ─── Phone: a bottom sheet ──────────────────────────────────────────────────
   The button sits in a meta line near the top of the screen. Hanging a popover
   off it puts the choices where a thumb cannot reach, so on a phone the menu
   comes up from the bottom at full width instead, and the backdrop dims. */
.filter-overlay {
  background: var(--backdrop);
}

.filter-menu {
  left: 0;
  right: 0;
  bottom: 0;
  border-radius: var(--radius-3xl) var(--radius-3xl) 0 0;
  border-bottom: none;
  padding-bottom: calc(var(--space-3) + var(--safe-bottom));
}

/* The grab handle that says "this came up from the bottom". Sheet only. */
.filter-menu::before {
  content: '';
  display: block;
  width: 36px;
  height: 4px;
  margin: var(--space-1) auto var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--border-main);
}

.filter-menu-enter-active,
.filter-menu-leave-active {
  transition: opacity var(--transition-fast) ease;
}

.filter-menu-enter-active .filter-menu,
.filter-menu-leave-active .filter-menu {
  transition: transform var(--transition-base) cubic-bezier(0.22, 1, 0.36, 1);
}

.filter-menu-enter-from,
.filter-menu-leave-to {
  opacity: 0;
}

.filter-menu-enter-from .filter-menu,
.filter-menu-leave-to .filter-menu {
  transform: translateY(100%);
}

/* ─── Pointer / wide: a popover on the button ─────────────────────────────────
   Right-aligned to the content column, which is where the button is. No dim:
   the switcher's overlay is transparent and this is the same kind of control. */
@media (min-width: 600px) {
  .filter-overlay {
    background: transparent;
  }

  /* top/right come from the measured button (see anchor); these are the
     fallback for the frame before the measurement lands. */
  .filter-menu {
    left: auto;
    right: 1.25rem;
    bottom: auto;
    top: 25vh;
    width: 264px;
    border-radius: var(--radius-2xl);
    border-bottom: var(--border-width-thin) solid var(--border-main);
    padding-bottom: var(--space-2);
  }

  .filter-menu::before {
    display: none;
  }

  .filter-menu__item {
    min-height: 0;
  }

  .filter-menu-enter-from .filter-menu,
  .filter-menu-leave-to .filter-menu {
    transform: translateY(-6px) scale(0.98);
  }
}

@media (prefers-reduced-motion: reduce) {
  .filter-menu-enter-active,
  .filter-menu-leave-active,
  .filter-menu-enter-active .filter-menu,
  .filter-menu-leave-active .filter-menu {
    transition: none;
  }

  .filter-menu-enter-from .filter-menu,
  .filter-menu-leave-to .filter-menu {
    transform: none;
  }
}
</style>
