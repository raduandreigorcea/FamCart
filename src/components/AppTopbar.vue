<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useAuth, useClerk, useUser } from '@clerk/vue'
import { useRouter } from 'vue-router'
import { useSupabase } from '../supabase.js'
import ConfirmModal from './ConfirmModal.vue'
import AccountActionModal from './AccountActionModal.vue'
import ModalCloseButton from './ModalCloseButton.vue'
import SkeletonBlock from './SkeletonBlock.vue'

// Raw SVG imports for settings modal
import layoutGridIcon from '../assets/layout-grid.svg?raw'
import settingsIconRaw from '../assets/settings.svg?raw'
import usersIcon from '../assets/users-round.svg?raw'
import trashIcon from '../assets/trash-2.svg?raw'
import copyIcon from '../assets/copy.svg?raw'
import checkIcon from '../assets/check.svg?raw'
import infoIcon from '../assets/info.svg?raw'
import crownIcon from '../assets/crown.svg?raw'
import squarePenIcon from '../assets/square-pen.svg?raw'
import shoppingCartIcon from '../assets/shopping-cart.svg?raw'
import ellipsisIcon from '../assets/ellipsis.svg?raw'

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
const FAMILY_NAME_MAX_LENGTH = 25

const { userId } = useAuth()
const clerk = useClerk()
const { user } = useUser()
const router = useRouter()
const db = useSupabase()

const accountMenuOpen = ref(false)
const signingOut = ref(false)

function openAccountMenu() {
  accountMenuOpen.value = true
}

function openAccountSettings() {
  accountMenuOpen.value = false
  clerk.value?.openUserProfile()
}

