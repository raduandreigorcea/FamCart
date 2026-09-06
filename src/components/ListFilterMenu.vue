<script setup lang="ts">
import { computed, ref, type PropType } from 'vue'
import type { ShoppingItem } from '../lib/shoppingList'
import PopoverMenu from './PopoverMenu.vue'
import { t } from '../lib/i18n'
import AppIcon from './AppIcon.vue'
import ShopBadges from './ShopBadges.vue'

// The button that filters the list, and the rows it offers. PopoverMenu owns
// the panel itself — where it lands, how it dismisses, what a row looks like.
//
// Ticking a row leaves it where it sits (see sortItemsForDisplay) so a list you
// are working down never reshuffles under you. The cost is that a long list
// mixes what you still need with what is already in the cart; this is the way
// back out of that.
const model = defineModel({ type: String, default: 'all' })

// The second dimension, and independent of the first: "to buy, at Lidl" is a
// question, so these are two filters in one panel rather than one list of five
// options. NIGHTLY ONLY -- the caller passes no shops on production and the
// section does not render.
const shop = defineModel<string | null>('shop', { default: null })

const props = defineProps({
  // Every item, checked and unchecked. Counts are derived here rather than
  // passed in, so a row's number can never disagree with what picking it shows.
  items: { type: Array as PropType<ShoppingItem[]>, default: () => [] },
  // Only the shops something on THIS list is actually sold at. Derived by the
  // caller, which is the one that holds the lookup -- and derived rather than
  // fixed so the menu can never offer a shop that would empty the list.
  shops: { type: Array as PropType<string[]>, default: () => [] },
  // How many rows each shop would leave, by the same rule the list filters by.
  shopCounts: { type: Object as PropType<Record<string, number>>, default: () => ({}) },
})

const open = ref(false)
const btnEl = ref<HTMLElement | null>(null)

const counts = computed(() => {
  const checked = props.items.filter((i) => i.checked).length
  return { all: props.items.length, active: props.items.length - checked, checked }
})

// A ticked row is not bought until the buy bar checks it out, which is what
// moves it into purchase history -- so this view is the middle of those two,
// and the hint has to place it there.
//
// It says what the rows ARE rather than what has not happened to them yet.
// "Ticked, not checked out" made the reader hold "checked" and "checked out"
// side by side and work out the difference; naming the next step tells them
// where they are in the same breath, and matches the buy bar's own wording.
// A computed, not a plain const. The array is built once when this component
// sets up, so plain t() calls in it would freeze the three labels in whatever
// language was current at that moment and never follow a change made from
// settings afterwards.
const OPTIONS = computed(() => [
  { value: 'all', label: t('filter.all.label'), hint: t('filter.all.hint') },
  { value: 'active', label: t('filter.active.label'), hint: t('filter.active.hint') },
  { value: 'checked', label: t('filter.checked.label'), hint: t('filter.checked.hint') },
])

// A filtered list that looks unfiltered is how items get declared missing, so
// the button carries a mark whenever it is hiding something.
const isFiltered = computed(() => model.value !== 'all' || shop.value !== null)
</script>

