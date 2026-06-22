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
  padding: 1.125rem 1.25rem;
  border: 1.5px solid #e4e4e4;
  border-radius: 16px;
  background: #fff;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
  text-align: left;
}

.choice-btn:hover {
  border-color: var(--green);
  background: color-mix(in srgb, var(--green) 5%, white);
  box-shadow: 0 2px 12px color-mix(in srgb, var(--green) 14%, transparent);
}

.choice-icon {
  font-size: 1.75rem;
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
  font-size: 0.95rem;
  font-weight: 700;
  color: #1a1a1a;
}

.choice-desc {
  font-size: 0.78rem;
  color: #9ca3af;
  line-height: 1.35;
}
</style>