function openFamilySettingsTab(tab) {
  accountMenuOpen.value = false
  renameValue.value = props.familyName || ''
  activeTab.value = tab
  settingsOpen.value = true
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

const settingsOpen = ref(false)
const activeTab = ref('overview')
const renameValue = ref('')
const savingName = ref(false)
const nameSaved = ref(false)
const renameLength = computed(() => renameValue.value.length)
const renameOverLimit = computed(() => renameLength.value > FAMILY_NAME_MAX_LENGTH)
const itemLimitValue = ref(50)
const savingItemLimit = ref(false)
const itemLimitSaved = ref(false)
const regenerating = ref(false)
const codeRegenerated = ref(false)
const memberActionPendingId = ref('')
const openMemberMenuId = ref('')
const leavingFamily = ref(false);
const deletingFamily = ref(false)
const copied = ref(false)

// Confirm modal state
const confirmModal = ref({
  open: false,
  title: '',
  message: '',
  danger: false,
  confirmText: 'Confirm',
  cancelText: 'Cancel',
  showCancel: true,
  resolve: null,
})

function showConfirm({ title, message, danger = false, confirmText = 'Confirm', cancelText = 'Cancel', showCancel = true }) {
  return new Promise((resolve) => {
    confirmModal.value = { open: true, title, message, danger, confirmText, cancelText, showCancel, resolve }
  })
}

function handleConfirmModalResult(result) {
  const resolve = confirmModal.value.resolve
  confirmModal.value = {
    open: false,
    title: '',
    message: '',
    danger: false,
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    showCancel: true,
    resolve: null,
  }
  if (resolve) resolve(result)
}

async function showValidationErrorModal(message) {
  await showConfirm({
    title: 'Name Too Long',
    message,
    danger: true,
    confirmText: 'OK',
    showCancel: false,
  })
}

const memberCount = computed(() => props.memberProfiles.length);

const visibleMembers = computed(() => props.memberProfiles.slice(0, 4));
const extraMembers = computed(() => Math.max(0, memberCount.value - visibleMembers.value.length));
const isOwner = computed(() => !!props.ownerUserId && props.ownerUserId === userId.value)

function normalizeMemberRole(role) {
  if (role === 'admin') return 'moderator'
  return role === 'moderator' ? 'moderator' : 'member'
}

const currentUserRole = computed(() => {
  const membership = props.memberProfiles.find((m) => m.user_id === userId.value)
  return normalizeMemberRole(membership?.role)
})

const isOwnerOrModerator = computed(() => isOwner.value || currentUserRole.value === 'moderator')

const sortedMembers = computed(() => {
  return [...props.memberProfiles].sort((a, b) => {
    if (a.user_id === props.ownerUserId) return -1
    if (b.user_id === props.ownerUserId) return 1
    const roleA = normalizeMemberRole(a.role)
    const roleB = normalizeMemberRole(b.role)
    if (roleA === 'moderator' && roleB !== 'moderator') return -1
    if (roleB === 'moderator' && roleA !== 'moderator') return 1
    return 0
  })
})

const ownerProfile = computed(() => {
  return props.memberProfiles.find(m => m.user_id === props.ownerUserId)
})

function openSettings() {
  renameValue.value = props.familyName || ''
  itemLimitValue.value = Math.min(50, Math.max(1, Number(props.familyItemLimit) || 50))
  activeTab.value = 'overview'
  settingsOpen.value = true
}

async function copyInviteCode() {
  if (!props.inviteCode) return
  try {
    await navigator.clipboard.writeText(props.inviteCode)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    // no-op
  }
}

async function inviteMembersFromAccountMenu() {
  accountMenuOpen.value = false
  if (props.inviteCode) {
    await copyInviteCode()
    return
  }
  openFamilySettingsTab('overview')
}

async function leaveFamily() {
  if (!props.familyId || leavingFamily.value) return
  const confirmed = await showConfirm({
    title: 'Leave Family?',
    message: 'You will lose access to the shopping list and will need a new invite code to rejoin.',
    danger: true,
  })
  if (!confirmed) return
  leavingFamily.value = true
  db.from('family_members')
    .delete()
    .eq('family_id', props.familyId)
    .eq('user_id', userId.value)
    .then(({ error }) => {
      if (!error) {
        emit('refresh-family')
        router.replace('/family-setup')
      } else {
        console.error('Error leaving family:', error)
      }
    })
    .finally(() => {
      leavingFamily.value = false
    })
}

async function renameFamily() {
  if (!isOwner.value) return
  const nextName = renameValue.value.trim()
  if (!nextName || !props.familyId || savingName.value) return
  if (renameOverLimit.value || nextName.length > FAMILY_NAME_MAX_LENGTH) {
    await showValidationErrorModal(`Family name must be ${FAMILY_NAME_MAX_LENGTH} characters or fewer.`)
    return
  }
  savingName.value = true
  try {
    const { error } = await db
      .from('families')
      .update({ name: nextName })
      .eq('id', props.familyId)
    if (!error) {
      emit('refresh-family')
      nameSaved.value = true
      setTimeout(() => {
        nameSaved.value = false
      }, 2000)
    }
  } finally {
    savingName.value = false
  }
}

async function saveItemLimit() {
  if (!props.familyId || savingItemLimit.value) return

  const normalizedLimit = Math.min(50, Math.max(1, Number(itemLimitValue.value) || 1))
  itemLimitValue.value = normalizedLimit

  savingItemLimit.value = true
  try {
    const { error } = await db
      .from('families')
      .update({ max_items_per_member: normalizedLimit })
      .eq('id', props.familyId)

    if (!error) {
      emit('refresh-family')
      itemLimitSaved.value = true
      setTimeout(() => {
        itemLimitSaved.value = false
      }, 2000)
    }
  } finally {
    savingItemLimit.value = false
  }
}

function randomInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

async function regenerateInviteCode() {
  if (!props.familyId || regenerating.value) return
  const confirmed = await showConfirm({
    title: 'Regenerate Invite Code?',
    message: 'This will immediately invalidate the current invite code. Existing members are unaffected, but anyone with the old code will no longer be able to join.',
    danger: false,
  })
  if (!confirmed) return
  regenerating.value = true
  try {
    const { error } = await db
      .from('families')
      .update({ invite_code: randomInviteCode() })
      .eq('id', props.familyId)
    if (!error) {
      emit('refresh-family')
      codeRegenerated.value = true
      setTimeout(() => {
        codeRegenerated.value = false
      }, 2000)
    }
  } finally {
    regenerating.value = false
  }
}

async function removeMember(memberUserId) {
  if (!props.familyId || memberActionPendingId.value) return
  const confirmed = await showConfirm({
    title: 'Remove Member?',
    message: 'This person will immediately lose access to the family shopping list. They can be re-invited using the invite code.',
    danger: true,
  })
  if (!confirmed) return
  memberActionPendingId.value = memberUserId
  openMemberMenuId.value = ''
  try {
    const { error } = await db
      .from('family_members')
      .delete()
      .eq('family_id', props.familyId)
      .eq('user_id', memberUserId)
    if (!error) emit('refresh-family')
  } finally {
    memberActionPendingId.value = ''
  }
}

function toggleMemberMenu(memberUserId) {
  if (memberActionPendingId.value) return
  openMemberMenuId.value = openMemberMenuId.value === memberUserId ? '' : memberUserId
}

function closeMemberMenu() {
  openMemberMenuId.value = ''
}

function handleGlobalPointerDown(event) {
  if (!openMemberMenuId.value) return

  const target = event.target
  if (!(target instanceof Element)) {
    closeMemberMenu()
    return
  }

  if (target.closest('.member-actions-menu-wrap')) return
  closeMemberMenu()
}

onMounted(() => {
  window.addEventListener('pointerdown', handleGlobalPointerDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', handleGlobalPointerDown)
})

function canManageMember(member) {
  if (!isOwnerOrModerator.value) return false
  if (member.user_id === props.ownerUserId) return false
  if (member.user_id === userId.value) return false
  return true
}

function canPromoteToModerator(member) {
  return isOwner.value && normalizeMemberRole(member.role) !== 'moderator'
}

function canDemoteFromModerator(member) {
  return isOwner.value && normalizeMemberRole(member.role) === 'moderator'
}

async function setMemberRole(memberUserId, role) {
  if (!isOwner.value) return
  if (!props.familyId || memberActionPendingId.value) return
  memberActionPendingId.value = memberUserId
  try {
    const { error } = await db
      .from('family_members')
      .update({ role })
      .eq('family_id', props.familyId)
      .eq('user_id', memberUserId)
    if (!error) {
      emit('refresh-family')
      openMemberMenuId.value = ''
    }
  } finally {
    memberActionPendingId.value = ''
  }
}

async function deleteFamily() {
  if (!props.familyId || deletingFamily.value) return
  const confirmed = await showConfirm({
    title: 'Delete Family Group?',
    message: `Deleting "${props.familyName}" will permanently remove all members, shopping list items, and history. This action cannot be undone.`,
    danger: true,
  })
  if (!confirmed) return
  deletingFamily.value = true
  try {
    const { error } = await db
      .from('families')
      .delete()
      .eq('id', props.familyId)
    if (!error) {
      settingsOpen.value = false
      emit('family-deleted')
      router.replace('/family-setup')
    }
  } finally {
    deletingFamily.value = false
  }
}
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

  <!-- Settings Modal Overlay -->
  <Transition name="modal-fade">
    <div v-if="settingsOpen" class="settings-modal-overlay" @click.self="settingsOpen = false; closeMemberMenu()">
      <div class="settings-modal" role="dialog" aria-modal="true" aria-label="Settings">
        
        <!-- Modal Header -->
        <div class="settings-modal__header">
          <div class="settings-modal__title-wrap">
            <div class="settings-modal__icon-bg">
              <span class="header-icon" v-html="settingsIconRaw"></span>
            </div>
            <div>
              <h3>Family Settings</h3>
              <p class="settings-modal__subtitle">{{ familyName }}</p>
            </div>
          </div>
          <ModalCloseButton aria-label="Close settings" @click="settingsOpen = false" />
        </div>

        <!-- Modal Body Container -->
        <div class="settings-modal__body">
          
          <!-- Sidebar Navigation -->
          <nav class="settings-sidebar">
            <button 
              class="sidebar-tab-btn" 
              :class="{ active: activeTab === 'overview' }"
              @click="activeTab = 'overview'"
            >
              <span class="tab-icon" v-html="layoutGridIcon"></span>
              <span>Overview</span>
            </button>

            <button 
              v-if="isOwnerOrModerator"
              class="sidebar-tab-btn" 
              :class="{ active: activeTab === 'family' }"
              @click="activeTab = 'family'"
            >
              <span class="tab-icon" v-html="settingsIconRaw"></span>
              <span>Preferences</span>
            </button>

            <button 
              class="sidebar-tab-btn" 
              :class="{ active: activeTab === 'members' }"
              @click="activeTab = 'members'"
            >
              <span class="tab-icon" v-html="usersIcon"></span>
              <span>Members</span>
              <span class="tab-badge">{{ memberCount }}</span>
            </button>

            <button 
              class="sidebar-tab-btn sidebar-tab-btn--danger" 
              :class="{ active: activeTab === 'danger' }" 
              v-if="!isOwner"
              @click="activeTab = 'danger'"
            >
              <span class="tab-icon" v-html="trashIcon"></span>
              <span>Danger Zone</span>
            </button>

            <button 
              v-if="isOwner"
              class="sidebar-tab-btn sidebar-tab-btn--danger" 
              :class="{ active: activeTab === 'danger' }"
              @click="activeTab = 'danger'"
            >
              <span class="tab-icon" v-html="trashIcon"></span>
              <span>Danger Zone</span>
            </button>
          </nav>

          <!-- Content Panel Area -->
          <main class="settings-content-wrapper">
            
            <!-- OVERVIEW PANEL -->
            <div v-if="activeTab === 'overview'" class="tab-panel">
              <div class="panel-section">
                <h4 class="panel-section-title">Family Summary</h4>
                
                <div class="summary-card">
                  <div class="summary-details">
                    <div class="summary-row">
                      <span class="summary-label">Family Name</span>
                      <span class="summary-value highlight">{{ familyName }}</span>
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
                <p class="panel-section-desc">Share this code with your family members so they can join your list.</p>
                
                <div class="invite-card">
                  <div class="invite-code-container">
                    <span class="invite-code-label">INVITE CODE</span>
                    <span class="invite-code-value">{{ inviteCode }}</span>
                  </div>
                  <button 
                    class="invite-copy-btn" 
                    :class="{ 'invite-copy-btn--copied': copied }"
                    type="button" 
                    @click="copyInviteCode"
                  >
                    <span class="btn-icon-wrap" v-html="copied ? checkIcon : copyIcon"></span>
                    <span>{{ copied ? 'Copied!' : 'Copy Code' }}</span>
                  </button>
                </div>
              </div>

              <div class="panel-section info-box-section">
                <div class="info-box">
                  <span class="info-box-icon-wrap" v-html="infoIcon"></span>
                  <p class="settings-note-text">
                    Use your profile menu on the top right of the dashboard screen to sign out or manage your personal account settings.
                  </p>
                </div>
              </div>
            </div>

            <!-- PREFERENCES PANEL (Owner + Moderators) -->
            <div v-if="activeTab === 'family' && isOwnerOrModerator" class="tab-panel">
              <div class="panel-section">
                <h4 class="panel-section-title">General Preferences</h4>

                <div class="preferences-grid">
                  <section v-if="isOwner" class="card-item pref-card">
                    <div class="pref-card__head">
                      <span class="pref-card__icon" v-html="squarePenIcon"></span>
                      <div class="pref-card__meta">
                        <h5>Family Name</h5>
                        <p>Choose a name everyone in your household can recognize quickly.</p>
                      </div>
                    </div>

                    <div class="card-item__form">
                      <div class="input-action-group">
                        <div class="input-wrapper">
                          <input
                            id="familyNameInput"
                            v-model="renameValue"
                            class="panel-input"
                            type="text"
                            placeholder="My Awesome Family"
                          />
                        </div>
                        <div class="panel-save-stack">
                          <button
                            class="panel-save-btn"
                            type="button"
                            :disabled="savingName"
                            @click="renameFamily"
                          >
                            <span v-if="savingName" class="btn-spinner"></span>
                            <span v-else-if="nameSaved" class="success-state animate-pop">
                              <span class="success-icon-wrap" v-html="checkIcon"></span>
                              Saved
                            </span>
                            <span v-else>Save</span>
                          </button>
                          <p class="panel-counter panel-counter--under-save" :class="{ 'panel-counter--danger': renameOverLimit }">
                            {{ renameLength }}/{{ FAMILY_NAME_MAX_LENGTH }}
                          </p>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section class="card-item pref-card">
                    <div class="pref-card__head">
                      <span class="pref-card__icon" v-html="shoppingCartIcon"></span>
                      <div class="pref-card__meta">
                        <h5>Item Limit Per User</h5>
                        <p>Control how many active (unchecked) items each member can add.</p>
                      </div>
                      <span class="pref-card__value">{{ itemLimitValue }}</span>
                    </div>

                    <div class="pref-range-wrap">
                      <span class="pref-range-minmax">1</span>
                      <input
                        v-model.number="itemLimitValue"
                        class="pref-range"
                        type="range"
                        min="1"
                        max="50"
                        step="1"
                        aria-label="Item limit slider"
                      />
                      <span class="pref-range-minmax">50</span>
                    </div>

                    <div class="card-item__form">
                      <div class="input-action-group input-action-group--end">
                        <button
                          class="panel-save-btn"
                          type="button"
                          :disabled="savingItemLimit"
                          @click="saveItemLimit"
                        >
                          <span v-if="savingItemLimit" class="btn-spinner"></span>
                          <span v-else-if="itemLimitSaved" class="success-state animate-pop">
                            <span class="success-icon-wrap" v-html="checkIcon"></span>
                            Saved
                          </span>
                          <span v-else>Save</span>
                        </button>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            </div>

            <!-- MEMBERS PANEL -->
            <div v-if="activeTab === 'members'" class="tab-panel">
              <div class="panel-section">
                <h4 class="panel-section-title">Family Members ({{ memberCount }})</h4>
                <p class="panel-section-desc">Below are the people who have access to this shopping list.</p>
                
                <div class="members-list-wrapper">
                  <ul class="members-custom-list">
                    <li
                      v-for="member in sortedMembers"
                      :key="member.user_id"
                      class="member-custom-item"
                      :class="{ 'member-custom-item--menu-open': openMemberMenuId === member.user_id }"
                    >
                      <div class="member-custom-left">
                        <img 
                          v-if="member.image_url" 
                          :src="member.image_url" 
                          :alt="(member.display_name || 'Member') + ' avatar'" 
                          class="member-custom-avatar" 
                        />
                        <span v-else class="member-custom-avatar member-custom-avatar--fallback">
                          {{ (member.display_name || '?').slice(0,1).toUpperCase() }}
                        </span>
                        <div class="member-custom-details">
                          <span class="member-custom-name">
                            {{ member.display_name || 'Member' }}
                            <span v-if="member.user_id === userId" class="you-tag">(You)</span>
                          </span>
                        </div>
                      </div>
                      <div class="member-custom-right">
                        <!-- Badges -->
                        <span v-if="member.user_id === ownerUserId" class="member-role-badge role-owner">
                          <span class="badge-icon-wrap" v-html="crownIcon"></span>
                          Owner
                        </span>

                        <div
                          v-if="canManageMember(member)"
                          class="member-actions-menu-wrap"
                          :class="{ 'member-actions-menu-wrap--open': openMemberMenuId === member.user_id }"
                          @click.stop
                        >
                          <button
                            class="member-actions-trigger"
                            type="button"
                            aria-label="Open member actions"
                            :disabled="memberActionPendingId === member.user_id"
                            @click.stop="toggleMemberMenu(member.user_id)"
                          >
                            <span v-if="memberActionPendingId === member.user_id" class="btn-spinner btn-spinner--dark"></span>
                            <span v-else class="member-actions-icon" v-html="ellipsisIcon"></span>
                          </button>

                          <div v-if="openMemberMenuId === member.user_id" class="member-actions-menu">
                            <button
                              v-if="canPromoteToModerator(member)"
                              class="member-action-item"
                              type="button"
                              @click="setMemberRole(member.user_id, 'moderator')"
                            >
                              Promote to moderator
                            </button>
                            <button
                              v-if="canDemoteFromModerator(member)"
                              class="member-action-item"
                              type="button"
                              @click="setMemberRole(member.user_id, 'member')"
                            >
                              Demote to member
                            </button>
                            <button
                              class="member-action-item member-action-item--danger"
                              type="button"
                              @click="removeMember(member.user_id)"
                            >
                              Remove from family
                            </button>
                          </div>
                        </div>

                        <span v-if="member.user_id !== ownerUserId && normalizeMemberRole(member.role) === 'moderator'" class="member-role-badge role-moderator">Moderator</span>
                        <span v-if="member.user_id !== ownerUserId && normalizeMemberRole(member.role) !== 'moderator'" class="member-role-badge role-member">Member</span>
                      </div>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
            <!-- DANGER ZONE PANEL (Owner Only + Member Leave) -->
            <div v-if="activeTab === 'danger'" class="tab-panel">
              <!-- Invite Code Regen Card -->
              <div class="panel-section" v-if="isOwnerOrModerator">
                <h4 class="panel-section-title">Invite Code Administration</h4>
                <div class="card-item card-item--action">
                  <div class="card-item__info">
                    <p>Immediately invalidates the current invite code. Existing members are unaffected, but future members must use the new code.</p>
                  </div>
                  <button
                    class="panel-action-btn"
                    type="button"
                    :disabled="regenerating"
                    @click="regenerateInviteCode"
                  >
                    <span v-if="regenerating" class="btn-spinner"></span>
                    <span v-else-if="codeRegenerated" class="success-state animate-pop">
                      <span class="success-icon-wrap" v-html="checkIcon"></span>
                      Regenerated
                    </span>
                    <span v-else>Regenerate</span>
                  </button>
                </div>
              </div>

              <!-- Leave Family Card (Visible to non-owners) -->
              <div class="panel-section" v-if="!isOwner">
                <h4 class="panel-section-title text-danger">Leave Family</h4>
                <div class="card-item card-item--action">
                  <div class="card-item__info">
                    <p>This will remove you from the family group. You will no longer have access to the shopping list.</p>
                  </div>
                  <button class="danger-action-btn" type="button" :disabled="leavingFamily" @click="leaveFamily">Leave Family</button>
                </div>
              </div>

              <!-- Delete Family Card -->
              <div class="panel-section" v-if="isOwner">
                <h4 class="panel-section-title text-danger">Delete Family Group</h4>
                <div class="card-item card-item--action card-item--danger">
                  <div class="card-item__info">
                    <p>Permanently deletes <strong>{{ familyName }}</strong>, removes all members, and erases all shopping list data. This cannot be undone.</p>
                  </div>
                  <button
                    class="danger-action-btn danger-action-btn--delete"
                    type="button"
                    :disabled="deletingFamily"
                    @click="deleteFamily"
                  >
                    <span v-if="deletingFamily" class="btn-spinner btn-spinner--light"></span>
                    <span v-else>Delete Family</span>
                  </button>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  </Transition>

  <!-- Confirm Modal -->
  <ConfirmModal
    :open="confirmModal.open"
    :title="confirmModal.title"
    :message="confirmModal.message"
    :danger="confirmModal.danger"
    :confirm-text="confirmModal.confirmText"
    :cancel-text="confirmModal.cancelText"
    :show-cancel="confirmModal.showCancel"
    @confirm="handleConfirmModalResult(true)"
    @cancel="handleConfirmModalResult(false)"
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

/* Modal Overrides & Premium Revamp */
.settings-modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-dark);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
  padding: var(--space-4);
}

