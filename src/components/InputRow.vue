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
  border: 1.5px solid #e4e4e4;
  border-radius: 14px;
  background: #fff;
  transition: border-color 0.15s;
  overflow: hidden;
}

.input-row:focus-within {
  border-color: var(--green);
}

.input-row input {
  flex: 1;
  padding: 0.75rem 1rem;
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: 0.95rem;
  color: #1a1a1a;
  outline: none;
  min-width: 0;
}

.input-row input::placeholder {
  color: #b0b8b0;
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
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  margin: 4px;
  background: var(--green);
  color: #fff;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  transition: opacity 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.submit-btn svg {
  width: 18px;
  height: 18px;
}

.submit-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
