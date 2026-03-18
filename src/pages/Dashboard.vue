<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { UserButton, useUser } from '@clerk/vue'
import FamilySetup from '../components/FamilySetup.vue'
import ShoppingList from '../components/ShoppingList.vue'
import SettingsModal from '../components/SettingsModal.vue'
import { supabase } from '../lib/supabase.js'
import type { Family, FamilyMember } from '../types'

const { user } = useUser()

const family = ref<Family | null>(null)
const familyMembers = ref<FamilyMember[]>([])
const membershipRole = ref('member')
const loadingFamily = ref(true)
const errorMessage = ref('')

const userId = computed(() => user.value?.id ?? '')
const pageTitle = computed(() => family.value?.name ?? 'Set Up Your Family')
const memberCount = computed(() => familyMembers.value.length)
const memberCountLabel = computed(() => {
  if (!family.value) return ''
  return `${memberCount.value} member${memberCount.value === 1 ? '' : 's'}`
})
const visibleMembers = computed(() => familyMembers.value.slice(0, 4))
const overflowMembers = computed(() => Math.max(0, familyMembers.value.length - 4))
const isAdmin = computed(() => membershipRole.value === 'admin')
const showSettings = ref(false)
const showMembers = ref(false)
const pendingKick = ref<FamilyMember | null>(null)
const kickLoading = ref(false)
const kickError = ref('')

function formatJoinDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function getCurrentUserDisplayName() {
  return (
    user.value?.fullName?.trim()
    || user.value?.firstName?.trim()
    || user.value?.username?.trim()
    || null
  )
}

function getAvatarUrl(member: FamilyMember) {
  if (member.user_id === userId.value && user.value?.imageUrl) {
    return user.value.imageUrl
  }

  if (member.image_url) return member.image_url
  return `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(member.user_id)}`
}

function getMemberName(member: FamilyMember) {
  if (member.user_id === userId.value) {
    const currentName = getCurrentUserDisplayName()
    if (currentName) return currentName
  }

  if (member.display_name?.trim()) return member.display_name.trim()
  return `${member.user_id.slice(0, 14)}${member.user_id.length > 14 ? '...' : ''}`
}

async function fetchFamilyMembers(familyId: string) {
  const response = await supabase
    .from('family_members')
    .select('*')
    .eq('family_id', familyId)
    .order('joined_at', { ascending: true })

  if (response.error) throw response.error
  return (response.data as FamilyMember[]) ?? []
}

function requestKick(member: FamilyMember) {
  if (!isAdmin.value || member.user_id === userId.value) return
  kickError.value = ''
  pendingKick.value = member
}

function closeKickDialog() {
  if (kickLoading.value) return
  pendingKick.value = null
}

async function confirmKick() {
  if (!family.value || !pendingKick.value || !isAdmin.value) return

  kickLoading.value = true
  kickError.value = ''

  const memberUserId = pendingKick.value.user_id
  const response = await supabase
    .from('family_members')
    .delete()
    .eq('family_id', family.value.id)
    .eq('user_id', memberUserId)

  if (response.error) {
    kickError.value = response.error.message
    kickLoading.value = false
    return
  }

  familyMembers.value = familyMembers.value.filter((member) => member.user_id !== memberUserId)
  pendingKick.value = null
  kickLoading.value = false
}

// Resolve the Clerk user into a family record before choosing between setup and list views.
async function loadFamily(nextUserId: string) {
  loadingFamily.value = true
  errorMessage.value = ''

  const membershipResponse = await supabase
    .from('family_members')
    .select('id, family_id, user_id, role, joined_at')
    .eq('user_id', nextUserId)
    .maybeSingle()

  if (membershipResponse.error) {
    errorMessage.value = membershipResponse.error.message
    family.value = null
    familyMembers.value = []
    loadingFamily.value = false
    return
  }

  const membership = membershipResponse.data as FamilyMember | null

  if (!membership?.family_id) {
    family.value = null
    familyMembers.value = []
    membershipRole.value = 'member'
    loadingFamily.value = false
    return
  }

  const familyResponse = await supabase
    .from('families')
    .select('id, name, invite_code, created_at')
    .eq('id', membership.family_id)
    .maybeSingle()

  if (familyResponse.error) {
    errorMessage.value = familyResponse.error.message
    family.value = null
    familyMembers.value = []
    loadingFamily.value = false
    return
  }

  let members: FamilyMember[] = []
  try {
    members = await fetchFamilyMembers(membership.family_id)
  } catch (membersError) {
    errorMessage.value = membersError instanceof Error ? membersError.message : 'Unable to load members.'
    family.value = null
    familyMembers.value = []
    loadingFamily.value = false
    return
  }

  family.value = (familyResponse.data as Family | null) ?? null
  familyMembers.value = members
  membershipRole.value = membership.role || 'member'
  loadingFamily.value = false

  // Silently sync the current user's Clerk profile into their membership row so
  // other family members see their real name and photo. Fails gracefully if the
  // columns don't exist yet in the DB.
  void syncSelfProfile(nextUserId, membership.family_id)
}

