<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { supabase } from '../lib/supabase.js'
import type { Family } from '../types'

const props = defineProps<{
  family: Family
  userId: string
  membershipRole: string
}>()

const emit = defineEmits<{
  close: []
  familyLeft: []
  familyDeleted: []
  familyUpdated: [family: Family]
}>()

const isOpen = ref(false)

onMounted(() => {
  requestAnimationFrame(() => {
    isOpen.value = true
  })
})

function requestClose() {
  isOpen.value = false
}

function onModalAfterLeave() {
  emit('close')
}

// Edit family name
const renameVisible = ref(false)
const nameInput = ref(props.family.name)
const nameSaving = ref(false)
const renameError = ref('')

function startEditName() {
  if (props.membershipRole !== 'admin') return
  nameInput.value = props.family.name
  renameError.value = ''
  renameVisible.value = true
}

function cancelRename() {
  if (nameSaving.value) return
  renameError.value = ''
  renameVisible.value = false
}

async function saveName() {
  const trimmed = nameInput.value.trim()
  if (!trimmed || trimmed === props.family.name) {
    renameVisible.value = false
    return
  }
  nameSaving.value = true
  renameError.value = ''
  try {
    const res = await supabase
      .from('families')
      .update({ name: trimmed })
      .eq('id', props.family.id)
      .select('id, name, invite_code, created_at')
      .single()
    if (res.error) throw res.error
    emit('familyUpdated', res.data as Family)
    renameVisible.value = false
  } catch (e) {
    renameError.value = e instanceof Error ? e.message : 'Unable to rename family.'
  } finally {
    nameSaving.value = false
  }
}

// Confirm modal state
const confirmVisible = ref(false)
const confirmTitle = ref('')
const confirmMessage = ref('')
const confirmLabel = ref('')
const confirmDestructive = ref(false)
const confirmLoading = ref(false)
const confirmError = ref('')
let confirmAction: (() => Promise<void>) | null = null

function showConfirm(title: string, message: string, label: string, destructive: boolean, action: () => Promise<void>) {
  confirmTitle.value = title
  confirmMessage.value = message
  confirmLabel.value = label
  confirmDestructive.value = destructive
  confirmLoading.value = false
  confirmError.value = ''
  confirmAction = action
  confirmVisible.value = true
}

function cancelConfirm() {
  if (confirmLoading.value) return
  confirmVisible.value = false
  confirmError.value = ''
  confirmAction = null
}

async function executeConfirm() {
  if (!confirmAction) return
  confirmLoading.value = true
  confirmError.value = ''
  try {
    await confirmAction()
    confirmVisible.value = false
    confirmAction = null
  } catch (e) {
    confirmError.value = e instanceof Error ? e.message : `Unable to ${confirmLabel.value.toLowerCase()}.`
  } finally {
    confirmLoading.value = false
  }
}

function leaveFamily() {
  if (props.membershipRole === 'admin') return
  showConfirm(
    'Leave Family',
    'You can rejoin later with the invite code.',
    'Leave',
    true,
    async () => {
      const res = await supabase
        .from('family_members')
        .delete()
        .eq('family_id', props.family.id)
        .eq('user_id', props.userId)
      if (res.error) throw res.error
      emit('familyLeft')
    }
  )
}

function deleteFamily() {
  if (props.membershipRole !== 'admin') return
  showConfirm(
    'Delete Family',
    'This will delete the family and all items for everyone. This cannot be undone.',
    'Delete',
    true,
    async () => {
      const r1 = await supabase.from('items').delete().eq('family_id', props.family.id)
      if (r1.error) throw r1.error
      const r2 = await supabase.from('family_members').delete().eq('family_id', props.family.id)
      if (r2.error) throw r2.error
      const r3 = await supabase.from('families').delete().eq('id', props.family.id)
      if (r3.error) throw r3.error
      emit('familyDeleted')
    }
  )
}

