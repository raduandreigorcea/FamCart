<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAuth } from '@clerk/vue'
import AppButton from './AppButton.vue'
import AppModal from './AppModal.vue'
import ModalCloseButton from './ModalCloseButton.vue'
import ErrorModal from './ErrorModal.vue'
import slidersIconRaw from '../assets/settings.svg?raw'
import { canSelfUpdate } from '../lib/nativeUpdate'
import { updateCheckKey } from '../lib/updatePrompt'
import {
  enablePushNotifications,
  disablePushNotifications,
  getNotificationPreference,
  setNotificationPreference,
  type NotificationPreference,
} from '../lib/pushNotifications'
import {
  applyResolvedTheme,
  loadThemeMode,
  saveThemeMode,
  type ThemeMode,
} from '../lib/theme'

// Settings that belong to the app on this device rather than to a household or
// to the account: how it looks, whether it may notify, and what it is.
//
// About lives here because it is the clearest case of the three — an app's
// version and its Open Food Facts licence credit are not a property of any one
// household, which is exactly what made it odd sitting in the household dialog
// behind a flag that pushed it to the bottom of the sidebar.
//
// Sections stacked in one scroll rather than tabs: Appearance is three buttons
// and Notifications is two, and a tab pane holding three buttons reads as an
// empty room. Household Settings earns its sidebar because its panels are big.

const props = defineProps({
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

const { userId } = useAuth()

// Replaced at build time with package.json's version, so bumping it there is
// the only step needed for this to show the new one.
const appVersion = __APP_VERSION__

const aboutOpen = ref(false)

// Asking for an update by hand.
//
// The startup check deliberately stays quiet in several situations — it waits
// out an interval, and it says nothing about a version already declined. Both
// are right for a check nobody asked for and wrong once someone goes looking,
// so this route applies neither. It is also the only way back from a dismissal:
// Back on the update dialog declines that version, and without this the app
// would have nothing to say until the next release.
//
// Provided by HomeView rather than passed down through AppTopbar. Absent (null)
// anywhere that view does not own — the setup screen, and every test that mounts
// this modal on its own — so the row simply does not appear there.
const runUpdateCheck = inject(updateCheckKey, null)
type UpdateCheckState = 'idle' | 'checking' | 'up-to-date' | 'failed'
const updateCheckState = ref<UpdateCheckState>('idle')
const canCheckForUpdates = computed(() => canSelfUpdate() && !!runUpdateCheck)

async function checkForUpdates() {
  if (!runUpdateCheck || updateCheckState.value === 'checking') return
  updateCheckState.value = 'checking'
  const result = await runUpdateCheck()
  // 'found' opens the update dialog, which belongs to the view behind this one.
  // Close everything so it is not buried under two layers of settings.
  if (result === 'found') {
    updateCheckState.value = 'idle'
    aboutOpen.value = false
    emit('close')
    return
  }
  updateCheckState.value = result
}
const themeMode = ref<ThemeMode>('system')
const notificationMode = ref<NotificationPreference>('on')
const notificationHint = ref('')
let mediaQuery: MediaQueryList | null = null

function syncPreferencesFromStorage() {
  // lib/theme owns the key and the fallback-to-system rule; this only mirrors
  // the answer into the radio group and onto the page.
  themeMode.value = loadThemeMode(localStorage)
  applyResolvedTheme(themeMode.value)

  // Only an explicit opt-in shows On. An unset preference means the user was
  // never asked (or never answered) — showing On there would claim a push
  // subscription that doesn't exist.
  notificationMode.value =
    getNotificationPreference(localStorage, userId.value ?? '') === 'on' ? 'on' : 'off'
}

function handleSystemThemeChange() {
  if (themeMode.value === 'system') {
    applyResolvedTheme('system')
  }
}

function applyTheme(mode: ThemeMode) {
  themeMode.value = mode
  saveThemeMode(localStorage, mode)
  applyResolvedTheme(mode)
}

async function applyNotifications(mode: NotificationPreference) {
  // Read once, up front, for the reason firstRunGreeting gives: the preference
  // belongs to the account that touched the toggle, and enabling push is a
  // round trip the session can end during.
  const uid = userId.value ?? ''
  notificationMode.value = mode
  setNotificationPreference(localStorage, uid, mode)
  notificationHint.value = ''

  if (mode === 'off') {
    await disablePushNotifications()
    return
  }

  if (!uid) return
  const result = await enablePushNotifications(uid)
  if (result === 'permission-denied') {
    // The browser said no — reflect reality instead of a toggle that lies.
    notificationMode.value = 'off'
    setNotificationPreference(localStorage, uid, 'off')
    notificationHint.value = 'Notifications are blocked for FamCart in your device or browser settings.'
  } else if (result === 'error') {
    notificationMode.value = 'off'
    setNotificationPreference(localStorage, uid, 'off')
    notificationHint.value = 'Could not enable notifications. Please try again.'
  }
  // 'unsupported' / 'not-configured': push is unavailable in this environment;
  // the preference is still saved and the toggle stays on.
}

// The theme has to be applied on boot, not only while this dialog is open, so
// this component stays mounted and syncs on mount as well as on each open.
onMounted(() => {
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  mediaQuery.addEventListener('change', handleSystemThemeChange)
  syncPreferencesFromStorage()
})

onBeforeUnmount(() => {
  mediaQuery?.removeEventListener('change', handleSystemThemeChange)
})

// The preference could have changed since this was last open — the browser's own
// notification permission can be revoked from outside the app entirely — so
// re-read rather than trusting what the dialog showed last time.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    syncPreferencesFromStorage()
  },
)
</script>

