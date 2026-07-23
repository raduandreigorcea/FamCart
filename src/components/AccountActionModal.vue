<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAuth } from '@clerk/vue'
import ModalCloseButton from './ModalCloseButton.vue'
import ErrorModal from './ErrorModal.vue'
import userRoundIconRaw from '../assets/user-round.svg?raw'
import {
  enablePushNotifications,
  disablePushNotifications,
  getNotificationPreference,
  setNotificationPreference,
} from '../lib/pushNotifications'

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

const { userId } = useAuth()

const themeMode = ref('system')
const notificationMode = ref('on')
const notificationHint = ref('')
let mediaQuery = null

function syncPreferencesFromStorage() {
  const savedTheme = localStorage.getItem('famcart-theme')
  if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system') {
    themeMode.value = savedTheme
    applyResolvedTheme(savedTheme)
  } else {
    themeMode.value = 'system'
    applyResolvedTheme('system')
  }

  // Only an explicit opt-in shows On. An unset preference means the user was
  // never asked (or never answered) — showing On there would claim a push
  // subscription that doesn't exist.
  notificationMode.value = getNotificationPreference(localStorage) === 'on' ? 'on' : 'off'
}

function applyResolvedTheme(mode) {
  const root = document.documentElement
  if (mode === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light')
    return
  }
  root.setAttribute('data-theme', mode)
}

function handleSystemThemeChange() {
  if (themeMode.value === 'system') {
    applyResolvedTheme('system')
  }
}

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
  applyResolvedTheme(mode)
}

async function applyNotifications(mode) {
  notificationMode.value = mode
  setNotificationPreference(localStorage, mode)
  notificationHint.value = ''

  if (mode === 'off') {
    await disablePushNotifications()
    return
  }

  if (!userId.value) return
  const result = await enablePushNotifications(userId.value)
  if (result === 'permission-denied') {
    // The browser said no — reflect reality instead of a toggle that lies.
    notificationMode.value = 'off'
    setNotificationPreference(localStorage, 'off')
    notificationHint.value = 'Notifications are blocked for FamCart in your device or browser settings.'
  } else if (result === 'error') {
    notificationMode.value = 'off'
    setNotificationPreference(localStorage, 'off')
    notificationHint.value = 'Could not enable notifications. Please try again.'
  }
  // 'unsupported' / 'not-configured': push is unavailable in this environment;
  // the preference is still saved and the toggle stays on.
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  mediaQuery.addEventListener('change', handleSystemThemeChange)
  syncPreferencesFromStorage()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  mediaQuery?.removeEventListener('change', handleSystemThemeChange)
})

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    syncPreferencesFromStorage()
  },
)
</script>

<template>
  <Transition name="modal-fade">
    <div v-if="open" class="account-overlay" @click.self="closeMenu">
      <div class="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-modal-title">
        <div class="account-dialog__header">
          <div class="account-dialog__title-wrap">
            <div class="account-dialog__icon-bg">
              <span class="account-header-icon" v-html="userRoundIconRaw"></span>
            </div>
            <div>
              <h3 id="account-modal-title">Account Settings</h3>
              <p class="account-dialog__subtitle">Manage your profile and preferences</p>
            </div>
          </div>
          <ModalCloseButton aria-label="Close account modal" @click="closeMenu" />
        </div>

        <div class="account-dialog__body">
          <div class="account-user-card">
            <div class="account-user-card__avatar-wrap">
              <img v-if="avatarUrl" :src="avatarUrl" alt="Profile picture" class="account-user-card__avatar" />
              <span v-else class="account-user-card__avatar account-user-card__avatar--fallback">{{ initial }}</span>
            </div>
            <div class="account-user-card__identity">
              <h4>{{ displayName }}</h4>
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
                <span class="control-icon control-icon--theme-light" aria-hidden="true"></span>
                <span>Light</span>
              </button>
              <button
                class="theme-control__btn"
                :class="{ 'theme-control__btn--active': themeMode === 'dark' }"
                type="button"
                @click="applyTheme('dark')"
              >
                <span class="control-icon control-icon--theme-dark" aria-hidden="true"></span>
                <span>Dark</span>
              </button>
              <button
                class="theme-control__btn"
                :class="{ 'theme-control__btn--active': themeMode === 'system' }"
                type="button"
                @click="applyTheme('system')"
              >
                <span class="control-icon control-icon--theme-system" aria-hidden="true"></span>
                <span>System</span>
              </button>
            </div>

            <div class="account-divider"></div>

            <div class="theme-control theme-control--two" role="group" aria-label="Notification mode">
              <button
                class="theme-control__btn"
                :class="{ 'theme-control__btn--active': notificationMode === 'on' }"
                type="button"
                @click="applyNotifications('on')"
              >
                <span class="control-icon control-icon--notify-all" aria-hidden="true"></span>
                <span>On</span>
              </button>
              <button
                class="theme-control__btn"
                :class="{ 'theme-control__btn--active': notificationMode === 'off' }"
                type="button"
                @click="applyNotifications('off')"
              >
                <span class="control-icon control-icon--notify-off" aria-hidden="true"></span>
                <span>Off</span>
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
    </div>
  </Transition>

  <ErrorModal title="Notifications" :message="notificationHint" @dismiss="notificationHint = ''" />
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
  padding: calc(var(--space-4) + var(--safe-top)) var(--space-4) calc(var(--space-4) + var(--safe-bottom));
}

