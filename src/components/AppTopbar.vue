<script setup>
import { computed, defineAsyncComponent, ref } from 'vue'
import { useClerk, useUser } from '@clerk/vue'
import AccountActionModal from './AccountActionModal.vue'
import MemberAvatarStack from './MemberAvatarStack.vue'
import SkeletonBlock from './SkeletonBlock.vue'
import { getUserDisplayName, getUserInitial, getUserPrimaryEmail } from '../lib/userIdentity'
import { forgetUser } from '../lib/session'
import { clearFamilySnapshot } from '../lib/familyCache'
import { clearOfflineQueue } from '../lib/offlineQueue'
import { logoutPushUser } from '../lib/pushNotifications'

// The settings modal is by far the heaviest part of the topbar; load its chunk
// only when someone actually opens it.
const FamilySettingsModal = defineAsyncComponent(() => import('./FamilySettingsModal.vue'))
// Same treatment for the purchase-history modal: fetched and rendered on demand.
const PurchaseHistoryModal = defineAsyncComponent(() => import('./PurchaseHistoryModal.vue'))

const props = defineProps({
  familyId: { type: String, default: '' },
  familyName: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  inviteCode: { type: String, default: '' },
  familyItemLimit: { type: Number, default: 50 },
  ownerUserId: { type: String, default: '' },
  currentUserId: { type: String, default: '' },
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

const historyOpen = ref(false)
const historyEverOpened = ref(false)

function openHistory() {
  historyEverOpened.value = true
  historyOpen.value = true
}

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
    // Drop the cached session and local data so the offline-boot path and the
    // snapshot can't resurrect this account after signing out.
    forgetUser(localStorage)
    clearFamilySnapshot(localStorage)
    clearOfflineQueue(localStorage)
    // Unlink this device in OneSignal so the next account's pushes don't land
    // on top of the old one's. Best-effort; sign-out must not wait on the CDN.
    void logoutPushUser()
    await clerk.value?.signOut({ redirectUrl: `${window.location.origin}/login` })
    accountMenuOpen.value = false
  } catch (error) {
    console.error('Failed to sign out:', error)
  } finally {
    signingOut.value = false
  }
}

// Offline (cold-booted from cache) Clerk can't load, so `user` is null. The
// cached family roster still holds this user's profile, so fall back to it for
// the account button and menu rather than showing an empty "Account".
const cachedProfile = computed(() =>
  props.currentUserId
    ? props.memberProfiles.find((m) => m.user_id === props.currentUserId) || null
    : null,
)

const userAvatarUrl = computed(() => user.value?.imageUrl || cachedProfile.value?.image_url || null)
const userDisplayName = computed(
  () => getUserDisplayName(user.value) || cachedProfile.value?.display_name || 'Account',
)
const userEmail = computed(() => getUserPrimaryEmail(user.value))
const userInitial = computed(() => {
  const clerkInitial = user.value ? getUserInitial(user.value) : ''
  if (clerkInitial && clerkInitial !== '?') return clerkInitial
  const name = cachedProfile.value?.display_name
  return name ? name.slice(0, 1).toUpperCase() : '?'
})

const memberCount = computed(() => props.memberProfiles.length)
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
          <MemberAvatarStack :members="memberProfiles" />
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
          <MemberAvatarStack loading />
        </div>
      </template>
      <template v-else>
        <img src="/icons/pwa-192.png" alt="FamCart" class="topbar-logo" />
      </template>
    </div>

    <div class="topbar-actions">
      <button v-if="familyName" class="topbar-icon-btn" type="button" aria-label="Checkout history" @click="openHistory">
        <span class="history-icon" aria-hidden="true"></span>
      </button>

      <button v-if="familyName" class="topbar-icon-btn" type="button" aria-label="Open settings" @click="openSettings">
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

  <PurchaseHistoryModal
    v-if="historyEverOpened"
    :open="historyOpen"
    :family-id="familyId"
    :current-user-id="currentUserId"
    :member-profiles="memberProfiles"
    @close="historyOpen = false"
  />

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
  /* Always keep breathing room between the family name and the action buttons,
     so the name can never butt up against (or slide under) them. */
  gap: 0.75rem;
  /* The bar's surface extends up behind the phone's status bar; its content
     keeps the usual 72px strip below it. */
  padding: var(--safe-top) 1.25rem 0;
  height: calc(72px + var(--safe-top));
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
  /* min-width:0 lets this region shrink below its content width so the name can
     ellipsize; overflow:hidden guarantees nothing ever spills over the buttons,
     which paint on top of it (they come later in the DOM). */
  min-width: 0;
  overflow: hidden;
}

.family-meta {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-width: 0;
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
  /* A long family name must never shove the settings/account buttons off the
     edge: cap it to the available width and ellipsize the overflow. */
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  /* Never let the family name squeeze the action buttons. */
  flex-shrink: 0;
}

.topbar-icon-btn {
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

.topbar-icon-btn:hover {
  border-color: var(--color-primary);
  box-shadow: var(--focus-ring-primary-soft);
}

.settings-icon,
.history-icon {
  width: 20px;
  height: 20px;
  display: inline-block;
  background-color: currentColor;
  opacity: 0.86;
}

.settings-icon {
  mask: url('../assets/settings.svg') no-repeat center / contain;
  -webkit-mask: url('../assets/settings.svg') no-repeat center / contain;
}

.history-icon {
  mask: url('../assets/history.svg') no-repeat center / contain;
  -webkit-mask: url('../assets/history.svg') no-repeat center / contain;
}

:global(:root[data-theme='dark']) .settings-icon,
:global(:root[data-theme='dark']) .history-icon {
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
