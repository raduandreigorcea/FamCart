<script setup lang="ts">
import { t } from '../lib/i18n'
import AppIcon from './AppIcon.vue'

defineEmits(['click'])
</script>

<template>
  <button class="back-btn" type="button" @click="$emit('click')">
    <AppIcon class="back-btn__arrow" name="chevron-left" />
    <span>{{ t('common.back') }}</span>
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
  display: inline-flex;
}

/* The asset ships at stroke-width 1 for a 24px box; weight it for this size. */
.back-btn__arrow :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  stroke: currentColor;
  stroke-width: 2;
}
</style>
