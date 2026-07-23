<script setup>
import arrowRightIcon from '../assets/arrow-right.svg?raw'

defineProps({
  modelValue: String,
  type: { type: String, default: 'text' },
  placeholder: String,
  autocomplete: String,
  maxlength: [String, Number],
  required: Boolean,
  autofocus: Boolean,
  loading: { type: Boolean, default: false },
  uppercase: { type: Boolean, default: false },
})

defineEmits(['update:modelValue'])
</script>

<template>
  <div class="input-row">
    <input
      :value="modelValue"
      :type="type"
      :placeholder="placeholder"
      :autocomplete="autocomplete"
      :maxlength="maxlength"
      :required="required"
      :autofocus="autofocus"
      :class="{ 'input--uppercase': uppercase }"
      @input="$emit('update:modelValue', $event.target.value)"
    />
    <button type="submit" class="submit-btn" :disabled="loading" aria-label="Continue">
      <span v-if="loading" class="spinner"></span>
      <span v-else class="submit-btn__icon" aria-hidden="true" v-html="arrowRightIcon"></span>
    </button>
  </div>
</template>

<style scoped>
.input-row {
  display: flex;
  align-items: center;
  border: var(--border-width-base) solid var(--border-main);
  border-radius: var(--radius-xl);
  background: var(--bg-surface);
  transition: border-color var(--transition-fast);
  overflow: hidden;
}

.input-row:focus-within {
  border-color: var(--color-primary);
}

.input-row input {
  flex: 1;
  padding: var(--space-3) var(--space-4);
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: var(--text-md);
  color: var(--text-primary);
  outline: none;
  min-width: 0;
}

.input-row input::placeholder {
  color: var(--text-disabled);
  font-weight: var(--weight-regular);
  letter-spacing: 0;
  text-transform: none;
}

.input--uppercase {
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-weight: var(--weight-bold);
}

.submit-btn {
  width: var(--size-control-md);
  height: var(--size-control-md);
  flex-shrink: 0;
  margin: 4px;
  background: var(--color-primary);
  color: var(--text-inverse);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: opacity var(--transition-fast);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.submit-btn__icon {
  width: var(--size-icon-lg);
  height: var(--size-icon-lg);
  display: inline-flex;
}

/* The asset ships at stroke-width 1 for a 24px box; weight it for this size. */
.submit-btn__icon :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  stroke: currentColor;
  stroke-width: 2;
}

.submit-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.spinner {
  width: var(--size-icon-lg);
  height: var(--size-icon-lg);
  border: var(--border-width-thick) solid var(--spinner-stroke);
  border-top-color: var(--text-inverse);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
