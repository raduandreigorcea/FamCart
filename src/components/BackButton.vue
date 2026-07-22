<script setup>
defineEmits(['click'])
</script>

<template>
  <button class="back-btn" type="button" @click="$emit('click')">
    <svg class="back-btn__arrow" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span>Back</span>
  </button>
</template>

<style scoped>
.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-family: inherit;
  cursor: pointer;
  padding: 0.45rem 0.65rem 0.45rem 0.4rem;
  border-radius: var(--radius-sm);
  transition: color var(--transition-fast), background var(--transition-fast);
  margin-top: 0.25rem;
}

.back-btn:hover {
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 8%, transparent);
}

.back-btn__arrow {
  width: var(--size-icon-sm);
  height: var(--size-icon-sm);
  flex-shrink: 0;
}
</style>
