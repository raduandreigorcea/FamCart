<script setup>
import { computed } from 'vue'
import ShoppingListItem from './ShoppingListItem.vue'
import SkeletonBlock from './SkeletonBlock.vue'
import { sumActiveQuantities } from '../lib/shoppingList'

// Presentational: renders the unchecked/checked sections with their move
// animations, the initial-load skeleton, and the empty state. All mutations
// stay with the parent, which owns the items.
const props = defineProps({
  items: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  showEmpty: { type: Boolean, default: false },
})

defineEmits(['toggle', 'delete'])

const uncheckedItems = computed(() => props.items.filter((i) => !i.checked))
const checkedItems = computed(() => props.items.filter((i) => i.checked))
const leftCount = computed(() => sumActiveQuantities(props.items))

const skeletonNameWidths = ['55%', '38%', '62%', '30%']
</script>

<template>
  <div class="list-meta" v-if="items.length">
    {{ leftCount }} left
  </div>

  <!-- Skeleton rows while the first fetch is in flight -->
  <ul v-if="loading" class="item-list" aria-hidden="true">
    <li v-for="(nameWidth, idx) in skeletonNameWidths" :key="idx" class="skeleton-item">
      <SkeletonBlock width="24px" height="24px" radius="50%" />
      <SkeletonBlock width="2.05rem" height="2.05rem" radius="0.65rem" />
      <SkeletonBlock class="skeleton-item__name" :width="nameWidth" height="0.95rem" />
      <SkeletonBlock width="var(--size-avatar-sm)" height="var(--size-avatar-sm)" radius="var(--radius-pill)" />
    </li>
  </ul>

  <!-- List -->
  <TransitionGroup tag="ul" name="unchecked" class="item-list">
    <ShoppingListItem
      v-for="item in uncheckedItems"
      :key="item.id"
      :item="item"
      @toggle="$emit('toggle', $event)"
      @delete="$emit('delete', $event)"
    />
  </TransitionGroup>

  <Transition name="section-fade">
    <p v-if="checkedItems.length" class="section-label">Checked</p>
  </Transition>

  <TransitionGroup tag="ul" name="checked" class="item-list" :class="{ 'item-list--checked': checkedItems.length }">
    <ShoppingListItem
      v-for="item in checkedItems"
      :key="item.id"
      :item="item"
      @toggle="$emit('toggle', $event)"
      @delete="$emit('delete', $event)"
    />
  </TransitionGroup>

  <p v-if="showEmpty" class="empty-state">
    Nothing here yet. Add your first item above!
  </p>
</template>

<style scoped>
/* Meta */
.list-meta {
  text-align: right;
  margin-top: 0.15rem;
  margin-bottom: 0.9rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-disabled);
}

/* Mirrors ShoppingListItem's .item card so rows swap in without layout shift */
.skeleton-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: var(--bg-surface);
  border-radius: var(--radius-xl);
  padding: 0.875rem 0.875rem 0.875rem 0.75rem;
  border: 1.5px solid var(--border-main);
}

.skeleton-item__name {
  margin-right: auto;
}

.item-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  position: relative;
}

.item-list--checked {
  margin-top: 0.4rem;
}

.unchecked-move,
.checked-move {
  transition: transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}

.unchecked-enter-active,
.checked-enter-active {
  transition: opacity 0.32s ease, transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
}

.unchecked-leave-active,
.checked-leave-active {
  transition: opacity 0.24s ease, transform 0.24s ease;
  position: absolute;
  width: 100%;
  pointer-events: none;
  z-index: 2;
}

.unchecked-enter-from {
  opacity: 0;
  transform: translateY(-8px) scale(0.995);
}

.unchecked-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.995);
}

.checked-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(0.995);
}

.checked-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.995);
}

.section-fade-enter-active,
.section-fade-leave-active {
  transition: opacity 0.18s ease;
}

.section-fade-enter-from,
.section-fade-leave-to {
  opacity: 0;
}

.section-label {
  margin: 1rem 0 0.45rem;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-disabled);
}

/* Empty state */
.empty-state {
  text-align: center;
  font-size: 0.875rem;
  color: var(--text-disabled);
  margin: 2.5rem 0;
  line-height: 1.5;
}
</style>
