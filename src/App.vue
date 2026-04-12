<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { App as CapacitorApp } from '@capacitor/app'
import { SignIn, useSession, useUser } from '@clerk/vue'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import Dashboard from './pages/Dashboard.vue'
import { setSupabaseAccessTokenGetter } from './lib/supabase'
import { supabase } from './lib/supabase'
import {
  addDebugLog,
  debugOverlayEnabled,
  getDebugLogs,
  subscribeDebugLogs,
  type DebugLogEntry,
} from './lib/debugOverlay'

const { isLoaded, isSignedIn } = useUser()
const { session } = useSession()
let realtimeAuthTimer: number | null = null
let authLoadTimeout: number | null = null
let appStateListener: PluginListenerHandle | null = null
const isNativePlatform = Capacitor.isNativePlatform()
const signInOauthFlow: 'auto' | 'redirect' = isNativePlatform ? 'redirect' : 'auto'
const authLoadTimedOut = ref(false)
const nativePublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY_NATIVE
const webPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
const activePublishableKey = isNativePlatform && nativePublishableKey
  ? nativePublishableKey
  : webPublishableKey
const nativeUsesTestKey = isNativePlatform && activePublishableKey?.startsWith('pk_test_')
const showDebugOverlay = ref(debugOverlayEnabled)
const debugCollapsed = ref(false)
const debugLogs = ref<DebugLogEntry[]>(getDebugLogs())
const debugLogCount = computed(() => debugLogs.value.length)

let stopDebugSubscription: (() => void) | null = null

async function refreshRealtimeAuth() {
  const token = await session.value?.getToken()
  supabase.realtime.setAuth(token ?? null)
}

async function handleRealtimeResume(source: 'visibility' | 'app-state') {
  await refreshRealtimeAuth()
  window.dispatchEvent(new CustomEvent('famcart:realtime-resume'))

  if (debugOverlayEnabled) {
    addDebugLog('info', 'Realtime resumed', { source })
  }
}

function handleVisibilityRefresh() {
  if (document.visibilityState !== 'visible') return
  void handleRealtimeResume('visibility')
}

watch(
  session,
  (nextSession) => {
    // Always fetch a fresh Clerk token per request to avoid stale JWTs.
    setSupabaseAccessTokenGetter(async () => nextSession?.getToken() ?? null)
    void refreshRealtimeAuth()

    if (debugOverlayEnabled) {
      addDebugLog('info', 'Session changed', {
        hasSession: Boolean(nextSession),
      })
    }
  },
  { immediate: true },
)

watch(
  [isLoaded, isSignedIn],
  ([loaded, signedIn]) => {
    if (!debugOverlayEnabled) return

    addDebugLog('info', 'Auth state', {
      loaded,
      signedIn,
    })
  },
  { immediate: true },
)

watch(isLoaded, (loaded) => {
  if (!loaded) return

  authLoadTimedOut.value = false

  if (authLoadTimeout !== null) {
    window.clearTimeout(authLoadTimeout)
    authLoadTimeout = null
  }
})

onMounted(() => {
  if (debugOverlayEnabled) {
    stopDebugSubscription = subscribeDebugLogs((entries) => {
      debugLogs.value = entries
    })

    addDebugLog('info', 'App mounted', {
      native: isNativePlatform,
      platform: Capacitor.getPlatform(),
      oauthFlow: signInOauthFlow,
      userAgent: navigator.userAgent,
    })
  }

  // Keep realtime websocket auth fresh on long-lived mobile sessions.
  realtimeAuthTimer = window.setInterval(() => {
    void refreshRealtimeAuth()
  }, 55_000)

  authLoadTimeout = window.setTimeout(() => {
    if (isLoaded.value) return

    authLoadTimedOut.value = true
    addDebugLog('error', 'Clerk did not finish loading within 12s.')
  }, 12_000)

  document.addEventListener('visibilitychange', handleVisibilityRefresh)

  if (isNativePlatform) {
    void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return
      void handleRealtimeResume('app-state')
    }).then((listener) => {
      appStateListener = listener
    })
  }
})