.settings-modal {
  width: 100%;
  max-width: 640px;
  background: var(--bg-surface);
  border-radius: var(--radius-3xl);
  border: 1px solid var(--ui-border);
  box-shadow: var(--elevation-modal);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  max-height: min(85vh, 600px);
}

.settings-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-5) var(--space-6);
  border-bottom: 1px solid var(--ui-border-soft);
  background: var(--bg-surface);
}

.settings-modal__title-wrap {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.settings-modal__icon-bg {
  width: 38px;
  height: 38px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-primary) 10%, var(--bg-surface));
  color: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.header-icon {
  width: 22px;
  height: 22px;
}

.settings-modal__header h3 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 800;
  color: var(--ui-text-strong);
  letter-spacing: -0.02em;
}

.settings-modal__subtitle {
  margin: 0.1rem 0 0;
  font-size: 0.8rem;
  color: var(--ui-text-muted);
  font-weight: 500;
}


/* Modal Body split screen */
.settings-modal__body {
  display: grid;
  grid-template-columns: 180px 1fr;
  background: var(--bg-surface);
  height: 480px;
  overflow: hidden;
}

@media (max-width: 580px) {
  .settings-modal__body {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
    height: 520px;
  }
}

/* Sidebar Nav */
.settings-sidebar {
  padding: 1.25rem 0.75rem;
  border-right: 1px solid var(--ui-border-soft);
  background: var(--bg-surface-alt);
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

@media (max-width: 580px) {
  .settings-sidebar {
    flex-direction: row;
    padding: 0.75rem;
    border-right: none;
    border-bottom: 1px solid var(--ui-border-soft);
    overflow-x: auto;
    gap: 0.5rem;
    scrollbar-width: none; /* Hide scrollbar for clean tab-bar look */
  }
  .settings-sidebar::-webkit-scrollbar {
    display: none;
  }
}

.sidebar-tab-btn {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.65rem 0.75rem;
  border-radius: var(--radius-md);
  border: none;
  background: transparent;
  color: var(--ui-text-muted);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
  transition: background 0.25s cubic-bezier(0.4, 0, 0.2, 1), color 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  width: 100%;
}

.sidebar-tab-btn:hover:not(.active) {
  background: var(--bg-hover);
  color: var(--ui-text-strong);
}

@media (max-width: 580px) {
  .sidebar-tab-btn {
    width: auto;
    white-space: nowrap;
    padding: 0.5rem 0.85rem;
  }
  .sidebar-tab-btn:hover {
    transform: none;
  }
}

.sidebar-tab-btn.active {
  background: color-mix(in srgb, var(--color-primary) 8%, var(--bg-surface));
  color: var(--color-primary);
}

.sidebar-tab-btn--danger:hover:not(.active) {
  background: var(--danger-bg);
  color: var(--danger-text);
}

.sidebar-tab-btn--danger.active {
  background: var(--danger-bg);
  color: var(--danger-text);
}

.tab-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.tab-icon :deep(svg) {
  width: 100%;
  height: 100%;
  stroke: currentColor;
  stroke-width: 1.75;
  fill: none;
}

.header-icon {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.header-icon :deep(svg) {
  width: 100%;
  height: 100%;
  stroke: currentColor;
  stroke-width: 2;
  fill: none;
}

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

.badge-icon-wrap {
  width: 10px;
  height: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.badge-icon-wrap :deep(svg) {
  width: 100%;
  height: 100%;
  stroke: currentColor;
  stroke-width: 2;
  fill: none;
}

.success-icon-wrap {
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.success-icon-wrap :deep(svg) {
  width: 100%;
  height: 100%;
  stroke: currentColor;
  stroke-width: 3;
  fill: none;
}

.tab-badge {
  margin-left: auto;
  font-size: 0.7rem;
  background: var(--border-light);
  color: var(--text-secondary);
  padding: 0.15rem 0.4rem;
  border-radius: var(--radius-pill);
  font-weight: 700;
}

.sidebar-tab-btn.active .tab-badge {
  background: var(--color-primary);
  color: var(--text-inverse);
}

/* Content Area */
.settings-content-wrapper {
  padding: var(--space-6);
  overflow-y: auto;
  background: var(--bg-surface);
}

/* Panels */
.tab-panel {
  animation: panelFadeIn 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  min-height: 100%;
}

.panel-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.panel-section-title {
  margin: 0;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ui-text-muted);
  font-weight: 700;
}

.panel-section-title.text-danger {
  color: var(--danger-text);
}

.panel-section-desc {
  margin: 0 0 0.25rem;
  font-size: 0.8rem;
  color: var(--ui-text-muted);
  line-height: 1.4;
}

.panel-section-desc.min-margin {
  margin-bottom: 0.1rem;
}

/* Overview Panel cards */
.summary-card {
  border: 1px solid var(--ui-border-soft);
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
  font-size: 0.85rem;
}

.summary-label {
  color: var(--ui-text-muted);
  font-weight: 500;
}

.summary-value {
  color: var(--ui-text-strong);
  font-weight: 700;
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
  border: 1px solid var(--ui-border-soft);
}

.owner-avatar-mini {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  object-fit: cover;
}

.owner-name {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--ui-text-strong);
}

/* Invite card */
.invite-card {
  border: 1.5px dashed color-mix(in srgb, var(--color-primary) 35%, var(--border-light));
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
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  font-weight: 800;
  color: var(--ui-text-muted);
}

.invite-code-value {
  font-family: 'SF Mono', Consolas, Monaco, 'Andale Mono', monospace;
  font-size: 1.35rem;
  font-weight: 800;
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
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
}

.invite-copy-btn:hover {
  background: color-mix(in srgb, var(--color-primary) 85%, var(--text-primary));
  transform: translateY(-1px);
  box-shadow: var(--elevation-primary);
}

.invite-copy-btn--copied {
  background: var(--color-primary-bg);
  color: var(--color-primary-text);
  border: 1px solid var(--color-primary-bg);
}

.invite-copy-btn--copied:hover {
  background: var(--color-primary-bg);
  color: var(--color-primary-text);
  transform: none;
  box-shadow: none;
}

.btn-icon {
  width: 15px;
  height: 15px;
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
  border: 1px solid var(--ui-border-soft);
  padding: var(--space-3) 0.9rem;
  border-radius: var(--radius-md);
}

.info-box-icon {
  width: 16px;
  height: 16px;
  color: var(--ui-text-muted);
  flex-shrink: 0;
  margin-top: 0.1rem;
}

.settings-note-text {
  margin: 0;
  font-size: 0.76rem;
  color: var(--ui-text-muted);
  line-height: 1.45;
}

.preferences-grid {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.pref-card {
  background: linear-gradient(
    160deg,
    color-mix(in srgb, var(--color-primary) 3%, var(--bg-surface)) 0%,
    var(--bg-surface) 60%
  );
}

.pref-card__head {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  margin-bottom: 0.7rem;
}

.pref-card__meta {
  min-width: 0;
  flex: 1;
}

.pref-card__meta h5 {
  margin: 0;
  font-size: 0.86rem;
  font-weight: 800;
  color: var(--ui-text-strong);
}

.pref-card__meta p {
  margin: 0.18rem 0 0;
  font-size: 0.75rem;
  line-height: 1.45;
  color: var(--ui-text-muted);
}

.pref-card__icon {
  width: 20px;
  height: 20px;
  color: var(--color-primary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.pref-card__icon :deep(svg) {
  width: 100%;
  height: 100%;
  stroke: currentColor;
  stroke-width: 2;
  fill: none;
}

.pref-card__value {
  font-family: 'SF Mono', Consolas, Monaco, 'Andale Mono', monospace;
  font-size: 0.88rem;
  font-weight: 800;
  color: var(--ui-text-strong);
  background: var(--bg-surface-alt);
  border: 1px solid var(--ui-border-soft);
  border-radius: var(--radius-sm);
  padding: 0.22rem 0.5rem;
  min-width: 2.2rem;
  text-align: center;
}

.pref-range-wrap {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.6rem;
}

.pref-range-minmax {
  font-size: 0.74rem;
  font-weight: 700;
  color: var(--ui-text-muted);
  min-width: 1rem;
  text-align: center;
}

.pref-range {
  flex: 1;
  appearance: none;
  height: 4px;
  border-radius: var(--radius-pill);
  background: var(--border-light);
  outline: none;
}

.pref-range::-webkit-slider-thumb {
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-primary);
  border: 2px solid var(--bg-surface);
  box-shadow: var(--elevation-soft);
  cursor: pointer;
}

.pref-range::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-primary);
  border: 2px solid var(--bg-surface);
  box-shadow: var(--elevation-soft);
  cursor: pointer;
}

/* Form Settings (Preferences) */
.card-item {
  border: 1px solid var(--ui-border-soft);
  background: var(--bg-surface);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  transition: all 0.2s ease;
}

.card-item:focus-within {
  border-color: color-mix(in srgb, var(--color-primary) 30%, var(--border-light));
  box-shadow: var(--elevation-soft);
}

.card-item__form {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.panel-label {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--ui-text-strong);
}

.panel-label--with-icon {
  display: inline-flex;
  align-items: center;
  gap: 0.38rem;
}

.panel-label-icon {
  width: 14px;
  height: 14px;
  color: var(--ui-text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.panel-label-icon :deep(svg) {
  width: 100%;
  height: 100%;
  stroke: currentColor;
  stroke-width: 2;
  fill: none;
}

.input-action-group {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.15rem;
  align-items: flex-start;
}

.input-action-group--end {
  justify-content: flex-end;
}

.input-wrapper {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.panel-input {
  width: 100%;
  border: 1px solid var(--ui-border);
  border-radius: var(--radius-md);
  padding: 0.55rem 0.75rem;
  font-size: 0.88rem;
  background: var(--bg-surface);
  color: var(--ui-text-strong);
  transition: all 0.2s ease;
}

.panel-input:focus {
  border-color: var(--color-primary);
  box-shadow: var(--focus-ring-primary);
  outline: none;
}

.panel-input::placeholder {
  color: var(--border-dark);
}

.panel-counter {
  margin: 0.25rem 0 0;
  text-align: right;
  font-size: 0.75rem;
  color: var(--ui-text-muted);
}

.panel-counter--under-save {
  min-width: 82px;
  text-align: center;
}

.panel-save-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.panel-counter--danger {
  color: var(--danger-main);
  font-weight: 700;
}

.panel-save-btn {
  background: var(--bg-hover);
  color: var(--ui-text-strong);
  border: 1px solid var(--ui-border-soft);
  border-radius: var(--radius-md);
  padding: 0.55rem 1rem;
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 82px;
}

.panel-save-btn:hover:not(:disabled) {
  background: var(--border-light);
  border-color: var(--border-dark);
}

.panel-save-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Card Action (Regenerate code) */
.card-item--action {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1.5rem;
  background: var(--bg-surface);
}

@media (max-width: 480px) {
  .card-item--action {
    flex-direction: column;
    gap: 0.75rem;
  }
  .card-item--action .panel-action-btn {
    width: auto;
    align-self: flex-start;
    justify-content: flex-start;
  }
}

.card-item__info h5 {
  margin: 0 0 0.2rem 0;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--ui-text-strong);
}

.card-item__info p {
  margin: 0;
  font-size: 0.78rem;
  color: var(--ui-text-muted);
  line-height: 1.45;
}

.panel-action-btn {
  background: var(--bg-surface);
  color: var(--ui-text-strong);
  border: 1px solid var(--ui-border);
  border-radius: var(--radius-md);
  padding: 0.55rem 0.9rem;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 100px;
}

.panel-action-btn:hover:not(:disabled) {
  background: var(--bg-surface-alt);
  border-color: var(--border-dark);
}

.panel-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Loaders and success checks */
.btn-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid transparent;
  border-top-color: var(--ui-text-strong);
  border-radius: 50%;
  animation: btnSpin 0.6s linear infinite;
}

.btn-spinner--dark {
  border-top-color: var(--danger-main);
}

.btn-spinner--light {
  border-top-color: var(--text-inverse);
}

@keyframes btnSpin {
  to {
    transform: rotate(360deg);
  }
}

.success-state {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--color-primary-text);
  font-weight: 700;
}

.inline-success-icon {
  width: 14px;
  height: 14px;
  stroke-width: 3;
}

/* Members tab styling */
.members-list-wrapper {
  border: 1px solid var(--ui-border-soft);
  border-radius: var(--radius-lg);
  overflow: visible;
  background: var(--bg-surface);
}

.members-custom-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.member-custom-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--ui-border-soft);
  gap: 1rem;
  position: relative;
  overflow: visible;
}

