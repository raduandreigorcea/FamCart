<script setup>
defineProps({
  icon: { type: String, required: true },
  label: { type: String, required: true },
  description: { type: String, default: '' },
})

defineEmits(['click'])
</script>

<template>
  <button class="choice-btn" type="button" @click="$emit('click')">
    <span class="choice-icon">{{ icon }}</span>
    <div class="choice-text">
      <span class="choice-label">{{ label }}</span>
      <span v-if="description" class="choice-desc">{{ description }}</span>
    </div>
  </button>
</template>

<style scoped>
.choice-btn {
  display: flex;
  align-items: center;
  gap: 1rem;
  width: 100%;
  padding: 1.125rem var(--space-5);
  border: var(--border-width-base) solid var(--border-main);
  border-radius: var(--radius-2xl);
  background: var(--bg-surface);
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast), box-shadow var(--transition-fast);
  text-align: left;
}

.choice-btn:hover {
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 5%, var(--bg-surface));
  box-shadow: var(--elevation-primary-soft);
}

.choice-icon {
  font-size: var(--text-2xl);
  line-height: 1;
  flex-shrink: 0;
}

.choice-text {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.choice-label {
  font-family: inherit;
  font-size: var(--text-md);
  font-weight: var(--weight-bold);
  color: var(--text-primary);
}

.choice-desc {
  font-size: var(--text-xs);
  color: var(--text-disabled);
  line-height: var(--leading-snug);
}
</style>
