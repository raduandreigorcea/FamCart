<script setup>
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
      <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="10" cy="10" r="8.25" stroke="currentColor" stroke-width="1"/>
        <path v-if="item.checked" d="M6.5 10.5l2.5 2.5 4.5-5" stroke="currentColor" stroke-width="1.75"
          stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <span v-if="item.quantity > 1" class="item-qty">x{{ item.quantity }}</span>
    <span class="item-name">{{ item.name }}</span>
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
  border-radius: 14px;
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
  color: var(--text-disabled);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s;
}

.item--checked .item-check {
  color: var(--color-primary);
}

.item-check:hover {
  color: var(--color-primary);
}

.item-check svg {
  width: 22px;
  height: 22px;
}

.item-avatar {
  width: 30px;
  height: 30px;
  border-radius: 999px;
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
  background: color-mix(in srgb, var(--color-primary) 10%, white);
  border: 1px solid color-mix(in srgb, var(--color-primary) 28%, white);
  border-radius: 999px;
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
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s;
  border-radius: 6px;
}

.item-delete:hover {
  color: var(--danger-main);
}

.item-delete svg {
  width: 16px;
  height: 16px;
}
</style>
