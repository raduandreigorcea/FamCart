<script setup>
import { computed, defineAsyncComponent, ref } from 'vue'
import { useClerk, useUser } from '@clerk/vue'
import AccountActionModal from './AccountActionModal.vue'
import MemberAvatarStack from './MemberAvatarStack.vue'
import SkeletonBlock from './SkeletonBlock.vue'
import { sortMembersForSwitcher } from '../lib/memberRoles'
import chevronLeftRaw from '../assets/chevron-left.svg?raw'
import checkRaw from '../assets/check.svg?raw'
import plusRaw from '../assets/plus.svg?raw'
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
  // Every family the user belongs to ({ id, name }); the switcher lists them.
  families: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  // True mid family-switch: the name is already known, but the roster isn't yet,
  // so the member count and avatars show a skeleton instead of a stale/empty one.
  membersLoading: { type: Boolean, default: false },
  inviteCode: { type: String, default: '' },
  familyItemLimit: { type: Number, default: 50 },
  ownerUserId: { type: String, default: '' },
  currentUserId: { type: String, default: '' },
  memberProfiles: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits([
  'refresh-family',
  'family-deleted',
  'family-left',
  'switch-family',
  'add-family',
])

// Keep in step with the DB cap (migration 025): at the cap there is nowhere to
// add another, so the switcher hides the join/create action.
const MAX_FAMILIES = 3

const switcherOpen = ref(false)
const canAddFamily = computed(() => props.families.length < MAX_FAMILIES)

function toggleSwitcher() {
  switcherOpen.value = !switcherOpen.value
}
function closeSwitcher() {
  switcherOpen.value = false
}
function selectFamily(id) {
  closeSwitcher()
  if (id !== props.familyId) emit('switch-family', id)
}
function addFamily() {
  closeSwitcher()
  emit('add-family')
}

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

// A stable identity colour + initial for each family, so the switcher reads as a
// set of distinct households. A curated palette (rather than raw HSL, which drifts
// into muddy olives) keeps every colour clean and legible with white text.
const FAMILY_COLORS = [
  '#d9533f', // warm red
  '#e08a2e', // amber
  '#3f9e6c', // green
  '#2f9ea0', // teal
  '#3d7fd6', // blue
  '#6d5cd6', // indigo
  '#a24fc0', // purple
  '#d24f8c', // pink
]
function familyHash(name) {
  let hash = 0
  const text = name || ''
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) & 0xffff
  return hash
}
function familyColor(name) {
  return FAMILY_COLORS[familyHash(name) % FAMILY_COLORS.length]
}
function familyInitial(name) {
  const trimmed = (name || '').trim()
  return trimmed ? trimmed[0].toUpperCase() : '#'
}

// Members for a family's switcher stack, ordered you → owner → moderators → rest.
function orderedFamilyMembers(fam) {
  return sortMembersForSwitcher(fam.members || [], fam.ownerId || '', props.currentUserId)
}
</script>

