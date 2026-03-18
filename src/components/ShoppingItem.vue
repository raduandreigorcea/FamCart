<script setup lang="ts">
import type { ShoppingItem } from '../types'

defineProps<{
  item: ShoppingItem
  addedByAvatar?: string
  addedByName?: string
  disabled?: boolean
}>()

defineEmits<{
  toggle: [item: ShoppingItem]
  remove: [itemId: string]
}>()
</script>

<template>
  <div class="row" :class="{ 'row--done': item.completed }">
    <!-- Custom circular checkbox -->
    <label class="row-check">
      <input type="checkbox" :checked="item.completed" :disabled="disabled" @change="$emit('toggle', item)" />
      <span class="check-circle">
        <svg v-if="item.completed" class="check-icon" viewBox="0 0 14 14" fill="none">
          <polyline points="2,7 6,11 12,3" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
    </label>

    <!-- Product image / placeholder -->
    <div class="row-img-wrap">
      <img v-if="item.image" :src="item.image" :alt="item.name" class="row-img" />
      <div v-else class="row-img row-img--placeholder">🛍️</div>
    </div>

    <!-- Main text -->
    <div class="row-text">
      <span class="row-name">{{ item.name }}</span>
      <span class="row-meta">
        <span v-if="item.brand" class="row-brand">{{ item.brand }}</span>
        <span v-if="item.quantity > 1" class="qty-badge">×{{ item.quantity }}</span>
      </span>
    </div>

    <!-- Right: adder avatar + delete button -->
    <div class="row-right">
      <img
        v-if="addedByAvatar"
        :src="addedByAvatar"
        :alt="addedByName || 'Member'"
        :title="addedByName"
        class="adder-avatar"
      />
      <button type="button" class="row-remove" :disabled="disabled" @click="$emit('remove', item.id)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* ── Row container ── */
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  min-height: 62px;
  transition: opacity 0.2s;
}

.row + .row {
  border-top: 0.5px solid rgba(0, 0, 0, 0.07);
}

/* ── Custom circular checkbox ── */
.row-check {
  flex-shrink: 0;
  cursor: pointer;
}

.row-check input[type="checkbox"] {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.check-circle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid #c7c7cc;
  background: #fff;
  transition: background 0.15s, border-color 0.15s;
}

.row-check input:checked + .check-circle {
  background: #30e88c;
  border-color: #30e88c;
}

.check-icon {
  width: 14px;
  height: 14px;
}

/* ── Product image ── */
.row-img-wrap { flex-shrink: 0; }

.row-img {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  object-fit: cover;
  background: #f2f2f7;
}

.row-img--placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
}

/* ── Text ── */
.row-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.row-name {
  font-size: 0.9375rem;
  font-weight: 600;
  color: #1c1c1e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}

.row-brand {
  font-size: 0.8125rem;
  color: #8e8e93;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.qty-badge {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
  background: rgba(48, 232, 140, 0.18);
  color: #1a7a48;
}

/* ── Right side ── */
.row-right {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.adder-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
  border: 1.5px solid rgba(0,0,0,0.06);
  background: #d8fbe9;
}

.row-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.05);
  color: #8e8e93;
}

.row-remove svg { width: 13px; height: 13px; }
.row-remove:active { background: rgba(255, 59, 48, 0.12); color: #ff3b30; }
.row-remove:disabled { opacity: 0.3; pointer-events: none; }

/* ── Completed state ── */
.row--done { opacity: 0.55; }
.row--done .row-name { text-decoration: line-through; color: #b0b0b8; }
</style>