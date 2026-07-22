<script setup>
// A family's identity as one square tile, split among its members' avatars:
// one member fills it, two split it down the middle, three take a left half plus
// a stacked right, four fill the quadrants. Five or more show three faces and a
// "+n" tile. Members are expected pre-ordered (you → owner → mods → rest).
import { computed } from 'vue'

const props = defineProps({
  members: { type: Array, default: () => [] },
  size: { type: [Number, Number], default: 40 },
})

const MAX_CELLS = 4

// Up to four cells. Beyond four, keep three faces and roll the rest into "+n".
const shownMembers = computed(() =>
  props.members.length > MAX_CELLS ? props.members.slice(0, 3) : props.members.slice(0, MAX_CELLS),
)
const overflow = computed(() =>
  props.members.length > MAX_CELLS ? props.members.length - 3 : 0,
)
const cellCount = computed(() => Math.min(shownMembers.value.length + (overflow.value ? 1 : 0), MAX_CELLS))

const sizeStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  '--fam-size': `${props.size}px`,
}))

// Curated palette for members without a photo — clean on white, distinct per name.
const COLORS = [
  '#d9533f', '#e08a2e', '#3f9e6c', '#2f9ea0',
  '#3d7fd6', '#6d5cd6', '#a24fc0', '#d24f8c',
]
function hashText(text) {
  let hash = 0
  const value = text || ''
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) & 0xffff
  return hash
}
function colorFor(member) {
  return COLORS[hashText(member.display_name || member.user_id) % COLORS.length]
}
function initialOf(member) {
  const name = (member.display_name || member.user_id || '?').trim()
  return name ? name[0].toUpperCase() : '?'
}
</script>

<template>
  <div class="fam-avatar" :class="`fam-avatar--${cellCount}`" :style="sizeStyle" aria-hidden="true">
    <span v-for="(member, i) in shownMembers" :key="member.user_id || i" class="fam-cell">
      <img v-if="member.image_url" :src="member.image_url" class="fam-cell__img" alt="" />
      <span v-else class="fam-cell__fill" :style="{ background: colorFor(member) }">{{ initialOf(member) }}</span>
    </span>
    <span v-if="overflow" class="fam-cell fam-cell--more">+{{ overflow }}</span>
  </div>
</template>

<style scoped>
.fam-avatar {
  display: grid;
  border-radius: var(--radius-md);
  overflow: hidden;
  /* The gap shows through as thin "grout" lines that make the split read. */
  gap: 1.5px;
  background: var(--border-main);
  flex-shrink: 0;
  font-size: calc(var(--fam-size, 40px) * 0.32);
}

.fam-avatar--1 { grid-template: 1fr / 1fr; }
.fam-avatar--2 { grid-template: 1fr / 1fr 1fr; }
.fam-avatar--3 {
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
}
/* The first face takes the whole left column; the other two stack on the right. */
.fam-avatar--3 .fam-cell:first-child { grid-row: 1 / 3; }
.fam-avatar--4 { grid-template: 1fr 1fr / 1fr 1fr; }

.fam-cell {
  position: relative;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
  background: var(--bg-hover);
}

.fam-cell__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.fam-cell__fill,
.fam-cell--more {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: var(--weight-bold);
  line-height: 1;
}

.fam-cell--more {
  background: var(--color-primary);
  font-size: 0.82em;
}
</style>