<template>
  <header class="topbar">
    <div class="topbar-left">
      <template v-if="familyName">
        <button
          class="family-switcher-btn"
          type="button"
          aria-haspopup="menu"
          :aria-expanded="switcherOpen"
          aria-label="Switch family"
          @click="toggleSwitcher"
        >
          <span
            class="family-switcher-caret"
            :class="{ 'family-switcher-caret--open': switcherOpen }"
            aria-hidden="true"
            v-html="chevronLeftRaw"
          ></span>
          <div class="family-info">
            <p class="family-name">{{ familyName }}</p>
            <div class="family-subrow">
              <SkeletonBlock v-if="membersLoading" width="4.5rem" height="0.7rem" />
              <span v-else class="family-members-count">{{ memberCount }} {{ memberCount === 1 ? 'member' : 'members' }}</span>
            </div>
          </div>
        </button>
      </template>
      <template v-else-if="loading">
        <div class="family-meta" aria-hidden="true">
          <div class="family-info">
            <SkeletonBlock width="7.5rem" height="1rem" />
            <div class="family-subrow">
              <SkeletonBlock width="4.5rem" height="0.7rem" />
            </div>
          </div>
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

  <!-- Family switcher: teleported so the topbar's overflow:hidden (which
       ellipsizes the name) can't clip it. The transparent overlay catches
       outside clicks to dismiss. -->
  <Teleport to="body">
    <Transition name="switcher-fade">
      <div v-if="switcherOpen" class="family-switcher-overlay" @click.self="closeSwitcher">
        <div class="family-switcher-menu" role="menu">
          <p class="family-switcher-heading">Your families</p>
          <button
            v-for="fam in families"
            :key="fam.id"
            class="family-switcher-item"
            :class="{ 'family-switcher-item--active': fam.id === familyId }"
            type="button"
            role="menuitemradio"
            :aria-checked="fam.id === familyId"
            @click="selectFamily(fam.id)"
          >
            <MemberAvatarStack
              v-if="fam.members && fam.members.length"
              class="family-switcher-avatars"
              :members="orderedFamilyMembers(fam)"
              :max-visible="4"
              strict
            />
            <span
              v-else
              class="family-monogram"
              :style="{ background: familyColor(fam.name) }"
              aria-hidden="true"
            >{{ familyInitial(fam.name) }}</span>
            <span class="family-switcher-item-name">{{ fam.name || 'Family' }}</span>
            <span v-if="fam.id === familyId" class="family-switcher-check" aria-hidden="true" v-html="checkRaw"></span>
          </button>
          <div
            class="family-switcher-divider"
            :class="{ 'family-switcher-divider--cap': !canAddFamily }"
            aria-hidden="true"
          ></div>
          <button
            v-if="canAddFamily"
            class="family-switcher-add"
            type="button"
            role="menuitem"
            @click="addFamily"
          >
            <span class="family-switcher-add-tile" aria-hidden="true" v-html="plusRaw"></span>
            Join or create a family
          </button>
          <p v-else class="family-switcher-cap-note">
            You're in the maximum of {{ MAX_FAMILIES }} families. Leave one to join or create another.
          </p>
        </div>
      </div>
    </Transition>
  </Teleport>

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
    @family-left="emit('family-left')"
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
  border-bottom: var(--border-width-thin) solid var(--ui-border);
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
}

/* Desktop: keep the bar full-width but align its content with the centered
   dashboard column, so the family name and buttons don't hug the far corners
   of a wide screen. 100% is the bar's own width, which matches the base the
   column is centered against. */
@media (min-width: 900px) {
  .topbar {
    padding-inline: max(1.25rem, calc((100% - var(--desktop-column)) / 2));
  }
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
  font-size: var(--text-md);
  font-weight: var(--weight-bold);
  letter-spacing: -0.01em;
  color: var(--ui-text-strong);
  /* A long family name must never shove the settings/account buttons off the
     edge: cap it to the available width and ellipsize the overflow. min-width:0
     lets it shrink inside the switcher's flex row so the caret stays visible. */
  max-width: 100%;
  min-width: 0;
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
  /* Pin the row height and center its contents so the shorter member-count
     skeleton can't collapse the row and bounce the family name above it. */
  align-items: center;
  min-height: 1rem;
}

.family-members-count {
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  letter-spacing: -0.01em;
  color: var(--ui-text-muted);
  font-family: inherit;
}

/* ─── Family switcher ─────────────────────────────────────────────────────── */
.family-switcher-btn {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
  border: none;
  background: transparent;
  /* Real padding on every side so the hover fill has room. No negative margins:
     .topbar-left has overflow:hidden and would clip them, which is exactly why
     the hover looked like it had no padding. */
  padding: 0.4rem 0.5rem;
  border-radius: var(--radius-lg);
  cursor: pointer;
  text-align: left;
  transition: background var(--transition-fast);
  -webkit-tap-highlight-color: transparent;
}

.family-switcher-btn:hover {
  background: var(--bg-hover);
}

.family-switcher-caret {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ui-text-muted);
  /* chevron-left renders as "‹"; rotate it to a down-caret so it reads as a
     dropdown, and up while the switcher is open. */
  transform: rotate(-90deg);
  transition: transform var(--transition-base) ease;
}

.family-switcher-caret--open {
  transform: rotate(90deg);
}

.family-switcher-caret :deep(svg) {
  width: 100%;
  height: 100%;
  stroke: currentColor;
  stroke-width: 2.25;
  fill: none;
}

.family-switcher-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
}