onBeforeUnmount(() => {
  if (stopDebugSubscription) {
    stopDebugSubscription()
    stopDebugSubscription = null
  }

  if (realtimeAuthTimer !== null) {
    window.clearInterval(realtimeAuthTimer)
    realtimeAuthTimer = null
  }

  if (authLoadTimeout !== null) {
    window.clearTimeout(authLoadTimeout)
    authLoadTimeout = null
  }

  document.removeEventListener('visibilitychange', handleVisibilityRefresh)

  if (appStateListener) {
    void appStateListener.remove()
    appStateListener = null
  }

  setSupabaseAccessTokenGetter(async () => null)
  supabase.realtime.setAuth(null)
})
</script>

<template>
  <button
    v-if="showDebugOverlay"
    type="button"
    class="debug-pill"
    @click="debugCollapsed = !debugCollapsed"
  >
    {{ debugCollapsed ? `Show Logs (${debugLogCount})` : 'Hide Logs' }}
  </button>

  <aside v-if="showDebugOverlay && !debugCollapsed" class="debug-overlay">
    <div class="debug-overlay__header">
      <strong>Debug Logs</strong>
      <span>{{ debugLogCount }}</span>
    </div>

    <div class="debug-overlay__list">
      <p v-for="entry in debugLogs" :key="entry.id" :class="['debug-line', `debug-line--${entry.level}`]">
        [{{ entry.ts }}] {{ entry.level.toUpperCase() }} {{ entry.message }}
      </p>
    </div>
  </aside>

  <div v-if="!isLoaded" class="splash">
    <div class="splash-spinner"></div>
    <p class="splash-text">Loading...</p>

    <div v-if="authLoadTimedOut" class="startup-help">
      <p class="startup-help__title">Auth initialization is stuck</p>
      <p class="startup-help__body">
        Clerk did not initialize in time on this device.
      </p>
      <p v-if="nativeUsesTestKey" class="startup-help__body">
        This Android build is using a Clerk development key (`pk_test_*`).
        Use `VITE_CLERK_PUBLISHABLE_KEY_NATIVE` with a production publishable key for mobile builds.
      </p>
    </div>
  </div>

  <section v-else-if="!isSignedIn" class="auth-screen">
    <!-- Top bar -->
    <div class="auth-topbar">
      <span class="topbar-icon">🛒</span>
      <span class="topbar-title">
        Family Groceries,
        <span class="topbar-title--accent">fresh together daily</span>
      </span>
    </div>

    <!-- Illustration banner -->
    <div class="auth-banner">
      <div class="banner-items" aria-hidden="true">
        <span class="banner-emoji b1">🥦</span>
        <span class="banner-emoji b2">🍊</span>
        <span class="banner-emoji b3">🥖</span>
        <span class="banner-emoji b4">🧃</span>
        <span class="banner-emoji b5">🥚</span>
        <span class="banner-emoji b6">🫐</span>
        <span class="banner-emoji b7">🍎</span>
        <span class="banner-emoji b8">🥑</span>
      </div>
    </div>

    <!-- Welcome copy -->
    <div class="auth-welcome">
      <h1>Welcome Back!</h1>
      <p>Login to manage your family grocery list and stay organized.</p>
    </div>

    <!-- Clerk sign-in widget -->
    <div class="centered auth-signin">
      <SignIn
        routing="hash"
        :oauth-flow="signInOauthFlow"
      />
    </div>
  </section>

  <Dashboard v-else />
</template>

<style scoped>
/* --- Splash --- */

.centered {
  margin-inline: auto;
}

.splash {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  height: 100dvh;
  padding: 20px;
  background: #f6f8f7;
}

.splash-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(48, 232, 140, 0.25);
  border-top-color: #30e88c;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.splash-text {
  color: #64748b;
  font-size: 0.875rem;
  font-weight: 500;
}