async function syncSelfProfile(selfUserId: string, familyId: string) {
  const displayName =
    user.value?.fullName?.trim() ||
    user.value?.firstName?.trim() ||
    user.value?.username?.trim() ||
    null

  const imageUrl = user.value?.imageUrl || null

  if (!displayName && !imageUrl) return

  const res = await supabase
    .from('family_members')
    .update({ display_name: displayName, image_url: imageUrl })
    .eq('family_id', familyId)
    .eq('user_id', selfUserId)

  if (!res.error) {
    // Update the cached member list so the current user's row reflects latest profile immediately
    familyMembers.value = familyMembers.value.map((m) =>
      m.user_id === selfUserId
        ? { ...m, display_name: displayName, image_url: imageUrl }
        : m,
    )
  }
}

watch(
  () => user.value?.id,
  (nextUserId) => {
    if (!nextUserId) {
      loadingFamily.value = false
      family.value = null
      familyMembers.value = []
      membershipRole.value = 'member'
      return
    }

    void loadFamily(nextUserId)
  },
  { immediate: true },
)

function handleFamilyReady(nextFamily: Family) {
  family.value = nextFamily
  membershipRole.value = 'admin'
  errorMessage.value = ''
  void loadFamily(userId.value)
}

function handleFamilyCleared() {
  family.value = null
  familyMembers.value = []
  membershipRole.value = 'member'
}
</script>

