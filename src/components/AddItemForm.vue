<script setup>
import { ref } from 'vue'
import { getProductEmoji } from '../lib/productEmoji'
import SkeletonBlock from './SkeletonBlock.vue'
import { productKey } from '../lib/productSearch'

// Presentational: name/quantity state lives in the parent (via v-model) so the
// add flow can restore values when an optimistic insert fails. The suggestions
// list is likewise owned by the parent (it queries the product catalog); this
// component only renders it and reports the pick.
const name = defineModel('name', { type: String, default: '' })
const quantity = defineModel('quantity', { type: Number, default: 1 })

defineProps({
  adding: { type: Boolean, default: false },
  maxLength: { type: Number, default: 120 },
  // Product catalog matches for the current input: [{ name, maker }].
  suggestions: { type: Array, default: () => [] },
  // A search is running (or debouncing) for what is currently typed, so the
  // matches below are not the answer yet.
  suggestionsLoading: { type: Boolean, default: false },
  // Whether to offer the "add your own" escape hatch. Owned by the parent,
  // which knows when the query is long enough to have been searched for.
  canAddCustom: { type: Boolean, default: false },
})

// Uneven widths so the placeholder reads as products rather than a bar chart.
const skeletonWidths = ['58%', '41%', '66%']

const emit = defineEmits(['submit', 'select', 'add-custom'])

// The dropdown shows only while the input has focus; mousedown.prevent on the
// options keeps focus in the input, so picking one never races the blur.
const inputFocused = ref(false)

function selectSuggestion(product) {
  emit('select', product)
}

const qtyDirection = ref('up')

function increaseQty() {
  qtyDirection.value = 'up'
  quantity.value = Math.min(99, quantity.value + 1)
}

function decreaseQty() {
  qtyDirection.value = 'down'
  quantity.value = Math.max(1, quantity.value - 1)
}
</script>

<template>
  <form class="add-form" @submit.prevent="emit('submit')">
    <div class="add-row">
      <div class="qty-picker" aria-label="Item quantity">
        <button
          type="button"
          class="qty-btn"
          @click="decreaseQty"
          :disabled="quantity <= 1 || adding"
          aria-label="Decrease quantity"
        >
          <span class="qty-icon qty-icon--minus"></span>
        </button>
        <div class="qty-value-wrap" aria-live="polite">
          <Transition :name="qtyDirection === 'up' ? 'qty-slide-up' : 'qty-slide-down'" mode="out-in">
            <span :key="quantity" class="qty-value">{{ quantity }}</span>
          </Transition>
        </div>
        <button
          type="button"
          class="qty-btn"
          @click="increaseQty"
          :disabled="quantity >= 99 || adding"
          aria-label="Increase quantity"
        >
          <span class="qty-icon qty-icon--plus"></span>
        </button>
      </div>
      <input
        v-model="name"
        type="text"
        placeholder="Add an item…"
        :maxlength="maxLength"
        autocomplete="off"
        @focus="inputFocused = true"
        @blur="inputFocused = false"
        @keydown.esc="inputFocused = false"
      />
      <button type="submit" class="add-btn" :disabled="adding || !name.trim()" aria-label="Add">
        <span v-if="adding" class="spinner"></span>
        <span v-else class="add-icon"></span>
      </button>
    </div>

    <!-- Opens whenever there is something to say: a search in flight, matches,
         the escape hatch, or some combination. With no matches the hatch is the
         whole dropdown — which is exactly the moment the user most needs it. -->
    <div
      v-if="inputFocused && (suggestionsLoading || suggestions.length || canAddCustom)"
      class="suggestions-wrap"
    >
      <ul
        class="suggestions"
        role="listbox"
        aria-label="Product suggestions"
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
        <li v-for="product in suggestions" :key="productKey(product.name, product.maker)">
          <button
            type="button"
            class="suggestion"
            role="option"
            @mousedown.prevent="selectSuggestion(product)"
          >
            <span class="suggestion-emoji" aria-hidden="true">
              {{ getProductEmoji(product.name, product.maker || '') }}
            </span>
            <span class="suggestion-text">
              <span class="suggestion-name">{{ product.name }}</span>
              <span v-if="product.maker" class="suggestion-maker">{{ product.maker }}</span>
            </span>
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
    </div>
  </form>
</template>

<style scoped>
.add-form {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1.25rem;
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

.suggestion:hover,
.suggestion:focus-visible {
  background: var(--bg-hover);
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

.qty-picker {
  display: inline-flex;
  align-items: center;
  gap: 0.1rem;
  border-right: var(--border-width-thin) solid var(--border-main);
  padding: 0.3rem 0.5rem 0.3rem 0.4rem;
  margin-right: 0.1rem;
}

.qty-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  line-height: 1;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.qty-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--color-primary);
}

.qty-icon {
  width: var(--size-icon-sm);
  height: var(--size-icon-sm);
  background-color: currentColor;
}

.qty-icon--plus {
  mask: url('../assets/plus.svg') no-repeat center / contain;
  -webkit-mask: url('../assets/plus.svg') no-repeat center / contain;
}

.qty-icon--minus {
  mask: url('../assets/minus.svg') no-repeat center / contain;
  -webkit-mask: url('../assets/minus.svg') no-repeat center / contain;
}

.qty-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.qty-value-wrap {
  min-width: 1.4rem;
  height: 1.3rem;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.qty-value {
  min-width: 1.4rem;
  text-align: center;
  font-size: var(--text-md);
  font-weight: var(--weight-bold);
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.qty-slide-up-enter-active,
.qty-slide-up-leave-active,
.qty-slide-down-enter-active,
.qty-slide-down-leave-active {
  transition: transform 0.11s ease, opacity 0.11s ease;
}

.qty-slide-up-enter-from {
  transform: translateY(10px);
  opacity: 0;
}

.qty-slide-up-leave-to {
  transform: translateY(-10px);
  opacity: 0;
}

.qty-slide-down-enter-from {
  transform: translateY(-10px);
  opacity: 0;
}

.qty-slide-down-leave-to {
  transform: translateY(10px);
  opacity: 0;
}

.add-btn {
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  margin: 4px;
  margin-right: 8px;
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

.add-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
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
</style>