function copyInviteCode() {
  navigator.clipboard.writeText(props.family.invite_code)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal" @after-leave="onModalAfterLeave">
      <div v-if="isOpen" class="overlay" @click.self="requestClose">
        <div class="sheet">
          <!-- Handle -->
          <div class="sheet-handle" />

          <!-- Header -->
          <div class="sheet-header">
            <h2>Settings</h2>
            <button type="button" class="close-btn" @click="requestClose">Done</button>
          </div>

          <!-- Family info -->
          <section class="settings-section">
            <span class="section-label">Family</span>
            <div class="group">
              <div class="group-row" :class="{ 'group-row--editable': membershipRole === 'admin' }" @click="startEditName">
                <span class="row-label">Name</span>
                <span class="row-value">
                  {{ family.name }}
                  <svg v-if="membershipRole === 'admin'" class="pencil-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                </span>
              </div>
              <div class="group-row">
                <span class="row-label">Invite Code</span>
                <button type="button" class="row-value row-value--copy" @click="copyInviteCode">
                  {{ family.invite_code.slice(0, 8) }}...
                  <svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                </button>
              </div>
              <div class="group-row">
                <span class="row-label">Role</span>
                <span class="row-value row-value--cap">{{ membershipRole }}</span>
              </div>
            </div>
          </section>

          <!-- Danger zone -->
          <section class="settings-section">
            <span class="section-label">Manage</span>
            <div class="group">
              <button
                type="button"
                class="group-row group-row--action group-row--danger"
                :disabled="membershipRole === 'admin'"
                @click="leaveFamily"
              >
                Leave Family
              </button>
              <button
                v-if="membershipRole === 'admin'"
                type="button"
                class="group-row group-row--action group-row--danger"
                @click="deleteFamily"
              >
                Delete Family
              </button>
            </div>
            <p v-if="membershipRole === 'admin'" class="section-hint">Admins can't leave. Delete the family instead.</p>
          </section>
        </div>
      </div>
    </Transition>

    <!-- Confirm dialog -->
    <Transition name="confirm">
      <div v-if="confirmVisible" class="prompt-overlay" @click.self="cancelConfirm">
        <div class="prompt-dialog">
          <h4 class="prompt-title">{{ confirmTitle }}</h4>
          <p class="prompt-message">{{ confirmMessage }}</p>
          <p v-if="confirmError" class="prompt-error">{{ confirmError }}</p>
          <div class="prompt-actions">
            <button type="button" class="prompt-btn-secondary" :disabled="confirmLoading" @click="cancelConfirm">
              Cancel
            </button>
            <button
              type="button"
              class="prompt-btn-primary"
              :class="{ 'prompt-btn-danger': confirmDestructive }"
              :disabled="confirmLoading"
              @click="executeConfirm"
            >
              {{ confirmLoading ? (confirmLabel === 'Leave' ? 'Leaving...' : confirmLabel === 'Delete' ? 'Deleting...' : `${confirmLabel}ing...`) : confirmLabel }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Rename modal -->
    <Transition name="confirm">
      <div v-if="renameVisible" class="prompt-overlay" @click.self="cancelRename">
        <div class="prompt-dialog">
          <h4 class="prompt-title">Rename Family</h4>
          <p class="prompt-message">Choose a new name for everyone in this family.</p>
          <form class="rename-form" @submit.prevent="saveName">
              <input
                v-model="nameInput"
                class="rename-input"
                maxlength="40"
                placeholder="Family name"
                autofocus
                :disabled="nameSaving"
              />
            </form>
          <p v-if="renameError" class="prompt-error">{{ renameError }}</p>
          <div class="prompt-actions">
            <button type="button" class="prompt-btn-secondary" :disabled="nameSaving" @click="cancelRename">
              Cancel
            </button>
            <button
              type="button"
              class="prompt-btn-primary"
              :disabled="nameSaving || !nameInput.trim()"
              @click="saveName"
            >
              {{ nameSaving ? 'Saving...' : 'Save' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* --- Overlay --- */
.overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: flex-end;
  background: rgba(0, 0, 0, 0.35);
}

/* --- Bottom sheet --- */
.sheet {
  width: 100%;
  max-height: 85dvh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  background: #f6f8f7;
  border-radius: 16px 16px 0 0;
  padding: 0 16px calc(var(--safe-bottom) + 24px);
}

.sheet-handle {
  width: 36px;
  height: 4px;
  margin: 8px auto 4px;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.15);
}

/* --- Header --- */
.sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0 16px;
}

.sheet-header h2 {
  font-size: 1.125rem;
  font-weight: 700;
}

.close-btn {
  font-size: 0.9375rem;
  font-weight: 600;
  color: #1a7a48;
  padding: 4px 0;
}

.close-btn:active { opacity: 0.5; }

/* --- Sections --- */
.settings-section {
  margin-bottom: 24px;
}

.section-label {
  display: block;
  padding: 0 4px 8px;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #8e8e93;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.section-hint {
  padding: 0 4px 8px;
  font-size: 0.8125rem;
  color: #8e8e93;
}

.cancel-link {
  display: block;
  margin: 12px auto 0;
  padding: 4px 0;
  font-size: 0.9375rem;
  font-weight: 500;
  color: #8e8e93;
}

.cancel-link:active { opacity: 0.5; }

/* --- Grouped rows --- */
.group {
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
}

.group-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  width: 100%;
  text-align: left;
}