<template>
  <AppModal :open="open" overlay-class="app-settings-overlay" transition="modal-fade" @close="emit('close')">
    <div class="app-settings" role="dialog" aria-modal="true" aria-labelledby="app-settings-title">
      <div class="app-settings__header">
        <div class="app-settings__title-wrap">
          <div class="app-settings__icon-bg">
            <span class="header-icon" aria-hidden="true" v-html="slidersIconRaw"></span>
          </div>
          <div>
            <h3 id="app-settings-title">App Settings</h3>
            <p class="app-settings__subtitle">How FamCart looks and behaves on this device</p>
          </div>
        </div>
        <ModalCloseButton aria-label="Close app settings" @click="emit('close')" />
      </div>

      <div class="app-settings__body">
        <section class="app-settings__section">
          <h4 id="app-appearance-label" class="app-settings__section-title">Appearance</h4>
          <div class="segmented" role="group" aria-labelledby="app-appearance-label">
            <button
              class="segmented__btn"
              :class="{ 'segmented__btn--active': themeMode === 'light' }"
              type="button"
              @click="applyTheme('light')"
            >
              <span class="control-icon control-icon--theme-light" aria-hidden="true"></span>
              <span>Light</span>
            </button>
            <button
              class="segmented__btn"
              :class="{ 'segmented__btn--active': themeMode === 'dark' }"
              type="button"
              @click="applyTheme('dark')"
            >
              <span class="control-icon control-icon--theme-dark" aria-hidden="true"></span>
              <span>Dark</span>
            </button>
            <button
              class="segmented__btn"
              :class="{ 'segmented__btn--active': themeMode === 'system' }"
              type="button"
              @click="applyTheme('system')"
            >
              <span class="control-icon control-icon--theme-system" aria-hidden="true"></span>
              <span>System</span>
            </button>
          </div>
        </section>

        <section class="app-settings__section">
          <h4 id="app-notifications-label" class="app-settings__section-title">Notifications</h4>
          <div class="segmented segmented--two" role="group" aria-labelledby="app-notifications-label">
            <button
              class="segmented__btn"
              :class="{ 'segmented__btn--active': notificationMode === 'on' }"
              type="button"
              @click="applyNotifications('on')"
            >
              <span class="control-icon control-icon--notify-all" aria-hidden="true"></span>
              <span>On</span>
            </button>
            <button
              class="segmented__btn"
              :class="{ 'segmented__btn--active': notificationMode === 'off' }"
              type="button"
              @click="applyNotifications('off')"
            >
              <span class="control-icon control-icon--notify-off" aria-hidden="true"></span>
              <span>Off</span>
            </button>
          </div>
        </section>

        <button class="app-settings__row" type="button" @click="aboutOpen = true">
          <span class="app-settings__row-label">About</span>
          <span class="app-settings__row-hint">FamCart v{{ appVersion }}</span>
        </button>
      </div>
    </div>
  </AppModal>

  <!-- The Open Food Facts credit is a licence term, not a courtesy: their data
       is ODbL, which obliges anyone publishing an app built on it to say so
       somewhere a user can reach. Behind a button is still "somewhere a user can
       reach"; deleting it is not. test/dataAttribution.component.test.js fails
       if it stops being reachable. -->
  <AppModal :open="aboutOpen" overlay-class="about-overlay" transition="modal-fade" @close="aboutOpen = false">
    <div class="about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-dialog-title">
      <ModalCloseButton class="about-dialog__close" aria-label="Close about" @click="aboutOpen = false" />
      <img src="/icons/pwa-192.png" alt="" class="about-logo" />
      <h3 id="about-dialog-title" class="about-name">FamCart</h3>
      <p class="about-version">v{{ appVersion }}</p>

      <div v-if="canCheckForUpdates" class="about-update">
        <AppButton
          variant="secondary"
          size="sm"
          :disabled="updateCheckState === 'checking'"
          @click="checkForUpdates"
        >
          {{ updateCheckState === 'checking' ? 'Checking…' : 'Check for updates' }}
        </AppButton>
        <p v-if="updateCheckState === 'up-to-date'" class="about-update__result">
          FamCart is up to date.
        </p>
        <p v-else-if="updateCheckState === 'failed'" class="about-update__result">
          Couldn't reach GitHub to check. Try again when you're back online.
        </p>
      </div>

      <p class="about-credit">
        Product data from
        <a class="settings-note-link" href="https://openfoodfacts.org" target="_blank" rel="noopener noreferrer">Open Food Facts</a>,
        under
        <a class="settings-note-link" href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener noreferrer">ODbL 1.0</a>.
      </p>
    </div>
  </AppModal>

  <ErrorModal title="Notifications" :message="notificationHint" @dismiss="notificationHint = ''" />