.member-custom-item--menu-open {
  z-index: 7000;
}

.member-custom-item:last-child {
  border-bottom: none;
}

.member-custom-left {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-width: 0;
}

.member-custom-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--ui-border-soft);
  background: var(--bg-hover);
  flex-shrink: 0;
}

.member-custom-avatar--fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--ui-text-muted);
}

.member-custom-details {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.member-custom-name {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--ui-text-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.you-tag {
  font-size: 0.75rem;
  color: var(--color-primary);
  font-weight: 600;
  margin-left: 0.2rem;
}

.member-custom-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
  position: relative;
  overflow: visible;
}

.member-role-badge {
  font-size: 0.68rem;
  font-weight: 700;
  padding: 0.15rem 0.45rem;
  border-radius: var(--radius-xs);
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
}

.role-owner {
  background: var(--warning-bg);
  color: var(--warning-text);
  border: 1px solid var(--warning-border);
}

.badge-icon {
  width: 10px;
  height: 10px;
}

.role-member {
  background: var(--bg-hover);
  color: var(--text-secondary);
  border: 1px solid var(--border-light);
}

.role-moderator {
  background: color-mix(in srgb, var(--color-primary) 10%, var(--bg-surface));
  color: var(--color-primary-text);
  border: 1px solid color-mix(in srgb, var(--color-primary) 28%, var(--bg-surface));
}

.member-actions-menu-wrap {
  position: relative;
}

.member-actions-menu-wrap--open {
  z-index: 6000;
}

.member-actions-trigger {
  width: 28px;
  height: 28px;
  border: 1px solid var(--ui-border-soft);
  background: var(--bg-surface);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}

.member-actions-trigger:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.member-actions-trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.member-actions-icon {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.member-actions-icon :deep(svg) {
  width: 100%;
  height: 100%;
  stroke: currentColor;
  stroke-width: 2;
  fill: none;
}

.member-actions-menu {
  position: absolute;
  top: calc(100% + 0.25rem);
  right: 0;
  left: auto;
  z-index: 6100;
  min-width: 190px;
  padding: 0.25rem;
  border: 1px solid color-mix(in srgb, var(--border-dark) 45%, var(--ui-border-soft));
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-surface-alt) 88%, var(--border-light));
  box-shadow: 0 12px 28px var(--shadow-popover);
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  animation: memberMenuIn 0.16s cubic-bezier(0.2, 0.9, 0.2, 1) forwards;
  transform-origin: top right;
}

