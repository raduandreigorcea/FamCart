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
  color: #6b7280;
  font-size: 0.82rem;
  font-family: inherit;
  cursor: pointer;
  padding: 0.45rem 0.65rem 0.45rem 0.4rem;
  border-radius: 8px;
  transition: color 0.15s, background 0.15s;
  margin-top: 0.25rem;
}

.back-btn:hover {
  color: var(--green);
  background: color-mix(in srgb, var(--green) 8%, transparent);
}

.back-btn__arrow {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
</style>
