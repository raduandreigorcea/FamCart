<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ModalCloseButton from './ModalCloseButton.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  loadingSignOut: { type: Boolean, default: false },
  avatarUrl: { type: String, default: '' },
  displayName: { type: String, default: 'Account' },
  email: { type: String, default: '' },
  initial: { type: String, default: '?' },
  familyName: { type: String, default: '' },
  familyMemberCount: { type: Number, default: 0 },
})

const emit = defineEmits(['close', 'edit-account', 'sign-out', 'manage-family', 'invite-members'])

const themeMode = ref('system')

function closeMenu() {
  emit('close')
}

function onKeydown(event) {
  if (event.key === 'Escape' && props.open) {
    closeMenu()
  }
}

function applyTheme(mode) {
  themeMode.value = mode
  localStorage.setItem('famcart-theme', mode)
  const root = document.documentElement
  if (mode === 'system') {
    root.removeAttribute('data-theme')
    return
  }
  root.setAttribute('data-theme', mode)
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  const saved = localStorage.getItem('famcart-theme')
  if (saved === 'light' || saved === 'dark' || saved === 'system') {
    themeMode.value = saved
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    const saved = localStorage.getItem('famcart-theme')
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      themeMode.value = saved
    }
  },
)
</script>

<template>
  <Transition name="modal-fade">
    <div v-if="open" class="account-overlay" @click.self="closeMenu">
      <div class="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-modal-title">
        <div class="account-dialog__top-row">
          <p class="account-dialog__eyebrow">Account menu</p>
          <ModalCloseButton aria-label="Close account modal" @click="closeMenu" />
        </div>

        <div class="account-user-card">
          <div class="account-user-card__avatar-wrap">
            <img v-if="avatarUrl" :src="avatarUrl" alt="Profile picture" class="account-user-card__avatar" />
            <span v-else class="account-user-card__avatar account-user-card__avatar--fallback">{{ initial }}</span>
          </div>
          <div class="account-user-card__identity">
            <h4 id="account-modal-title">{{ displayName }}</h4>
            <p>{{ email || 'No email available' }}</p>
          </div>
        </div>

        <div class="account-section">
          <button class="account-menu-item" type="button" @click="emit('edit-account')">
            <span class="account-menu-item__label">Account</span>
            <span class="account-menu-item__hint">Manage profile</span>
          </button>
          <button class="account-menu-item" type="button" @click="emit('manage-family')">
            <span class="account-menu-item__label">Manage family</span>
            <span class="account-menu-item__hint">{{ familyName || 'Family' }}</span>
          </button>
          <button class="account-menu-item" type="button" @click="emit('invite-members')">
            <span class="account-menu-item__label">Invite members</span>
            <span class="account-menu-item__hint">{{ familyMemberCount }} members</span>
          </button>

          <div class="account-divider"></div>

          <div class="theme-control" role="group" aria-label="Theme mode">
            <button
              class="theme-control__btn"
              :class="{ 'theme-control__btn--active': themeMode === 'light' }"
              type="button"
              @click="applyTheme('light')"
            >
              Light
            </button>
            <button
              class="theme-control__btn"
              :class="{ 'theme-control__btn--active': themeMode === 'dark' }"
              type="button"
              @click="applyTheme('dark')"
            >
              Dark
            </button>
            <button
              class="theme-control__btn"
              :class="{ 'theme-control__btn--active': themeMode === 'system' }"
              type="button"
              @click="applyTheme('system')"
            >
              System
            </button>
          </div>

          <div class="account-divider"></div>

          <button
            class="account-menu-item account-menu-item--danger"
            type="button"
            :disabled="loadingSignOut"
            @click="emit('sign-out')"
          >
            <span class="account-menu-item__label account-menu-item__label--danger">
              <span v-if="loadingSignOut" class="account-spinner"></span>
              <span v-else>Sign out</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.account-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-dark);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
  padding: var(--space-4);
}