.startup-help {
  width: min(460px, 100%);
  margin-top: 14px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid rgba(239, 68, 68, 0.35);
  background: #fff1f1;
  color: #9f1239;
}

.startup-help__title {
  margin: 0 0 6px;
  font-size: 0.9rem;
  font-weight: 700;
}

.startup-help__body {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.4;
}

.startup-help__body + .startup-help__body {
  margin-top: 6px;
}

/* --- Auth screen --- */
.auth-screen {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background: #f6f8f7;
  overflow-x: hidden;
}

/* --- Top bar --- */
.auth-topbar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: calc(var(--safe-top) + 14px) 16px 12px;
}

.topbar-icon {
  font-size: 1.25rem;
}

.topbar-title {
  font-size: 1.0625rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: #0f172a;
}

.topbar-title--accent {
  color: #1a7a48;
  font-weight: 800;
}

/* --- Illustration banner --- */
.auth-banner {
  position: relative;
  margin: 4px 16px 0;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(48, 232, 140, 0.12) 0%, rgba(48, 232, 140, 0.06) 100%);
  min-height: 200px;
  overflow: hidden;
  animation: fadeIn 0.5s ease-out both;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

.banner-items {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-template-rows: repeat(2, 1fr);
  place-items: center;
  padding: 16px;
}

.banner-emoji {
  font-size: 2.5rem;
  animation: pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

.b1 {
  animation-delay: 0.1s;
}

.b2 {
  animation-delay: 0.2s;
}

.b3 {
  animation-delay: 0.3s;
}

.b4 {
  animation-delay: 0.4s;
}

.b5 {
  animation-delay: 0.5s;
}

.b6 {
  animation-delay: 0.6s;
}

.b7 {
  animation-delay: 0.7s;
}

.b8 {
  animation-delay: 0.8s;
}

@keyframes pop {
  0% {
    opacity: 0;
    transform: scale(0) rotate(-12deg);
  }

  100% {
    opacity: 1;
    transform: scale(1) rotate(0deg);
  }
}

/* --- Welcome copy --- */
.auth-welcome {
  text-align: center;
  padding: 28px 24px 8px;
  animation: slideUp 0.5s 0.2s ease-out both;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(16px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.auth-welcome h1 {
  font-size: 1.875rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: #0f172a;
}

.auth-welcome p {
  margin-top: 8px;
  color: #64748b;
  font-size: 0.9375rem;
  line-height: 1.5;
  max-width: 320px;
  margin-left: auto;
  margin-right: auto;
}

.auth-signin {
  animation: slideUp 0.5s 0.4s ease-out both;
  margin-bottom: calc(var(--safe-bottom) + 24px);
}

.debug-pill {
  position: fixed;
  right: 12px;
  bottom: calc(var(--safe-bottom) + 12px);
  z-index: 10001;
  padding: 8px 12px;
  border-radius: 999px;
  background: #111827;
  color: #f9fafb;
  font-size: 12px;
  font-weight: 700;
  box-shadow: 0 8px 24px rgba(2, 6, 23, 0.35);
}

.debug-overlay {
  position: fixed;
  left: 10px;
  right: 10px;
  bottom: calc(var(--safe-bottom) + 52px);
  max-height: 40dvh;
  z-index: 10000;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(15, 23, 42, 0.95);
  color: #e2e8f0;
  box-shadow: 0 10px 26px rgba(2, 6, 23, 0.4);
  overflow: hidden;
}

.debug-overlay__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.25);
  font-size: 12px;
}

.debug-overlay__list {
  max-height: calc(40dvh - 36px);
  overflow-y: auto;
  padding: 8px 10px;
}

.debug-line {
  margin: 0 0 6px;
  font-size: 11px;
  line-height: 1.35;
  word-break: break-word;
}

.debug-line--warn {
  color: #facc15;
}

.debug-line--error {
  color: #fca5a5;
}
</style>