<script setup>
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
      <svg v-else viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.input-row {
  display: flex;
  align-items: center;
  border: 1.5px solid var(--border-main);
  border-radius: var(--radius-xl);
  background: var(--bg-surface);
  transition: border-color 0.15s;
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
  font-size: 0.95rem;
  color: var(--text-primary);
  outline: none;
  min-width: 0;
}

.input-row input::placeholder {
  color: var(--text-disabled);
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
}

.input--uppercase {
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-weight: 700;
}

.submit-btn {
  width: var(--size-control-md);
  height: var(--size-control-md);
  flex-shrink: 0;
  margin: 4px;
  background: var(--color-primary);
  color: var(--bg-surface);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: opacity 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.submit-btn svg {
  width: var(--size-icon-lg);
  height: var(--size-icon-lg);
}

.submit-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.spinner {
  width: var(--size-icon-lg);
  height: var(--size-icon-lg);
  border: 2px solid var(--spinner-stroke);
  border-top-color: var(--bg-surface);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
