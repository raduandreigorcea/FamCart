<script setup>
import { getProductEmoji } from '../lib/productEmoji'

const props = defineProps({
  item: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['toggle', 'delete'])

function handleToggle() {
  emit('toggle', props.item)
}

function handleDelete() {
  emit('delete', props.item)
}
</script>

<template>
  <li
    class="item"
    :class="{ 'item--checked': item.checked }"
  >
    <button class="item-check" @click="handleToggle" :aria-label="item.checked ? 'Uncheck' : 'Check'">
      <span class="check-circle" aria-hidden="true">
        <svg class="check-icon" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <polyline points="2,7 6,11 12,3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
    </button>
    <span class="item-emoji" aria-hidden="true">{{ getProductEmoji(item.name, item.brand || '') }}</span>
    <span class="item-name">{{ item.name }}</span>
    <span v-if="item.quantity > 1" class="item-qty">x{{ item.quantity }}</span>
    <img
      v-if="item.added_by_image_url"
      :src="item.added_by_image_url"
      :alt="(item.added_by_name || 'Member') + ' avatar'"
      class="item-avatar"
    />
    <span v-else class="item-avatar item-avatar--fallback" :title="item.added_by_name || 'Member'">
      {{ (item.added_by_name || '?').slice(0, 1).toUpperCase() }}
    </span>
    <button class="item-delete" @click="handleDelete" aria-label="Delete">
      <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" stroke-width="1.5"
          stroke-linecap="round"/>
      </svg>
    </button>
  </li>
</template>

<style scoped>
.item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: var(--bg-surface);
  border-radius: var(--radius-xl);
  padding: 0.875rem 0.875rem 0.875rem 0.75rem;
  border: 1.5px solid var(--border-main);
  transition: opacity 0.2s;
}

.item--checked {
  opacity: 0.5;
}

.item--checked .item-name {
  text-decoration: line-through;
  color: var(--text-disabled);
}

.item-check {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: var(--bg-surface);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.18s ease;
}

.check-circle {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 1.8px solid var(--border-dark);
  background: var(--bg-surface);
  color: var(--bg-surface);
  transition: background 0.2s ease, border-color 0.2s ease, transform 0.18s ease;
}

.check-circle::after {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--color-primary) 35%, transparent);
  opacity: 0;
  transform: scale(0.72);
  transition: opacity 0.2s ease, transform 0.22s ease;
}

.check-icon {
  width: 14px;
  height: 14px;
  opacity: 0;
  transform: scale(0.6) rotate(-10deg);
  transition: opacity 0.15s ease, transform 0.18s ease;
}

.item-check:hover .check-circle {
  border-color: var(--color-primary);
}

.item--checked .check-circle {
  background: var(--color-primary);
  border-color: var(--color-primary);
  transform: scale(1.06);
}

.item--checked .check-circle::after {
  opacity: 1;
  transform: scale(1);
}

.item--checked .check-icon {
  opacity: 1;
  transform: scale(1) rotate(0deg);
}

@media (prefers-reduced-motion: reduce) {
  .check-circle,
  .check-circle::after,
  .check-icon,
  .item-name {
    transition: none;
  }
}

.item-emoji {
  flex-shrink: 0;
  font-size: 1.05rem;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.05rem;
  height: 2.05rem;
  border-radius: 0.65rem;
  background: color-mix(in srgb, var(--color-primary) 10%, var(--bg-surface));
  border: 1px solid color-mix(in srgb, var(--color-primary) 22%, var(--bg-surface));
}

.item-avatar {
  width: var(--size-avatar-sm);
  height: var(--size-avatar-sm);
  border-radius: var(--radius-pill);
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid var(--border-main);
}

.item-avatar--fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-hover);
  color: var(--text-secondary);
  font-size: 0.8rem;
  font-weight: 700;
}

.item-name {
  flex: 1;
  font-size: 0.95rem;
  color: var(--text-primary);
  line-height: 1.4;
  word-break: break-word;
}

.item-qty {
  flex-shrink: 0;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 10%, var(--bg-surface));
  border: 1px solid color-mix(in srgb, var(--color-primary) 28%, var(--bg-surface));
  border-radius: var(--radius-pill);
  padding: 0.15rem 0.45rem;
}

.item-delete {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s;
  border-radius: var(--radius-xs);
}

.item-delete:hover {
  color: var(--danger-main);
}

.item-delete svg {
  width: var(--size-icon-md);
  height: var(--size-icon-md);
}
</style>