.group-row + .group-row {
  border-top: 0.5px solid rgba(0, 0, 0, 0.06);
}

.row-label {
  font-size: 0.9375rem;
  color: #1c1c1e;
}

.row-value {
  font-size: 0.9375rem;
  color: #8e8e93;
}

.row-value--cap {
  text-transform: capitalize;
}

.row-value--copy {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  color: #8e8e93;
}

.row-value--copy:active { opacity: 0.5; }

.copy-hint,
.copy-icon {
  color: #1a7a48;
}

.copy-icon {
  width: 14px;
  height: 14px;
  vertical-align: -1px;
  display: inline;
}

.edit-hint,
.pencil-icon {
  color: #1a7a48;
  margin-left: 6px;
}

.pencil-icon {
  width: 14px;
  height: 14px;
  vertical-align: -1px;
  display: inline;
}

.group-row--editable {
  cursor: pointer;
}

.group-row--editable:active {
  background: rgba(0, 0, 0, 0.03);
}

.rename-input {
  width: 100%;
  margin-top: 10px;
  padding: 10px 12px;
  font-size: 0.875rem;
  border: 1.5px solid #d1d5db;
  border-radius: 10px;
  outline: none;
  font-family: inherit;
  background: #f8fafc;
}

.rename-input:focus {
  border-color: #30e88c;
}

.rename-form {
  margin-top: 10px;
}

/* --- Action rows --- */
.group-row--action {
  justify-content: center;
  font-size: 0.9375rem;
  font-weight: 500;
  color: #1a7a48;
}

.group-row--action .row-role {
  font-size: 0.75rem;
  font-weight: 600;
  color: #8e8e93;
  text-transform: capitalize;
  margin-left: 6px;
}

.group-row--action:active { background: rgba(0, 0, 0, 0.03); }
.group-row--action:disabled { opacity: 0.4; pointer-events: none; }

.group-row--danger {
  color: #ff3b30;
}

/* --- Transitions --- */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.3s ease;
}

.modal-enter-active .sheet {
  animation: sheetUp 0.45s cubic-bezier(0.32, 0.72, 0, 1) both;
}

.modal-leave-active .sheet {
  animation: sheetDown 0.28s ease-in both;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

@keyframes sheetUp {
  0%   { transform: translateY(100%) scale(0.96); opacity: 0; }
  60%  { transform: translateY(-2%) scale(1.005); opacity: 1; }
  100% { transform: translateY(0) scale(1); opacity: 1; }
}

@keyframes sheetDown {
  0%   { transform: translateY(0) scale(1); opacity: 1; }
  100% { transform: translateY(100%) scale(0.96); opacity: 0; }
}

/* Staggered section reveals */
.modal-enter-active .settings-section {
  animation: sectionFade 0.35s ease both;
}

.modal-enter-active .settings-section:nth-child(1) { animation-delay: 0.12s; }
.modal-enter-active .settings-section:nth-child(2) { animation-delay: 0.2s; }
.modal-enter-active .settings-section:nth-child(3) { animation-delay: 0.28s; }

@keyframes sectionFade {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* --- Confirm dialog --- */
.prompt-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.35);
}

.prompt-dialog {
  width: 100%;
  max-width: 320px;
  border-radius: 14px;
  background: #fff;
  padding: 16px;
}

.prompt-title {
  font-size: 1rem;
  font-weight: 700;
  color: #1c1c1e;
}

.prompt-message {
  margin-top: 6px;
  font-size: 0.875rem;
  color: #8e8e93;
  line-height: 1.4;
}

.prompt-error {
  margin-top: 8px;
  font-size: 0.8125rem;
  color: #ff3b30;
}

.prompt-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
}

.prompt-btn-secondary,
.prompt-btn-primary {
  font-size: 0.875rem;
}

.prompt-btn-secondary {
  color: #8e8e93;
}

.prompt-btn-primary {
  font-weight: 600;
  color: #1a7a48;
}

.prompt-btn-danger {
  color: #ff3b30;
}

.prompt-btn-secondary:disabled,
.prompt-btn-primary:disabled {
  opacity: 0.5;
}

/* Confirm transitions */
.confirm-enter-active,
.confirm-leave-active {
  transition: opacity 0.18s ease;
}

.confirm-enter-active .prompt-dialog {
  animation: confirmPop 0.2s cubic-bezier(0.32, 0.72, 0, 1) both;
}

.confirm-leave-active .prompt-dialog {
  animation: confirmPop 0.18s ease-in reverse both;
}

.confirm-enter-from,
.confirm-leave-to {
  opacity: 0;
}

@keyframes confirmPop {
  0%   { transform: scale(0.85); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}
</style>
