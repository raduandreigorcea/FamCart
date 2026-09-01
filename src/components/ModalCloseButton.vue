<script setup lang="ts">
import { computed } from 'vue'
import { t } from '../lib/i18n'
import AppIcon from './AppIcon.vue'

// Empty default, resolved below: see ErrorModal for why a t() call cannot live
// in a prop declaration.
const props = defineProps({
  ariaLabel: { type: String, default: '' },
})

const resolvedAriaLabel = computed(() => props.ariaLabel || t('common.closeModal'))

const emit = defineEmits(['click'])
</script>

<template>
  <button class="modal-close" type="button" :aria-label="resolvedAriaLabel" @click="emit('click')">
    <AppIcon class="modal-close__icon" name="x" />
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