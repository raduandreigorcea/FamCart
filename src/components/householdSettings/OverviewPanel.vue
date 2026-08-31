<script setup lang="ts">
import { type PropType } from 'vue'
import type { HouseholdMemberProfile } from '../../lib/householdRealtime'
import { useCopyFeedback } from '../../lib/clipboard'
import AppIcon from '../AppIcon.vue'
import { t } from '../../lib/i18n'

// Read-only: who is in the household, who made it, and the code for adding
// someone. The only thing it writes is the clipboard.
//
// It stays mounted on every tab: it is the tallest panel, so it is what holds
// the modal's height open while the others are painted over its box. `ghost` is
// that state — present in the layout, invisible and inert.
//
// The root element here IS the .tab-panel div rather than something inside it.
// .tab-panel is a flex column with a gap, so its direct children are the flex
// items; wrapping them would collapse the whole panel into one item and lose
// every gap. It also means the parent's scoped .tab-panel rules still apply,
// since a child component's root carries the parent's scope id.
defineProps({
  ghost: { type: Boolean, default: false },
  householdName: { type: String, default: '' },
  inviteCode: { type: String, default: '' },
  memberCount: { type: Number, default: 0 },
  ownerProfile: {
    type: Object as PropType<HouseholdMemberProfile | null>,
    default: null,
  },
})

// The clipboard write, the "Copied" hold and its timer cleanup all live in
// lib/clipboard now — OnboardingTour asks the same thing of it. A failed copy
// leaves `copied` false, which is right: the code is on screen to read either way.
const { copied, copy: copyInviteCode } = useCopyFeedback()
</script>

<template>
  <div
    class="tab-panel tab-panel--base"
    :class="{ 'tab-panel--ghost': ghost }"
    :inert="ghost"
    :aria-hidden="ghost"
  >
    <div class="panel-section">
      <h4 class="panel-section-title">{{ t('overview.summary') }}</h4>

      <div class="summary-card">
        <div class="summary-details">
          <div class="summary-row">
            <span class="summary-label">{{ t('overview.name') }}</span>
            <span class="summary-value highlight">{{ householdName }}</span>
          </div>
          <div class="summary-row" v-if="ownerProfile">
            <span class="summary-label">{{ t('overview.createdBy') }}</span>
            <div class="owner-chip">
              <img
                v-if="ownerProfile.image_url"
                :src="ownerProfile.image_url"
                :alt="t('common.avatarAlt', { name: ownerProfile.display_name || t('overview.owner') })"
                class="owner-avatar-mini"
              />
              <span class="owner-name">{{ ownerProfile.display_name || t('overview.owner') }}</span>
            </div>
          </div>
          <div class="summary-row">
            <span class="summary-label">{{ t('overview.totalMembers') }}</span>
            <span class="summary-value">{{ t('overview.activeCount', { n: memberCount }) }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="panel-section" v-if="inviteCode">
      <h4 class="panel-section-title">{{ t('overview.inviteTitle') }}</h4>
      <p class="panel-section-desc">{{ t('overview.inviteDesc') }}</p>

      <div class="invite-card">
        <div class="invite-code-container">
          <span class="invite-code-label">{{ t('overview.inviteCode') }}</span>
          <span class="invite-code-value">{{ inviteCode }}</span>
        </div>
        <button
          class="invite-copy-btn"
          :class="{ 'invite-copy-btn--copied': copied }"
          type="button"
          @click="copyInviteCode(inviteCode)"
        >
          <AppIcon class="btn-icon-wrap" :name="copied ? 'check' : 'copy'" />
          <span>{{ copied ? t('overview.copied') : t('overview.copyCode') }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.btn-icon-wrap {
  width: 15px;
  height: 15px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.btn-icon-wrap :deep(svg) {
  width: 100%;
  height: 100%;
  stroke: currentColor;
  stroke-width: 2;
  fill: none;
}

/* Overview Panel cards */
.summary-card {
  border: var(--border-width-thin) solid var(--bg-hover);
  background: var(--bg-surface-alt);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
}

.summary-details {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--text-base);
}

.summary-label {
  color: var(--text-secondary);
  font-weight: var(--weight-medium);
}

.summary-value {
  color: var(--text-primary);
  font-weight: var(--weight-bold);
}

.summary-value.highlight {
  color: var(--color-primary);
}

.owner-chip {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: var(--bg-surface);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  border: var(--border-width-thin) solid var(--bg-hover);
}

.owner-avatar-mini {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  object-fit: cover;
}

.owner-name {
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
}

/* Invite card */
.invite-card {
  border: var(--border-width-base) dashed color-mix(in srgb, var(--color-primary) 35%, var(--border-light));
  background: color-mix(in srgb, var(--color-primary) 3%, var(--bg-surface));
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.invite-code-container {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.invite-code-label {
  font-size: var(--text-2xs);
  letter-spacing: 0.08em;
  font-weight: var(--weight-extrabold);
  color: var(--text-secondary);
}

.invite-code-value {
  font-family: var(--font-mono);
  font-size: var(--text-xl);
  font-weight: var(--weight-extrabold);
  color: var(--text-primary);
  letter-spacing: 0.05em;
}

.invite-copy-btn {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: var(--color-primary);
  color: var(--text-inverse);
  border: none;
  padding: 0.55rem 0.85rem;
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  cursor: pointer;
  transition: all var(--transition-base) ease;
}

.invite-copy-btn:hover {
  background: color-mix(in srgb, var(--color-primary) 85%, var(--text-primary));
  transform: translateY(-1px);
  box-shadow: var(--elevation-primary);
}

.invite-copy-btn--copied {
  background: var(--color-primary-bg);
  color: var(--color-primary-text);
  border: var(--border-width-thin) solid var(--color-primary-bg);
}

.invite-copy-btn--copied:hover {
  background: var(--color-primary-bg);
  color: var(--color-primary-text);
  transform: none;
  box-shadow: none;
}
</style>