</template>

<style scoped>
.app-settings-overlay {
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

.app-settings {
  width: 100%;
  max-width: 380px;
  background: var(--bg-surface);
  border-radius: var(--radius-dialog);
  box-shadow: var(--elevation-modal);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  max-height: 100%;
}

.app-settings__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-4);
  flex-shrink: 0;
}

.app-settings__title-wrap {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.app-settings__icon-bg {
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

.app-settings__header h3 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--weight-extrabold);
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.app-settings__subtitle {
  margin: 0.1rem 0 0;
  font-size: var(--text-xs);
  color: var(--text-secondary);
  font-weight: var(--weight-medium);
}

.app-settings__body {
  padding: 0 var(--space-4) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  overflow-y: auto;
}

.app-settings__section-title {
  margin: 0 0 0.4rem 0.15rem;
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

/* Same box as the account dialog's rows, so a row that opens something looks
   the same wherever you meet one. */
.app-settings__row {
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
  font-family: inherit;
  cursor: pointer;
  transition: background var(--transition-base) ease, border-color var(--transition-base) ease;
}

.app-settings__row:hover {
  background: var(--bg-hover);
  border-color: color-mix(in srgb, var(--color-primary) 45%, var(--bg-surface));
}

.app-settings__row-label {
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  color: var(--text-primary);
}

.app-settings__row-hint {
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

/* ─── Segmented controls ─────────────────────────────────────────────────── */
.segmented {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.35rem;
  background: var(--bg-surface-alt);
  border: var(--border-width-thin) solid var(--border-main);
  border-radius: var(--radius-md);
  padding: 0.25rem;
}

.segmented--two {
  grid-template-columns: repeat(2, 1fr);
}

.segmented__btn {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-family: inherit;
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

.segmented__btn:hover:not(.segmented__btn--active) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.segmented__btn--active {
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

/* ─── About ──────────────────────────────────────────────────────────────── */
.about-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-dark);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  /* Above App Settings, which opened it. */
  z-index: 1200;
  padding: calc(var(--space-4) + var(--safe-top)) var(--space-4) calc(var(--space-4) + var(--safe-bottom));
}

.about-dialog {
  position: relative;
  width: 100%;
  max-width: 320px;
  background: var(--bg-surface);
  border-radius: var(--radius-dialog);
  box-shadow: var(--elevation-modal);
  padding: var(--space-6) var(--space-5) var(--space-5);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.about-dialog__close {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
}

.about-logo {
  width: 56px;
  height: 56px;
  border-radius: var(--radius-lg);
  object-fit: contain;
}

.about-name {
  margin: var(--space-3) 0 0;
  font-size: var(--text-md);
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.about-version {
  margin: 0.2rem 0 0;
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

.about-update {
  margin-top: var(--space-4);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
}

.about-update__result {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-secondary);
  line-height: 1.4;
}

.about-credit {
  margin: var(--space-4) 0 0;
  font-size: var(--text-xs);
  line-height: 1.6;
  color: var(--text-secondary);
  max-width: 30ch;
}

.settings-note-link {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.settings-note-link:hover,
.settings-note-link:focus-visible {
  color: var(--text-primary);
}

/* ─── Transition ─────────────────────────────────────────────────────────── */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity var(--transition-base) ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-fade-enter-active .app-settings,
.modal-fade-enter-active .about-dialog {
  animation: modal-rise-in var(--transition-slow) var(--ease-rise) forwards;
}

.modal-fade-leave-active .app-settings,
.modal-fade-leave-active .about-dialog {
  animation: modal-rise-out var(--transition-base) var(--ease-fall) forwards;
}

@media (max-width: 520px) {
  .app-settings-overlay {
    align-items: flex-end;
    padding: 0;
  }

  .app-settings {
    max-width: none;
    border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
    padding-bottom: calc(1rem + env(safe-area-inset-bottom));
    max-height: 92vh;
    /* Flush with the bottom edge, so it can travel its full height and start
       off screen rather than merely nudging up. */
    --modal-rise: 100%;
  }
}
</style>
