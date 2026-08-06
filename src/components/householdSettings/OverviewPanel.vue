<script setup lang="ts">
import { ref, onBeforeUnmount, type PropType } from 'vue'
import type { HouseholdMemberProfile } from '../../lib/householdRealtime'
import copyIcon from '../../assets/copy.svg?raw'
import checkIcon from '../../assets/check.svg?raw'
import infoIcon from '../../assets/info.svg?raw'

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

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

async function copyInviteCode(code: string) {
  if (!code) return
  try {
    await navigator.clipboard.writeText(code)
    copied.value = true
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    // Clipboard denied or unavailable — the code is on screen to read either way.
  }
}

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
})
</script>

<template>
  <div
    class="tab-panel tab-panel--base"
    :class="{ 'tab-panel--ghost': ghost }"
    :inert="ghost"
    :aria-hidden="ghost"
  >
    <div class="panel-section">
      <h4 class="panel-section-title">Household Summary</h4>

      <div class="summary-card">
        <div class="summary-details">
          <div class="summary-row">
            <span class="summary-label">Household Name</span>
            <span class="summary-value highlight">{{ householdName }}</span>
          </div>
          <div class="summary-row" v-if="ownerProfile">
            <span class="summary-label">Created By</span>
            <div class="owner-chip">
              <img
                v-if="ownerProfile.image_url"
                :src="ownerProfile.image_url"
                alt="Owner avatar"
                class="owner-avatar-mini"
              />
              <span class="owner-name">{{ ownerProfile.display_name || 'Owner' }}</span>
            </div>
          </div>
          <div class="summary-row">
            <span class="summary-label">Total Members</span>
            <span class="summary-value">{{ memberCount }} active</span>
          </div>
        </div>
      </div>
    </div>

    <div class="panel-section" v-if="inviteCode">
      <h4 class="panel-section-title">Invite New Members</h4>
      <p class="panel-section-desc">Share this code with your household members so they can join your list.</p>

      <div class="invite-card">
        <div class="invite-code-container">
          <span class="invite-code-label">INVITE CODE</span>
          <span class="invite-code-value">{{ inviteCode }}</span>
        </div>
        <button
          class="invite-copy-btn"
          :class="{ 'invite-copy-btn--copied': copied }"
          type="button"
          @click="copyInviteCode(inviteCode)"
        >
          <span class="btn-icon-wrap" aria-hidden="true" v-html="copied ? checkIcon : copyIcon"></span>
          <span>{{ copied ? 'Copied!' : 'Copy Code' }}</span>
        </button>
      </div>
    </div>

    <div class="panel-section info-box-section">
      <div class="info-box">
        <span class="info-box-icon-wrap" aria-hidden="true" v-html="infoIcon"></span>
        <p class="settings-note-text">
          Use your profile menu on the top right of the dashboard screen to sign out or manage your personal account settings.
        </p>
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

.info-box-icon-wrap {
  width: 16px;
  height: 16px;
  color: var(--ui-text-muted);
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.info-box-icon-wrap :deep(svg) {
  width: 100%;
  height: 100%;
  stroke: currentColor;
  stroke-width: 2;
  fill: none;
}

/* Overview Panel cards */
.summary-card {
  border: var(--border-width-thin) solid var(--ui-border-soft);
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
  color: var(--ui-text-muted);
  font-weight: var(--weight-medium);
}

.summary-value {
  color: var(--ui-text-strong);
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
  border: var(--border-width-thin) solid var(--ui-border-soft);
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
  color: var(--ui-text-strong);
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
  color: var(--ui-text-muted);
}

.invite-code-value {
  font-family: 'SF Mono', Consolas, Monaco, 'Andale Mono', monospace;
  font-size: var(--text-xl);
  font-weight: var(--weight-extrabold);
  color: var(--ui-text-strong);
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

/* Info Box */
.info-box-section {
  margin-top: auto;
  padding-top: 0.5rem;
}

.info-box {
  display: flex;
  gap: 0.65rem;
  background: var(--bg-surface-alt);
  padding: var(--space-3) 0.9rem;
  border-radius: var(--radius-md);
}


.settings-note-text {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--ui-text-muted);
  line-height: 1.45;
}
</style>