.member-action-item {
  border: none;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  font-size: 0.78rem;
  font-weight: 600;
  border-radius: var(--radius-sm);
  padding: 0.45rem 0.55rem;
  cursor: pointer;
}

.member-action-item:hover {
  background: var(--bg-hover);
}

.member-action-item--danger {
  color: var(--danger-text);
}

.member-action-item--danger:hover {
  background: var(--danger-bg);
}

@keyframes memberMenuIn {
  from {
    opacity: 0;
    transform: translateY(-4px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* Danger zone card modifier */
.card-item--danger {
  border-color: var(--danger-border);
  background: var(--danger-bg);
}

.danger-action-btn {
  background: var(--danger-solid);
  color: var(--text-inverse);
  border: none;
  border-radius: var(--radius-md);
  padding: 0.6rem 1.25rem;
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: var(--elevation-danger-subtle);
  white-space: nowrap;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 100px;
}

.danger-action-btn:hover:not(:disabled) {
  background: var(--danger-solid-hover);
  transform: translateY(-1px);
  box-shadow: var(--elevation-danger-hover);
}

.danger-action-btn--delete:hover:not(:disabled) {
  transform: none;
}

.danger-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Animations & Transitions */
@keyframes panelFadeIn {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-pop {
  animation: tickPop 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

@keyframes tickPop {
  0% {
    transform: scale(0.85);
    opacity: 0.5;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

/* Modal Transitions */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.18s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-fade-enter-active .settings-modal {
  animation: modalScaleIn 0.18s cubic-bezier(0.2, 0.9, 0.2, 1) forwards;
}

.modal-fade-leave-active .settings-modal {
  animation: modalScaleOut 0.16s cubic-bezier(0.4, 0, 1, 1) forwards;
}

@keyframes modalScaleIn {
  from {
    transform: scale(0.96);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

@keyframes modalScaleOut {
  from {
    transform: scale(1);
    opacity: 1;
  }
  to {
    transform: scale(0.96);
    opacity: 0;
  }
}

@media (max-width: 520px) {
  .settings-modal-overlay {
    align-items: flex-end;
    padding: 0;
  }

  .settings-modal {
    max-width: none;
    height: min(88dvh, 760px);
    max-height: min(88dvh, 760px);
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    border-left: none;
    border-right: none;
    border-bottom: none;
  }

  .settings-modal__header {
    padding: 1rem;
  }

  .settings-modal__body {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
    height: 100%;
  }

  .settings-sidebar {
    flex-direction: row;
    padding: 0.75rem;
    border-right: none;
    border-bottom: 1px solid var(--ui-border-soft);
    overflow-x: auto;
    gap: 0.5rem;
    scrollbar-width: none;
  }

  .settings-sidebar::-webkit-scrollbar {
    display: none;
  }

  .sidebar-tab-btn {
    width: auto;
    white-space: nowrap;
    padding: 0.5rem 0.85rem;
  }

  .sidebar-tab-btn:hover {
    transform: none;
  }
}


</style>