<template>
  <button
    ref="btnEl"
    type="button"
    class="filter-btn"
    :class="{ 'filter-btn--on': isFiltered }"
    aria-haspopup="menu"
    :aria-expanded="open"
    :aria-label="isFiltered ? t('filter.buttonLabelFiltered') : t('filter.buttonLabel')"
    @click="open = !open"
  >
    <AppIcon class="filter-btn__icon" name="sliders-horizontal" />
    <span v-if="isFiltered" class="filter-btn__dot" aria-hidden="true"></span>
  </button>

  <PopoverMenu
    v-model="open"
    :trigger="btnEl"
    align="right"
    :label="t('filter.buttonLabel')"
    :heading="t('filter.heading')"
    :hint="t('filter.hint')"
    icon-name="sliders-horizontal"
  >
    <template #default="{ close }">
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
        <!-- Always rendered, empty on the rows that are not chosen: it holds
             the space so every label starts on the same line. -->
        <AppIcon
          class="menu-check"
          :name="model === option.value ? 'check-2' : ''"
        />
        <span class="filter-option__text">
          <span class="filter-option__label">{{ option.label }}</span>
          <span class="filter-option__hint">{{ option.hint }}</span>
        </span>
        <span class="filter-option__count">{{ counts[option.value as keyof typeof counts] }}</span>
      </button>

      <!-- The second dimension. Only what this list is actually sold at, so a
           shop offered here always has something behind it.

           A separator with a name rather than a second popover: the two filters
           combine, and putting them in different panels would hide that from
           the person setting them. role="separator" is what tells a screen
           reader the same thing the line tells everyone else. -->
      <template v-if="props.shops.length > 0">
        <p class="filter-group" role="separator">{{ t('filter.shopHeading') }}</p>

        <button
          type="button"
          class="menu-item filter-option"
          :class="{ 'menu-item--active': shop === null }"
          role="menuitemradio"
          :aria-checked="shop === null"
          @click="((shop = null), close())"
        >
          <AppIcon class="menu-check" :name="shop === null ? 'check-2' : ''" />
          <span class="filter-option__text">
            <span class="filter-option__label">{{ t('filter.shopAny.label') }}</span>
            <span class="filter-option__hint">{{ t('filter.shopAny.hint') }}</span>
          </span>
          <span class="filter-option__count">{{ props.items.length }}</span>
        </button>

        <button
          v-for="slug in props.shops"
          :key="slug"
          type="button"
          class="menu-item filter-option"
          :class="{ 'menu-item--active': shop === slug }"
          role="menuitemradio"
          :aria-checked="shop === slug"
          @click="((shop = shop === slug ? null : slug), close())"
        >
          <AppIcon class="menu-check" :name="shop === slug ? 'check-2' : ''" />
          <span class="filter-option__text">
            <!-- No hint under a shop, unlike every other row here. Its name is
                 the whole of what it is, and the line that used to sit here
                 explained the unknowns rule -- which is a fact about how empty
                 the catalog is today, not about Auchan. -->
            <span class="filter-option__label filter-option__label--shop">
              <ShopBadges :shops="[slug]" labelled />
            </span>
          </span>
          <span class="filter-option__count">{{ props.shopCounts[slug] ?? 0 }}</span>
        </button>
      </template>
    </template>
  </PopoverMenu>
</template>

<style scoped>
/* Names the second group of rows. Not a menu item, so it takes none of their
   padding rules -- only their left edge, so the labels below still line up. */
.filter-group {
  margin: 0.35rem 0 0.15rem;
  padding: 0.35rem 1rem 0.15rem;
  border-top: var(--border-width-thin) solid var(--border-light);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-disabled);
}

/* The label slot holds a mark and a name here rather than plain text. */
.filter-option__label--shop {
  display: inline-flex;
  min-width: 0;
}

/* Carries the same surface as the topbar's history and settings buttons -- a
   filled pill with a border -- one size down, because this sits in a meta line
   rather than the chrome. Bare icons in a row of muted text read as labels;
   this one has to read as something you press. */
.filter-btn {
  position: relative;
  flex-shrink: 0;
  width: var(--size-control-sm);
  height: var(--size-control-sm);
  /* The meta line is short, so the button is allowed to overhang it slightly
     rather than push the header taller. */
  margin: -0.35rem -0.15rem -0.35rem 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: var(--border-width-base) solid var(--border-main);
  background: var(--bg-hover);
  color: var(--text-secondary);
  border-radius: var(--radius-pill);
  cursor: pointer;
  padding: 0;
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    color var(--transition-fast);
}

.filter-btn:hover,
.filter-btn[aria-expanded='true'] {
  border-color: var(--color-primary);
  box-shadow: var(--focus-ring-primary-soft);
  color: var(--text-primary);
}

.filter-btn--on {
  border-color: color-mix(in srgb, var(--color-primary) 45%, transparent);
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

/* Sits on the rim rather than inside it, so the border stays unbroken. The ring
   is the page showing through, not a surface: .list-meta paints nothing, so what
   is behind the dot is the body's --bg-main.

   It read --bg-page until now, which this app has never defined. A var() with no
   fallback invalidates the whole shorthand, so the dot has been drawn with no
   ring at all since the filter button was added -- visible, but merging into the
   button's own border exactly as the line above says it must not. */
.filter-btn__dot {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-primary);
  border: var(--border-width-base) solid var(--bg-main);
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
