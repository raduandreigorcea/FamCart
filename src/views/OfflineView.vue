<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import AppCard from '../components/AppCard.vue'
import { refreshConnectivity, onReconnect } from '../lib/connectivity'
import { t } from '../lib/i18n'
import AppIcon from '../components/AppIcon.vue'

// Shown when the app opens with no connection. It recovers on its own the moment
// connectivity returns, and offers a manual retry for flaky links.
const checking = ref(false)
const stillOffline = ref(false)
let stopReconnect: (() => void) | null = null

// Recovery is a full page load, not a router navigation.
//
// This screen is only ever reached by starting the app with no connection, and
// that start already failed to fetch Clerk's script. Clerk does not retry, so
// isLoaded stays false for the life of the page — a client-side
// router.replace('/') therefore hands the guard a session it can never verify.
// The guard waits out its Clerk timeout and sends us straight back here, which
// is what made the retry look like it did nothing.
//
// Reloading re-runs main.ts against a working network, so the Clerk plugin
// installs cleanly. Nothing on this screen is unsaved, so it costs nothing.
// Same reasoning as goToApp() in LoginView.
function reloadIntoApp() {
  window.location.assign('/')
}

async function retry() {
  if (checking.value) return
  checking.value = true
  stillOffline.value = false
  // Poll the OS directly — the cached ref can be stale after the network returns.
  const online = await refreshConnectivity()
  if (online) {
    // The spinner deliberately stays up: the reload is what ends it. Clearing it
    // first is what made a successful retry flash for a split second and then
    // appear to do nothing while the guard was still working.
    reloadIntoApp()
    return
  }
  // Still offline. Hold the spinner briefly so even an instant result reads as a
  // deliberate check, then surface the hint (re-triggering the shake each tap).
  await new Promise((resolve) => setTimeout(resolve, 500))
  checking.value = false
  requestAnimationFrame(() => { stillOffline.value = true })
}

onMounted(() => {
  // The automatic path had the same defect as the manual one: connectivity
  // returning on its own left Clerk just as unloaded.
  stopReconnect = onReconnect(reloadIntoApp)
})

onBeforeUnmount(() => {
  if (stopReconnect) stopReconnect()
})
</script>

<template>
  <div class="offline-page">
    <AppCard variant="narrow">
      <div class="offline-content">
        <AppIcon class="offline-icon" name="wifi-off" />
        <h1 class="offline-title">{{ t('offline.title') }}</h1>
        <p class="offline-text">{{ t('offline.text') }}</p>
        <button class="offline-retry" type="button" :disabled="checking" @click="retry">
          <span v-if="checking" class="offline-retry-spinner"></span>
          <span v-else>{{ t('common.tryAgain') }}</span>
        </button>
        <p v-if="stillOffline" class="offline-hint is-shaking" role="status" aria-live="polite">
          {{ t('offline.stillOffline') }}
        </p>
      </div>
    </AppCard>
  </div>
</template>

<style scoped>
.offline-page {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(1rem + var(--safe-top)) 1rem calc(1rem + var(--safe-bottom));
  /* Same branded backdrop as the login screen: full-height once, tiled only
     horizontally, with the theme fill behind it as a fallback. */
  background-color: var(--color-primary-bg);
  background-image: url('/screen.webp');
  background-size: auto 100%;
  background-position: center;
  background-repeat: repeat-x;
}

.offline-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.85rem;
}

.offline-icon {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.offline-icon :deep(svg) {
  width: 28px;
  height: 28px;
  /* The asset ships at stroke-width 1 for a 24px box; weight it for this size. */
  stroke: currentColor;
  stroke-width: 2;
}

.offline-title {
  margin: 0;
  font-size: var(--text-xl);
  font-weight: var(--weight-extrabold);
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.offline-text {
  margin: 0;
  font-size: var(--text-base);
  line-height: 1.5;
  color: var(--text-secondary);
}

.offline-retry {
  margin-top: 0.4rem;
  min-width: 140px;
  height: var(--size-control-lg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-xl);
  background: var(--color-primary);
  color: var(--text-inverse);
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
  cursor: pointer;
  box-shadow: var(--elevation-primary);
  transition: transform 0.1s ease, opacity var(--transition-fast) ease;
}

.offline-retry:active:not(:disabled) {
  transform: translateY(1px) scale(0.98);
}

.offline-retry:disabled {
  cursor: progress;
  opacity: 0.7;
}

.offline-hint {
  margin: 0.15rem 0 0;
  max-width: 18rem;
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  line-height: 1.45;
  color: var(--danger-text);
}

.is-shaking {
  animation: offline-shake 0.4s ease;
}

@keyframes offline-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-6px); }
  40% { transform: translateX(6px); }
  60% { transform: translateX(-4px); }
  80% { transform: translateX(4px); }
}

.offline-retry-spinner {
  width: 18px;
  height: 18px;
  border: var(--border-width-thick) solid color-mix(in srgb, var(--text-inverse) 45%, transparent);
  border-top-color: var(--text-inverse);
  border-radius: 50%;
  animation: offline-spin 0.7s linear infinite;
}

@keyframes offline-spin {
  to { transform: rotate(360deg); }
}
</style>
