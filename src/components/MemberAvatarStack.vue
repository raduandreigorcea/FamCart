<script setup lang="ts">
import { computed, type PropType } from 'vue'
import SkeletonBlock from './SkeletonBlock.vue'
import { memberDisplayName } from '../lib/userIdentity'
import type { HouseholdMemberProfile } from '../lib/householdRealtime'

const props = defineProps({
  members: { type: Array as PropType<HouseholdMemberProfile[]>, default: () => [] },
  maxVisible: { type: Number, default: 4 },
  loading: { type: Boolean, default: false },
})

// Collapsing to "+1" hides one avatar to show a "+1" bubble in its place — it
// saves no room and just looks odd. So only collapse when it actually hides two
// or more: up to maxVisible + 1 members all render; beyond that we show
// maxVisible avatars and roll the rest into "+n".
const visibleMembers = computed(() =>
  props.members.length <= props.maxVisible + 1
    ? props.members
    : props.members.slice(0, props.maxVisible),
)
const extraMembers = computed(() => Math.max(0, props.members.length - visibleMembers.value.length))
</script>

<template>
  <div v-if="loading" class="member-stack" aria-hidden="true">
    <SkeletonBlock
      v-for="n in 3"
      :key="n"
      class="member-avatar"
      width="var(--member-avatar-size)"
      height="var(--member-avatar-size)"
      radius="var(--radius-pill)"
    />
  </div>
  <div v-else-if="members.length" class="member-stack">
    <template v-for="(member, idx) in visibleMembers" :key="member.user_id || idx">
      <img
        v-if="member.image_url"
        :src="member.image_url"
        :alt="memberDisplayName(member) + ' avatar'"
        class="member-avatar"
      />
      <span
        v-else
        class="member-avatar member-avatar--fallback"
        :title="memberDisplayName(member)"
      >
        {{ (member.display_name || member.user_id || '?').slice(0, 1).toUpperCase() }}
      </span>
    </template>
    <span v-if="extraMembers > 0" class="member-avatar member-avatar--more">+{{ extraMembers }}</span>
  </div>
</template>

<style scoped>
.member-stack {
  /* Callers set this to size the whole stack; the overlap and the "+n" bubble
     follow from it, so a stack never needs its parts adjusted one by one. */
  --member-avatar-size: 30px;

  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.member-avatar {
  width: var(--member-avatar-size);
  height: var(--member-avatar-size);
  border-radius: var(--radius-pill);
  object-fit: cover;
  border: var(--border-width-base) solid var(--bg-surface);
  /* Just under a third of a circle, which is enough to read as a stack without
     hiding the faces behind it. */
  margin-left: calc(var(--member-avatar-size) * -0.3);
  background: var(--bg-hover);
}

.member-stack .member-avatar:first-child {
  margin-left: 0;
}

.member-avatar--fallback,
.member-avatar--more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  color: var(--text-secondary);
}

.member-avatar--more {
  background: var(--color-primary-bg);
  color: var(--color-primary-text);
}
</style>
