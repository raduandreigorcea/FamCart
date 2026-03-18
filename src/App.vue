<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { SignIn, useSession, useUser } from '@clerk/vue'
import Dashboard from './pages/Dashboard.vue'
import { setSupabaseAccessTokenGetter } from './lib/supabase.js'
import { supabase } from './lib/supabase.js'

const { isLoaded, isSignedIn } = useUser()
const { session } = useSession()
let realtimeAuthTimer: number | null = null

async function refreshRealtimeAuth() {
  const token = await session.value?.getToken()
  supabase.realtime.setAuth(token ?? null)
}

watch(
  session,
  (nextSession) => {
    // Always fetch a fresh Clerk token per request to avoid stale JWTs.
    setSupabaseAccessTokenGetter(async () => nextSession?.getToken() ?? null)
    void refreshRealtimeAuth()
  },
  { immediate: true },
)

onMounted(() => {
  // Keep realtime websocket auth fresh on long-lived mobile sessions.
  realtimeAuthTimer = window.setInterval(() => {
    void refreshRealtimeAuth()
  }, 55_000)

  document.addEventListener('visibilitychange', refreshRealtimeAuth)
})

onBeforeUnmount(() => {
  if (realtimeAuthTimer !== null) {
    window.clearInterval(realtimeAuthTimer)
    realtimeAuthTimer = null
  }

  document.removeEventListener('visibilitychange', refreshRealtimeAuth)
  setSupabaseAccessTokenGetter(async () => null)
  supabase.realtime.setAuth(null)
})
</script>

<template>
  <div v-if="!isLoaded" class="splash">
    <div class="splash-spinner"></div>
    <p class="splash-text">Loading...</p>
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
      <SignIn routing="hash" fallback-redirect-url="/" force-redirect-url="/" />
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
}
</style>