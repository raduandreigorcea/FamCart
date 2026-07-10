<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppCard from '../components/AppCard.vue'
import wifiOffIcon from '../assets/wifi-off.svg?raw'
import { refreshConnectivity, onReconnect } from '../lib/connectivity'

// Shown when the app opens with no connection. It recovers on its own the moment
// connectivity returns, and offers a manual retry for flaky links.
const router = useRouter()
const checking = ref(false)
const stillOffline = ref(false)
let stopReconnect = null

async function retry() {
  if (checking.value) return
  checking.value = true
  stillOffline.value = false
  // Poll the OS directly — the cached ref can be stale after the network returns.
  const online = await refreshConnectivity()
  if (online) {
    checking.value = false
    // Hand back to the router guard, which now sends us to the list or login.
    await router.replace('/')
    return
  }
  // Still offline. Hold the spinner briefly so even an instant result reads as a
  // deliberate check, then surface the hint (re-triggering the shake each tap).
  await new Promise((resolve) => setTimeout(resolve, 500))
  checking.value = false
  requestAnimationFrame(() => { stillOffline.value = true })
}

onMounted(() => {
  stopReconnect = onReconnect(() => { void router.replace('/') })
})

onBeforeUnmount(() => {
  if (stopReconnect) stopReconnect()
})
</script>

<template>
  <div class="offline-page">
    <AppCard variant="narrow">
      <div class="offline-content">
        <span class="offline-icon" aria-hidden="true" v-html="wifiOffIcon"></span>
        <h1 class="offline-title">No connection</h1>
        <p class="offline-text">
          FamCart can't reach the internet right now. Check your connection and
          your list will load as soon as you're back online.
        </p>
        <button class="offline-retry" type="button" :disabled="checking" @click="retry">
          <span v-if="checking" class="offline-retry-spinner"></span>
          <span v-else>Try again</span>
        </button>
        <p v-if="stillOffline" class="offline-hint is-shaking" role="status" aria-live="polite">
          Still no connection. Check your Wi-Fi or mobile data, then try again.
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
  /* The asset ships with a white stroke; drive it from the icon colour instead. */
  stroke: currentColor;
  stroke-width: 2;
}

.offline-title {
  margin: 0;
  font-size: 1.3rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.offline-text {
  margin: 0;
  font-size: 0.9rem;
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
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
  box-shadow: var(--elevation-primary);
  transition: transform 0.1s ease, opacity 0.15s ease;
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
  font-size: 0.82rem;
  font-weight: 600;
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
  border: 2px solid color-mix(in srgb, var(--text-inverse) 45%, transparent);
  border-top-color: var(--text-inverse);
  border-radius: 50%;
  animation: offline-spin 0.7s linear infinite;
}

@keyframes offline-spin {
  to { transform: rotate(360deg); }
}
</style>