.account-dialog {
  width: 100%;
  max-width: 360px;
  background: var(--bg-surface);
  border: 1px solid var(--border-main);
  border-radius: var(--radius-xl);
  box-shadow: var(--elevation-modal);
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.account-dialog__top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.account-dialog__eyebrow {
  margin: 0;
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
  font-weight: 700;
}

.account-user-card {
  display: flex;
  align-items: flex-start;
  gap: 0.8rem;
  background: var(--bg-surface-alt);
  border: 1px solid color-mix(in srgb, var(--color-primary) 28%, var(--border-light));
  border-radius: var(--radius-lg);
  padding: 0.9rem;
}

.account-user-card__avatar-wrap {
  position: relative;
}

.account-user-card__avatar {
  width: 52px;
  height: 52px;
  border-radius: var(--radius-pill);
  object-fit: cover;
  border: 1.5px solid var(--bg-surface);
  box-shadow: var(--elevation-soft);
  flex-shrink: 0;
}

.account-user-card__avatar--fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  font-weight: 800;
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 16%, var(--bg-surface));
}

.account-user-card__identity {
  min-width: 0;
}

.account-user-card__identity h4 {
  margin: 0;
  font-size: 0.96rem;
  font-weight: 800;
  color: var(--text-primary);
  letter-spacing: -0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.account-user-card__identity p {
  margin: 0.2rem 0 0;
  font-size: 0.76rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.account-divider {
  height: 1px;
  background: var(--border-main);
  margin-block: var(--space-2);
}

.account-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.account-menu-item {
  width: 100%;
  border: 1px solid var(--border-main);
  background: var(--bg-surface);
  border-radius: var(--radius-md);
  padding: 0.65rem 0.75rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
  text-align: left;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
}

.account-menu-item:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: color-mix(in srgb, var(--color-primary) 45%, var(--bg-surface));
  transform: translateY(-1px);
}

.account-menu-item:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.account-menu-item__label {
  font-size: 0.84rem;
  font-weight: 700;
  color: var(--text-primary);
}

.account-menu-item__label--danger {
  color: var(--bg-surface);
}

.account-menu-item__hint {
  font-size: 0.74rem;
  color: var(--text-secondary);
}

.account-menu-item--danger {
  border: none;
  background: var(--danger-text);
  color: var(--bg-surface);
  box-shadow: var(--elevation-danger-subtle);
}

.account-menu-item--danger:hover:not(:disabled) {
  background: var(--danger-text);
  border-color: transparent;
  box-shadow: var(--elevation-danger-hover);
}

.account-menu-item--danger:disabled {
  opacity: 0.5;
}

.theme-control {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.35rem;
  background: var(--bg-surface-alt);
  border: 1px solid var(--border-main);
  border-radius: var(--radius-md);
  padding: 0.25rem;
}

.theme-control__btn {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 700;
  border-radius: var(--radius-sm);
  padding: 0.42rem 0.2rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.theme-control__btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.theme-control__btn--active {
  background: var(--bg-surface);
  color: var(--color-primary);
  box-shadow: var(--elevation-soft);
}

.account-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid color-mix(in srgb, var(--bg-surface) 45%, transparent);
  border-top-color: var(--bg-surface);
  border-radius: 50%;
  display: inline-block;
  animation: account-spin 0.7s linear infinite;
}

@keyframes account-spin {
  to {
    transform: rotate(360deg);
  }
}

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.18s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-fade-enter-active .account-dialog {
  animation: modalScaleIn 0.18s cubic-bezier(0.2, 0.9, 0.2, 1) forwards;
}

.modal-fade-leave-active .account-dialog {
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
  .account-overlay {
    align-items: flex-end;
    padding: 0;
  }

  .account-dialog {
    max-width: none;
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    padding-bottom: calc(1rem + env(safe-area-inset-bottom));
  }
}
</style>