<template>
  <div class="app-frame">
    <header class="nav-bar">
      <div class="nav-title-wrap">
        <div class="nav-title-row">
          <h1 class="nav-title">{{ pageTitle }}</h1>
          <button
            v-if="family && memberCount > 0"
            type="button"
            class="member-stack-btn"
            aria-label="Open family members"
            @click="showMembers = true"
          >
            <div class="member-stack" aria-hidden="true">
              <img
                v-for="member in visibleMembers"
                :key="member.id"
                :src="getAvatarUrl(member)"
                alt=""
                class="member-avatar"
              />
              <span v-if="overflowMembers > 0" class="member-overflow">+{{ overflowMembers }}</span>
            </div>
          </button>
        </div>
        <p v-if="family" class="nav-subtitle">{{ memberCountLabel }}</p>
      </div>
      <div class="nav-actions">
        <button v-if="family" type="button" class="nav-icon-btn" @click="showSettings = true" aria-label="Settings">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
        <UserButton />
      </div>
    </header>

    <main class="app-body">
      <div v-if="loadingFamily" class="center-message">
        <p>Loading your family...</p>
      </div>

      <div v-else-if="errorMessage" class="center-message">
        <p class="error-text">{{ errorMessage }}</p>
        <button type="button" class="btn btn--primary btn--sm" @click="loadFamily(userId)">
          Try again
        </button>
      </div>

      <ShoppingList
        v-else-if="family"
        :key="family.id"
        :family="family"
        :user-id="userId"
        :family-members="familyMembers"
      />

      <FamilySetup v-else :user-id="userId" @family-ready="handleFamilyReady" />
    </main>

    <SettingsModal
      v-if="showSettings && family"
      :family="family"
      :user-id="userId"
      :membership-role="membershipRole"
      @close="showSettings = false"
      @family-left="handleFamilyCleared"
      @family-deleted="handleFamilyCleared"
      @family-updated="(f) => family = f"
    />

    <Transition name="members-pop">
      <div v-if="showMembers && family" class="members-overlay" @click.self="showMembers = false">
        <div class="members-sheet">
          <div class="members-header">
            <h3>Family Members</h3>
            <button type="button" class="members-close" @click="showMembers = false">Done</button>
          </div>

          <div class="members-list">
            <div v-for="member in familyMembers" :key="member.id" class="member-row">
              <img :src="getAvatarUrl(member)" alt="Member avatar" class="member-row-avatar" />
              <div class="member-row-main">
                <p class="member-row-name">
                  {{ getMemberName(member) }}
                  <span v-if="member.user_id === userId" class="you-tag">You</span>
                </p>
                <p class="member-row-meta">Joined {{ formatJoinDate(member.joined_at) }}</p>
              </div>
              <div class="member-actions">
                <span class="member-role">{{ member.role }}</span>
                <button
                  v-if="isAdmin && member.user_id !== userId"
                  type="button"
                  class="kick-btn"
                  @click="requestKick(member)"
                >
                  Kick
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="kick-pop">
      <div v-if="pendingKick" class="kick-overlay" @click.self="closeKickDialog">
        <div class="kick-dialog">
          <h4>Remove Member?</h4>
          <p>
            Remove {{ getMemberName(pendingKick) }} from this family?
          </p>
          <p v-if="kickError" class="kick-error">{{ kickError }}</p>
          <div class="kick-actions">
            <button type="button" class="kick-btn-secondary" :disabled="kickLoading" @click="closeKickDialog">Cancel</button>
            <button type="button" class="kick-btn-danger" :disabled="kickLoading" @click="confirmKick">
              {{ kickLoading ? 'Removing...' : 'Remove' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.app-frame {
  display: flex;
  flex-direction: column;
  height: 100dvh;
}

.nav-bar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: calc(var(--safe-top) + 10px) 16px 10px;
  background: rgba(246, 248, 247, 0.88);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 0.5px solid rgba(0, 0, 0, 0.08);
}

.nav-title {
  font-size: 1.0625rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-title-wrap {
  min-width: 0;
}

.nav-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.nav-subtitle {
  margin-top: 2px;
  font-size: 0.8125rem;
  color: #8e8e93;
}

.nav-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.member-stack {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.member-stack-btn {
  padding: 0;
  border: 0;
  background: transparent;
  border-radius: 999px;
}

.member-stack-btn:active {
  opacity: 0.7;
}

.member-avatar {
  width: 34px;
  height: 34px;
  border-radius: 999px;
  border: 2px solid #f6f8f7;
  background: #d8fbe9;
  margin-left: -10px;
}

.member-avatar:first-child {
  margin-left: 0;
}

.member-overflow {
  margin-left: 6px;
  font-size: 0.75rem;
  font-weight: 600;
  color: #64748b;
}

.members-overlay {
  position: fixed;
  inset: 0;
  z-index: 110;
  display: flex;
  align-items: flex-end;
  background: rgba(0, 0, 0, 0.35);
}

.members-sheet {
  width: 100%;
  max-height: 80dvh;
  background: #f6f8f7;
  border-radius: 16px 16px 0 0;
  padding: 16px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.members-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.members-header h3 {
  font-size: 1.0625rem;
  font-weight: 700;
}

.members-close {
  font-size: 0.9375rem;
  font-weight: 600;
  color: #1a7a48;
}

.members-list {
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
}

.member-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
}

.member-row + .member-row {
  border-top: 0.5px solid rgba(0, 0, 0, 0.06);
}

.member-row-avatar {
  width: 36px;
  height: 36px;
  border-radius: 999px;
  background: #d8fbe9;
}

.member-row-main {
  min-width: 0;
  flex: 1;
}

.member-row-name {
  font-size: 0.9rem;
  font-weight: 600;
  color: #1c1c1e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.member-row-meta {
  margin-top: 2px;
  font-size: 0.75rem;
  color: #8e8e93;
}

.you-tag {
  margin-left: 6px;
  padding: 2px 6px;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 700;
  background: rgba(48, 232, 140, 0.2);
  color: #1a7a48;
}

.member-role {
  font-size: 0.75rem;
  font-weight: 600;
  color: #8e8e93;
  text-transform: capitalize;
}

.member-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

.kick-btn {
  font-size: 0.75rem;
  font-weight: 600;
  color: #ff3b30;
}

.kick-btn:active {
  opacity: 0.6;
}

.kick-overlay {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.35);
}

.kick-dialog {
  width: 100%;
  max-width: 320px;
  border-radius: 14px;
  background: #fff;
  padding: 16px;
}

.kick-dialog h4 {
  font-size: 1rem;
  font-weight: 700;
  color: #1c1c1e;
}

.kick-dialog p {
  margin-top: 6px;
  font-size: 0.875rem;
  color: #8e8e93;
}

.kick-error {
  color: #ff3b30;
}

.kick-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
}

.kick-btn-secondary {
  font-size: 0.875rem;
  color: #8e8e93;
}

.kick-btn-danger {
  font-size: 0.875rem;
  font-weight: 600;
  color: #ff3b30;
}

.kick-btn-secondary:disabled,
.kick-btn-danger:disabled {
  opacity: 0.5;
}

.kick-pop-enter-active,
.kick-pop-leave-active {
  transition: opacity 0.18s ease;
}

.kick-pop-enter-active .kick-dialog {
  animation: kickPop 0.2s cubic-bezier(0.32, 0.72, 0, 1) both;
}

.kick-pop-leave-active .kick-dialog {
  animation: kickPop 0.15s ease-in reverse both;
}

.kick-pop-enter-from,
.kick-pop-leave-to {
  opacity: 0;
}

@keyframes kickPop {
  from {
    transform: scale(0.9);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

.members-pop-enter-active,
.members-pop-leave-active {
  transition: opacity 0.2s ease;
}

.members-pop-enter-active .members-sheet {
  animation: membersUp 0.32s cubic-bezier(0.32, 0.72, 0, 1) both;
}

.members-pop-leave-active .members-sheet {
  animation: membersUp 0.24s ease-in reverse both;
}

.members-pop-enter-from,
.members-pop-leave-to {
  opacity: 0;
}

@keyframes membersUp {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}

.nav-icon-btn {
  display: grid;
  place-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  color: #1c1c1e;
}

.nav-icon-btn:active {
  background: rgba(0, 0, 0, 0.06);
}

.app-body {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.center-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 48px 24px;
  text-align: center;
  color: #8e8e93;
}

.error-text {
  color: #ff3b30;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  font-weight: 600;
  font-size: 0.9375rem;
}

.btn--primary {
  background: #30e88c;
  color: #112119;
}

.btn--sm {
  padding: 10px 20px;
}
</style>