.family-switcher-menu {
  position: fixed;
  top: calc(var(--safe-top) + 60px);
  left: max(1.25rem, calc((100vw - var(--desktop-column)) / 2));
  min-width: 280px;
  max-width: calc(100vw - 2.5rem);
  background: var(--bg-surface);
  border: var(--border-width-thin) solid var(--border-main);
  border-radius: var(--radius-2xl);
  box-shadow: var(--elevation-modal);
  padding: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.family-switcher-heading {
  margin: var(--space-2) var(--space-3) var(--space-1);
  font-size: var(--text-2xs);
  font-weight: var(--weight-extrabold);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-disabled);
}

.family-switcher-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  border: var(--border-width-thin) solid transparent;
  background: transparent;
  color: var(--text-primary);
  padding: var(--space-2);
  border-radius: var(--radius-lg);
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
  cursor: pointer;
  text-align: left;
  transition: background var(--transition-fast), border-color var(--transition-fast);
}

.family-switcher-item:hover {
  background: var(--bg-hover);
}

/* Active row: a quiet neutral fill, not a green wash — the green check is the
   only accent, so the monogram's own colour stays readable on top of it. */
.family-switcher-item--active {
  background: var(--bg-hover);
}

/* A stable identity tile per household, so families read as distinct at a
   glance rather than as identical text rows. */
.family-monogram {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: var(--text-base);
  font-weight: var(--weight-extrabold);
  letter-spacing: 0;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
}

/* Each family's members, shown as a small stack in place of the monogram. */
.family-switcher-avatars {
  flex-shrink: 0;
}

.family-switcher-avatars :deep(.member-avatar) {
  width: 26px;
  height: 26px;
  margin-left: -8px;
  border-color: var(--bg-surface);
}

.family-switcher-item--active .family-switcher-avatars :deep(.member-avatar) {
  border-color: var(--bg-hover);
}

.family-switcher-item-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.family-switcher-check {
  flex-shrink: 0;
  width: 15px;
  height: 15px;
  display: inline-flex;
  color: var(--color-primary);
}

.family-switcher-check :deep(svg) {
  width: 100%;
  height: 100%;
  stroke: currentColor;
  stroke-width: 2.5;
  fill: none;
}

.family-switcher-divider {
  height: 1px;
  background: var(--border-light);
  margin: var(--space-1) var(--space-2);
}

.family-switcher-add {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  border: none;
  border-radius: var(--radius-lg);
  background: transparent;
  color: var(--text-primary);
  padding: var(--space-2);
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
  cursor: pointer;
  text-align: left;
  transition: background var(--transition-fast);
}

.family-switcher-add:hover {
  background: var(--bg-hover);
}

.family-switcher-add-tile {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-disabled);
  background: var(--bg-hover);
  border: var(--border-width-thin) dashed var(--border-dark);
}

.family-switcher-add-tile :deep(svg) {
  width: 15px;
  height: 15px;
  display: block;
  stroke: currentColor;
  stroke-width: 2;
}

.family-switcher-add:hover .family-switcher-add-tile {
  color: var(--color-primary);
  border-color: color-mix(in srgb, var(--color-primary) 45%, transparent);
}

.family-switcher-cap-note {
  margin: 0;
  padding: 0.5rem 0.6rem 0.35rem;
  font-size: var(--text-xs);
  line-height: 1.4;
  color: var(--text-secondary);
}

/* The caret only earns its space on desktop; on mobile the tappable name is
   affordance enough, so drop it there. */
@media (max-width: 899.98px) {
  .family-switcher-caret {
    display: none;
  }
}

/* The cap note only earns its space on mobile. On desktop the absent "add"
   action already reads as "you're at the max", so hide the note there — and its
   divider with it, so nothing dangles below the family list. */
@media (min-width: 900px) {
  .family-switcher-cap-note,
  .family-switcher-divider--cap {
    display: none;
  }
}

.switcher-fade-enter-active,
.switcher-fade-leave-active {
  transition: opacity var(--transition-fast) ease;
}

.switcher-fade-enter-from,
.switcher-fade-leave-to {
  opacity: 0;
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
  border: var(--border-width-thick) solid var(--ui-border);
  background: var(--bg-hover);
  color: var(--ui-text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
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
  border: var(--border-width-thick) solid var(--ui-border);
  background: var(--bg-hover);
  padding: 0;
  cursor: pointer;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
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
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
  color: var(--ui-text-muted);
}
</style>
