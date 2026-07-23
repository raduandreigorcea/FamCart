<script setup>
import xIcon from '../assets/x.svg?raw'

defineProps({
  ariaLabel: { type: String, default: 'Close modal' },
})

const emit = defineEmits(['click'])
</script>

<template>
  <button class="modal-close" type="button" :aria-label="ariaLabel" @click="emit('click')">
    <span class="modal-close__icon" v-html="xIcon"></span>
  </button>
</template>

<style scoped>
.modal-close {
  width: var(--size-control-sm);
  height: var(--size-control-sm);
  border-radius: var(--radius-pill);
  border: var(--border-width-thin) solid var(--border-light);
  background: var(--bg-surface-alt);
  cursor: pointer;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-base) var(--ease-standard);
  padding: 0;
}

.modal-close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  transform: rotate(90deg);
}

.modal-close__icon {
  width: var(--size-icon-md);
  height: var(--size-icon-md);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.modal-close__icon :deep(svg) {
  width: 100%;
  height: 100%;
  stroke: currentColor;
  stroke-width: 2;
  fill: none;
}
</style>