<script setup>
import { computed } from 'vue'
import SkeletonBlock from './SkeletonBlock.vue'

const props = defineProps({
  members: { type: Array, default: () => [] },
  maxVisible: { type: Number, default: 4 },
  loading: { type: Boolean, default: false },
})

const visibleMembers = computed(() => props.members.slice(0, props.maxVisible))
const extraMembers = computed(() => Math.max(0, props.members.length - visibleMembers.value.length))
</script>

<template>
  <div v-if="loading" class="member-stack" aria-hidden="true">
    <SkeletonBlock v-for="n in 3" :key="n" class="member-avatar" width="30px" height="30px" radius="var(--radius-pill)" />
  </div>
  <div v-else-if="members.length" class="member-stack">
    <template v-for="(member, idx) in visibleMembers" :key="member.user_id || idx">
      <img
        v-if="member.image_url"
        :src="member.image_url"
        :alt="(member.display_name || 'Member') + ' avatar'"
        class="member-avatar"
      />
      <span
        v-else
        class="member-avatar member-avatar--fallback"
        :title="member.display_name || 'Member'"
      >
        {{ (member.display_name || member.user_id || '?').slice(0, 1).toUpperCase() }}
      </span>
    </template>
    <span v-if="extraMembers > 0" class="member-avatar member-avatar--more">+{{ extraMembers }}</span>
  </div>
</template>

<style scoped>
.member-stack {
  display: flex;
  align-items: center;
}

.member-avatar {
  width: 30px;
  height: 30px;
  border-radius: var(--radius-pill);
  object-fit: cover;
  border: 1.5px solid var(--bg-surface);
  margin-left: -9px;
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
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--ui-text-muted, var(--text-secondary));
}

.member-avatar--more {
  background: var(--color-primary-bg);
  color: var(--color-primary-text);
}
</style>
