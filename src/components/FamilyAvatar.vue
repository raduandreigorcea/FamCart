<script setup>
// A family's identity as one square tile, split among its members' avatars.
// Each photo covers the whole square and is clipped to its region, so a face is
// shown at full scale (a natural diagonal/quarter of it) rather than squeezed
// into a thin strip. One member fills the tile, two split it on the diagonal,
// three take a left half plus a stacked right, four fill the quadrants. Five or
// more show three faces and a "+n". Members arrive pre-ordered (you → owner → …).
import { computed } from 'vue'

const props = defineProps({
  members: { type: Array, default: () => [] },
  size: { type: Number, default: 40 },
})

const MAX_CELLS = 4

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
  '--fam-font': `${Math.max(9, Math.round(props.size * 0.36))}px`,
}))

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
    <template v-for="(member, i) in shownMembers" :key="member.user_id || i">
      <img v-if="member.image_url" :src="member.image_url" class="fam-slice" :class="`fam-slice--p${i}`" alt="" />
      <span v-else class="fam-slice fam-slice--fill" :class="`fam-slice--p${i}`" :style="{ background: colorFor(member) }">
        <span class="fam-slice__initial">{{ initialOf(member) }}</span>
      </span>
    </template>
    <span
      v-if="overflow"
      class="fam-slice fam-slice--fill fam-slice--more"
      :class="`fam-slice--p${shownMembers.length}`"
    >
      <span class="fam-slice__initial">+{{ overflow }}</span>
    </span>
  </div>
</template>

<style scoped>
.fam-avatar {
  position: relative;
  border-radius: var(--radius-md);
  overflow: hidden;
  flex-shrink: 0;
  /* Shows through the clip seams as thin grout between members. */
  background: var(--border-main);
  font-size: var(--fam-font, 14px);
}

.fam-slice {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.fam-slice--fill {
  color: #fff;
  font-weight: var(--weight-bold);
}

.fam-slice__initial {
  position: absolute;
  transform: translate(-50%, -50%);
  line-height: 1;
}

.fam-slice--more {
  background: var(--color-primary);
}
.fam-slice--more .fam-slice__initial {
  font-size: 0.82em;
}

/* ── Layouts: clip each full-cover slice to its region (2% gaps = seams). ── */

/* 1 — fills the tile. */
.fam-avatar--1 .fam-slice--p0 .fam-slice__initial { left: 50%; top: 50%; }

/* 2 — diagonal halves. */
.fam-avatar--2 .fam-slice--p0 { clip-path: polygon(2% 0, 100% 0, 100% 98%); }
.fam-avatar--2 .fam-slice--p1 { clip-path: polygon(0 2%, 98% 100%, 0 100%); }
.fam-avatar--2 .fam-slice--p0 .fam-slice__initial { left: 66%; top: 34%; }
.fam-avatar--2 .fam-slice--p1 .fam-slice__initial { left: 34%; top: 66%; }

/* 3 — left half, right stacked. */
.fam-avatar--3 .fam-slice--p0 { clip-path: inset(0 51% 0 0); }
.fam-avatar--3 .fam-slice--p1 { clip-path: inset(0 0 51% 51%); }
.fam-avatar--3 .fam-slice--p2 { clip-path: inset(51% 0 0 51%); }
.fam-avatar--3 .fam-slice--p0 .fam-slice__initial { left: 25%; top: 50%; }
.fam-avatar--3 .fam-slice--p1 .fam-slice__initial { left: 75%; top: 25%; }
.fam-avatar--3 .fam-slice--p2 .fam-slice__initial { left: 75%; top: 75%; }

/* 4 — quadrants. */
.fam-avatar--4 .fam-slice--p0 { clip-path: inset(0 51% 51% 0); }
.fam-avatar--4 .fam-slice--p1 { clip-path: inset(0 0 51% 51%); }
.fam-avatar--4 .fam-slice--p2 { clip-path: inset(51% 51% 0 0); }
.fam-avatar--4 .fam-slice--p3 { clip-path: inset(51% 0 0 51%); }
.fam-avatar--4 .fam-slice--p0 .fam-slice__initial { left: 25%; top: 25%; }
.fam-avatar--4 .fam-slice--p1 .fam-slice__initial { left: 75%; top: 25%; }
.fam-avatar--4 .fam-slice--p2 .fam-slice__initial { left: 25%; top: 75%; }
.fam-avatar--4 .fam-slice--p3 .fam-slice__initial { left: 75%; top: 75%; }
</style>