.account-dialog {
  width: 100%;
  max-width: 360px;
  background: var(--bg-surface);
  border: none;
  border-radius: var(--radius-3xl);
  box-shadow: var(--elevation-modal);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.account-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--bg-surface);
}

.account-dialog__title-wrap {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.account-dialog__icon-bg {
  width: 38px;
  height: 38px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-primary) 10%, var(--bg-surface));
  color: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.account-header-icon {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.account-header-icon :deep(svg) {
  width: 100%;
  height: 100%;
  stroke: currentColor;
  stroke-width: 2;
  fill: none;
}

.account-dialog__header h3 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--weight-extrabold);
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.account-dialog__subtitle {
  margin: 0.1rem 0 0;
  font-size: var(--text-xs);
  color: var(--text-secondary);
  font-weight: var(--weight-medium);
}

.account-dialog__body {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.account-user-card {
  display: flex;
  align-items: flex-start;
  gap: 0.8rem;
  background: var(--bg-surface-alt);
  border-radius: var(--radius-lg);
  padding: 0.9rem 0.9rem 0.65rem;
}

.account-user-card__avatar-wrap {
  position: relative;
}

.account-user-card__avatar {
  width: 52px;
  height: 52px;
  border-radius: var(--radius-pill);
  object-fit: cover;
  border: var(--border-width-base) solid var(--bg-surface);
  box-shadow: var(--elevation-soft);
  flex-shrink: 0;
}

.account-user-card__avatar--fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-lg);
  font-weight: var(--weight-extrabold);
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 16%, var(--bg-surface));
}

.account-user-card__identity {
  min-width: 0;
}

.account-user-card__identity h4 {
  margin: 0;
  font-size: var(--text-md);
  font-weight: var(--weight-extrabold);
  color: var(--text-primary);
  letter-spacing: -0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.account-user-card__identity p {
  margin: 0.12rem 0 0;
  font-size: var(--text-xs);
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
  border: var(--border-width-thin) solid var(--border-main);
  background: var(--bg-surface);
  border-radius: var(--radius-md);
  padding: 0.65rem 0.75rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
  text-align: left;
  cursor: pointer;
  transition: background var(--transition-base) ease, border-color var(--transition-base) ease;
}

.account-menu-item:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: color-mix(in srgb, var(--color-primary) 45%, var(--bg-surface));
}

.account-menu-item:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.account-menu-item__label {
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  color: var(--text-primary);
}

.account-menu-item__label--danger {
  color: var(--text-inverse);
}

.account-menu-item__hint {
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.account-menu-item--danger {
  border: none;
  background: var(--danger-solid);
  color: var(--text-inverse);
  box-shadow: var(--elevation-danger-subtle);
}

.account-menu-item--danger:hover:not(:disabled) {
  background: var(--danger-solid-hover);
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
  border: var(--border-width-thin) solid var(--border-main);
  border-radius: var(--radius-md);
  padding: 0.25rem;
}

.theme-control--two {
  grid-template-columns: repeat(2, 1fr);
}

.theme-control__btn {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  border-radius: var(--radius-sm);
  padding: 0.42rem 0.2rem;
  cursor: pointer;
  transition: all var(--transition-fast) ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.28rem;
}

.theme-control__btn:hover:not(.theme-control__btn--active) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.theme-control__btn--active {
  background: var(--bg-surface);
  color: var(--color-primary);
  box-shadow: var(--elevation-soft);
}

.control-icon {
  width: 12px;
  height: 12px;
  display: inline-block;
  background-color: currentColor;
  mask-repeat: no-repeat;
  mask-position: center;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-position: center;
  -webkit-mask-size: contain;
}

.control-icon--theme-light {
  mask-image: url('../assets/sun-medium.svg');
  -webkit-mask-image: url('../assets/sun-medium.svg');
}

.control-icon--theme-dark {
  mask-image: url('../assets/moon.svg');
  -webkit-mask-image: url('../assets/moon.svg');
}

.control-icon--theme-system {
  mask-image: url('../assets/sun-moon.svg');
  -webkit-mask-image: url('../assets/sun-moon.svg');
}

.control-icon--notify-all {
  mask-image: url('../assets/bell.svg');
  -webkit-mask-image: url('../assets/bell.svg');
}

.control-icon--notify-off {
  mask-image: url('../assets/bell-off.svg');
  -webkit-mask-image: url('../assets/bell-off.svg');
}

.account-spinner {
  width: 14px;
  height: 14px;
  border: var(--border-width-thick) solid color-mix(in srgb, var(--text-inverse) 45%, transparent);
  border-top-color: var(--text-inverse);
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
  transition: opacity var(--transition-base) ease;
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
