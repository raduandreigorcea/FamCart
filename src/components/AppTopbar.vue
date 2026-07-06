<script setup>
import { computed, defineAsyncComponent, ref } from 'vue'
import { useClerk, useUser } from '@clerk/vue'
import AccountActionModal from './AccountActionModal.vue'
import SkeletonBlock from './SkeletonBlock.vue'

// The settings modal is by far the heaviest part of the topbar; load its chunk
// only when someone actually opens it.
const FamilySettingsModal = defineAsyncComponent(() => import('./FamilySettingsModal.vue'))

const props = defineProps({
  familyId: { type: String, default: '' },
  familyName: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  inviteCode: { type: String, default: '' },
  familyItemLimit: { type: Number, default: 50 },
  ownerUserId: { type: String, default: '' },
  memberProfiles: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits(['refresh-family', 'family-deleted'])

const clerk = useClerk()
const { user } = useUser()

const accountMenuOpen = ref(false)
const signingOut = ref(false)

const settingsOpen = ref(false)
const settingsTab = ref('overview')
// Stays true after the first open so the async chunk keeps its close transition.
const settingsEverOpened = ref(false)

function openAccountMenu() {
  accountMenuOpen.value = true
}

function openAccountSettings() {
  accountMenuOpen.value = false
  clerk.value?.openUserProfile()
}

function openSettings() {
  openFamilySettingsTab('overview')
}

function openFamilySettingsTab(tab) {
  accountMenuOpen.value = false
  settingsTab.value = tab
  settingsEverOpened.value = true
  settingsOpen.value = true
}

async function inviteMembersFromAccountMenu() {
  accountMenuOpen.value = false
  if (props.inviteCode) {
    try {
      await navigator.clipboard.writeText(props.inviteCode)
    } catch {
      // no-op
    }
    return
  }
  openFamilySettingsTab('overview')
}

async function handleSignOut() {
  if (signingOut.value) return
  signingOut.value = true
  try {
    await clerk.value?.signOut({ redirectUrl: `${window.location.origin}/login` })
    accountMenuOpen.value = false
  } catch (error) {
    console.error('Failed to sign out:', error)
  } finally {
    signingOut.value = false
  }
}

const userAvatarUrl = computed(() => user.value?.imageUrl || null)
const userDisplayName = computed(() => {
  return user.value?.fullName || user.value?.firstName || 'Account'
})
const userEmail = computed(() => user.value?.primaryEmailAddress?.emailAddress || user.value?.emailAddresses?.[0]?.emailAddress || '')
const userInitial = computed(() => {
  const name = user.value?.fullName || user.value?.firstName || user.value?.emailAddresses?.[0]?.emailAddress || '?'
  return name.slice(0, 1).toUpperCase()
})

const memberCount = computed(() => props.memberProfiles.length)
const visibleMembers = computed(() => props.memberProfiles.slice(0, 4))
const extraMembers = computed(() => Math.max(0, memberCount.value - visibleMembers.value.length))
</script>

<template>
  <header class="topbar">
    <div class="topbar-left">
      <template v-if="familyName">
        <div class="family-meta">
          <div class="family-info">
            <p class="family-name">{{ familyName }}</p>
            <div class="family-subrow">
              <span class="family-members-count">{{ memberCount }} members</span>
            </div>
          </div>
          <div class="member-stack" v-if="memberCount">
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
        </div>
      </template>
      <template v-else-if="loading">
        <div class="family-meta" aria-hidden="true">
          <div class="family-info">
            <SkeletonBlock width="7.5rem" height="1rem" />
            <div class="family-subrow">
              <SkeletonBlock width="4.5rem" height="0.7rem" />
            </div>
          </div>
          <div class="member-stack">
            <SkeletonBlock v-for="n in 3" :key="n" class="member-avatar" width="30px" height="30px" radius="var(--radius-pill)" />
          </div>
        </div>
      </template>
      <template v-else>
        <img src="/icons/pwa-192.png" alt="FamCart" class="topbar-logo" />
      </template>
    </div>

    <div class="topbar-actions">
      <button v-if="familyName" class="settings-btn" type="button" aria-label="Open settings" @click="openSettings">
        <span class="settings-icon" aria-hidden="true"></span>
      </button>

      <button
        class="user-avatar-btn"
        type="button"
        aria-label="Account settings"
        @click="openAccountMenu"
      >
        <img
          v-if="userAvatarUrl"
          :src="userAvatarUrl"
          alt="Your avatar"
          class="user-avatar-img"
        />
        <span v-else class="user-avatar-fallback">{{ userInitial }}</span>
      </button>
    </div>
  </header>

  <FamilySettingsModal
    v-if="settingsEverOpened"
    :open="settingsOpen"
    :initial-tab="settingsTab"
    :family-id="familyId"
    :family-name="familyName"
    :invite-code="inviteCode"
    :family-item-limit="familyItemLimit"
    :owner-user-id="ownerUserId"
    :member-profiles="memberProfiles"
    @close="settingsOpen = false"
    @refresh-family="emit('refresh-family')"
    @family-deleted="emit('family-deleted')"
  />

  <AccountActionModal
    :open="accountMenuOpen"
    :loading-sign-out="signingOut"
    :avatar-url="userAvatarUrl"
    :display-name="userDisplayName"
    :email="userEmail"
    :initial="userInitial"
    :family-name="familyName"
    :family-member-count="memberCount"
    @close="accountMenuOpen = false"
    @edit-account="openAccountSettings"
    @manage-family="openFamilySettingsTab('overview')"
    @invite-members="inviteMembersFromAccountMenu"
    @sign-out="handleSignOut"
  />
</template>

<style scoped>
.topbar {
  --ui-border: var(--border-main);
  --ui-border-soft: var(--bg-hover);
  --ui-text: var(--text-primary);
  --ui-text-muted: var(--text-secondary);
  --ui-text-strong: var(--text-primary);
  --ui-bg: var(--bg-surface);

  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 1.25rem;
  height: 72px;
  background: var(--ui-bg);
  border-bottom: 1px solid var(--ui-border);
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
}

.topbar-left {
  display: flex;
  align-items: center;
  min-width: 0;
}

.family-meta {
  display: flex;
  align-items: center;
  gap: 0.7rem;
}

.topbar-logo {
  height: 36px;
  width: auto;
  object-fit: contain;
}

.family-info {
  min-width: 0;
}

.family-name {
  margin: 0;
  font-family: inherit;
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--ui-text-strong);
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  -webkit-tap-highlight-color: transparent;
  box-sizing: border-box;
}

.family-subrow {
  margin-top: 0.2rem;
  display: flex;
  align-items: baseline;
}

.family-members-count {
  font-size: 0.82rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--ui-text-muted);
  font-family: inherit;
}

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
  color: var(--ui-text-muted);
}

