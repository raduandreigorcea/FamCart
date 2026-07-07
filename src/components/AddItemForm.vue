<script setup>
import { ref } from 'vue'
import ErrorMessage from './ErrorMessage.vue'

// Presentational: name/quantity state lives in the parent (via v-model) so the
// add flow can restore values when an optimistic insert fails.
const name = defineModel('name', { type: String, default: '' })
const quantity = defineModel('quantity', { type: Number, default: 1 })

defineProps({
  adding: { type: Boolean, default: false },
  error: { type: String, default: '' },
  maxLength: { type: Number, default: 120 },
})

const emit = defineEmits(['submit'])

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
        <div class="qty-value-wrap" aria-live="polite">
          <Transition :name="qtyDirection === 'up' ? 'qty-slide-up' : 'qty-slide-down'" mode="out-in">
            <span :key="quantity" class="qty-value">{{ quantity }}</span>
          </Transition>
        </div>
        <div class="qty-buttons">
        <button
          type="button"
          class="qty-btn"
          @click="increaseQty"
          :disabled="quantity >= 99 || adding"
          aria-label="Increase quantity"
        >
          <span class="qty-icon qty-icon--plus"></span>
        </button>
        <button
          type="button"
          class="qty-btn"
          @click="decreaseQty"
          :disabled="quantity <= 1 || adding"
          aria-label="Decrease quantity"
        >
          <span class="qty-icon qty-icon--minus"></span>
        </button>
        </div>
      </div>
      <input
        v-model="name"
        type="text"
        placeholder="Add an item…"
        :maxlength="maxLength"
        autocomplete="off"
      />
      <button type="submit" class="add-btn" :disabled="adding || !name.trim()" aria-label="Add">
        <span v-if="adding" class="spinner"></span>
        <span v-else class="add-icon"></span>
      </button>
    </div>
    <ErrorMessage :message="error" />
  </form>
</template>

<style scoped>
.add-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1.25rem;
}

.add-row {
  display: flex;
  align-items: center;
  background: var(--bg-surface);
  border: 1.5px solid var(--border-main);
  border-radius: var(--radius-2xl);
  overflow: hidden;
  transition: border-color 0.15s;
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
  font-size: 0.95rem;
  color: var(--text-primary);
  outline: none;
  min-width: 0;
}

.add-row input::placeholder {
  color: var(--text-disabled);
}

.qty-picker {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  border-right: 1px solid var(--border-main);
  padding: 0.2rem 0.5rem;
  margin-right: 0.2rem;
}

.qty-buttons {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
}

.qty-btn {
  width: 24px;
  height: 24px;
  border: 1px solid var(--border-main);
  background: var(--bg-surface);
  color: var(--text-secondary);
  border-radius: var(--radius-xs);
  cursor: pointer;
  line-height: 1;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.qty-icon {
  width: var(--size-icon-sm);
  height: var(--size-icon-sm);
  background-color: var(--text-secondary);
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
  opacity: 0.4;
  cursor: not-allowed;
}

.qty-value-wrap {
  min-width: 1.8rem;
  height: 1.1rem;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.qty-value {
  min-width: 1.6rem;
  text-align: center;
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--text-primary);
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
  transition: opacity 0.15s;
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
  border: 2px solid var(--spinner-stroke);
  border-top-color: var(--text-inverse);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>