.member-avatar--more {
  background: var(--color-primary-bg);
  color: var(--color-primary-text);
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.settings-btn {
  width: var(--size-control-md);
  height: var(--size-control-md);
  border-radius: var(--radius-pill);
  border: 2px solid var(--ui-border);
  background: var(--bg-hover);
  color: var(--ui-text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.settings-btn:hover {
  border-color: var(--color-primary);
  box-shadow: var(--focus-ring-primary-soft);
}

.settings-icon {
  width: 20px;
  height: 20px;
  display: inline-block;
  background-color: currentColor;
  mask: url('../assets/settings.svg') no-repeat center / contain;
  -webkit-mask: url('../assets/settings.svg') no-repeat center / contain;
  opacity: 0.86;
}

:global(:root[data-theme='dark']) .settings-icon {
  background-color: var(--text-inverse);
  opacity: 0.96;
}

.user-avatar-btn {
  width: var(--size-control-md);
  height: var(--size-control-md);
  border-radius: var(--radius-pill);
  border: 2px solid var(--ui-border);
  background: var(--bg-hover);
  padding: 0;
  cursor: pointer;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.15s, box-shadow 0.15s;
  flex-shrink: 0;
}

.user-avatar-btn:hover {
  border-color: var(--color-primary);
  box-shadow: var(--focus-ring-primary-soft);
}

.user-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: var(--radius-pill);
}

.user-avatar-fallback {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--ui-text-muted);
}
</style>
