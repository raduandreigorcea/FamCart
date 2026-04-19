<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { App as CapacitorApp } from '@capacitor/app'
import { useClerk, useSession, useUser } from '@clerk/vue'
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
const clerk = useClerk()
let realtimeAuthTimer: number | null = null
let authLoadTimeout: number | null = null
let appStateListener: PluginListenerHandle | null = null
const isNativePlatform = Capacitor.isNativePlatform()
const authLoadTimedOut = ref(false)
const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY_NATIVE || import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
const nativeUsesTestKey = isNativePlatform && publishableKey?.startsWith('pk_test_')
const showDebugOverlay = ref(debugOverlayEnabled)
const debugCollapsed = ref(false)
const debugLogs = ref<DebugLogEntry[]>(getDebugLogs())
const debugLogCount = computed(() => debugLogs.value.length)

let stopDebugSubscription: (() => void) | null = null

// --- Email OTP sign-in ---
const emailInput = ref('')
const otpCode = ref('')
const OTP_LENGTH = 6
const otpDigits = ref<string[]>(Array.from({ length: OTP_LENGTH }, () => ''))
const otpAllSelected = ref(false)
const emailOtpStep = ref<'email' | 'code'>('email')
const emailOtpLoading = ref(false)
const emailOtpError = ref('')
let pendingSignIn: any = null
let pendingSignUp: any = null
const isSignUpFlow = ref(false)

const oauthLoading = ref<string | null>(null)
const isOtpCodeComplete = computed(() => otpDigits.value.every((digit) => digit.length === 1))

function isOAuthLoading(strategy: 'oauth_google' | 'oauth_apple' | 'oauth_microsoft') {
  return oauthLoading.value === strategy
}

function clearOtpDigits() {
  otpDigits.value = Array.from({ length: OTP_LENGTH }, () => '')
  otpCode.value = ''
  otpAllSelected.value = false
}

function syncOtpCodeFromDigits() {
  otpCode.value = otpDigits.value.join('')
}

function focusOtpDigit(index: number) {
  const next = document.getElementById(`otp-digit-${index}`) as HTMLInputElement | null
  next?.focus()
  next?.select()
}

function handleOtpDigitInput(index: number, event: Event) {
  const target = event.target as HTMLInputElement
  const value = target.value.replace(/\D/g, '').slice(-1)

  if (otpAllSelected.value) {
    otpDigits.value = Array.from({ length: OTP_LENGTH }, () => '')
    otpAllSelected.value = false
  }

  otpDigits.value[index] = value
  target.value = value
  syncOtpCodeFromDigits()

  if (value && index < OTP_LENGTH - 1) {
    focusOtpDigit(index + 1)
  }
}

function handleOtpDigitKeydown(index: number, event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
    event.preventDefault()
    otpAllSelected.value = true
    return
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    otpAllSelected.value = false
    if (index > 0) {
      focusOtpDigit(index - 1)
    }
    return
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault()
    otpAllSelected.value = false
    if (index < OTP_LENGTH - 1) {
      focusOtpDigit(index + 1)
    }
    return
  }

  if (event.key === 'Delete') {
    event.preventDefault()
    if (otpAllSelected.value) {
      clearOtpDigits()
      focusOtpDigit(0)
      return
    }

    if (otpDigits.value[index]) {
      otpDigits.value[index] = ''
      syncOtpCodeFromDigits()
    } else if (index < OTP_LENGTH - 1) {
      focusOtpDigit(index + 1)
    }
    return
  }

  if (event.key === 'Backspace') {
    if (otpAllSelected.value) {
      event.preventDefault()
      clearOtpDigits()
      focusOtpDigit(0)
      return
    }

    if (otpDigits.value[index]) {
      event.preventDefault()
      otpDigits.value[index] = ''
      syncOtpCodeFromDigits()
    } else if (index > 0) {
      event.preventDefault()
      focusOtpDigit(index - 1)
    }
  }
}

function handleOtpPaste(event: ClipboardEvent) {
  event.preventDefault()
  otpAllSelected.value = false
  const pasted = event.clipboardData?.getData('text') ?? ''
  const digits = pasted.replace(/\D/g, '').slice(0, OTP_LENGTH).split('')

  otpDigits.value = Array.from({ length: OTP_LENGTH }, (_, index) => digits[index] ?? '')
  syncOtpCodeFromDigits()

  const firstEmptyIndex = otpDigits.value.findIndex((digit) => !digit)
  focusOtpDigit(firstEmptyIndex === -1 ? OTP_LENGTH - 1 : firstEmptyIndex)
}

async function handleOAuth(strategy: 'oauth_google' | 'oauth_apple' | 'oauth_microsoft') {
  const c = clerk.value
  if (!c?.client) return

  oauthLoading.value = strategy
  emailOtpError.value = ''

  try {
    addDebugLog('info', 'Starting OAuth', { strategy })
    await c.client.signIn.authenticateWithRedirect({
      strategy,
      redirectUrl: `${window.location.origin}/sso-callback`,
      redirectUrlComplete: window.location.origin,
    })
  } catch (err: any) {
    emailOtpError.value = err?.errors?.[0]?.longMessage || err?.message || 'OAuth sign-in failed'
    addDebugLog('error', 'OAuth error', emailOtpError.value)
    oauthLoading.value = null
  }
}

async function handleEmailOtpStart() {
  const c = clerk.value
  if (!c?.client || !emailInput.value.trim()) return

  emailOtpLoading.value = true
  emailOtpError.value = ''
  isSignUpFlow.value = false
  pendingSignUp = null

  try {
    addDebugLog('info', 'Starting email OTP sign-in', { email: emailInput.value })

    pendingSignIn = await c.client.signIn.create({
      strategy: 'email_code' as any,
      identifier: emailInput.value.trim(),
    })

    clearOtpDigits()
    emailOtpStep.value = 'code'
    addDebugLog('info', 'OTP code sent to email')
  } catch (err: any) {
    const errCode = err?.errors?.[0]?.code
    if (errCode === 'form_identifier_not_found') {
      // User doesn't exist yet — start sign-up flow
      try {
        addDebugLog('info', 'User not found, starting sign-up flow')
        pendingSignUp = await c.client.signUp.create({
          emailAddress: emailInput.value.trim(),
        })
        await pendingSignUp.prepareEmailAddressVerification({ strategy: 'email_code' })
        isSignUpFlow.value = true
        clearOtpDigits()
        emailOtpStep.value = 'code'
        addDebugLog('info', 'Sign-up OTP code sent to email')
      } catch (signUpErr: any) {
        emailOtpError.value = signUpErr?.errors?.[0]?.longMessage || signUpErr?.message || 'Failed to send code'
        addDebugLog('error', 'Email sign-up start error', emailOtpError.value)
      }
    } else {
      emailOtpError.value = err?.errors?.[0]?.longMessage || err?.message || 'Failed to send code'
      addDebugLog('error', 'Email OTP start error', emailOtpError.value)
    }
  } finally {
    emailOtpLoading.value = false
  }
}

async function handleEmailOtpVerify() {
  const c = clerk.value
  if (!c?.client || !isOtpCodeComplete.value) return
  if (!pendingSignIn && !pendingSignUp) return

  syncOtpCodeFromDigits()

  emailOtpLoading.value = true
  emailOtpError.value = ''

  try {
    addDebugLog('info', 'Verifying OTP code...', { isSignUp: isSignUpFlow.value })

    if (isSignUpFlow.value && pendingSignUp) {
      const result = await pendingSignUp.attemptEmailAddressVerification({
        code: otpCode.value.trim(),
      })

      if (result.status === 'complete' && result.createdSessionId) {
        await c.setActive({ session: result.createdSessionId })
        addDebugLog('info', 'Email sign-up complete!')
        emailOtpStep.value = 'email'
        emailInput.value = ''
        clearOtpDigits()
        pendingSignUp = null
        isSignUpFlow.value = false
        return
      }

      addDebugLog('warn', 'Sign-up verify: unexpected status', { status: result.status })
      emailOtpError.value = 'Verification incomplete. Please try again.'
    } else if (pendingSignIn) {
      const result = await pendingSignIn.attemptFirstFactor({
        strategy: 'email_code',
        code: otpCode.value.trim(),
      })

      if (result.status === 'complete' && result.createdSessionId) {
        await c.setActive({ session: result.createdSessionId })
        addDebugLog('info', 'Email OTP sign-in complete!')
        emailOtpStep.value = 'email'
        emailInput.value = ''
        clearOtpDigits()
        pendingSignIn = null
        return
      }

      addDebugLog('warn', 'OTP verify: unexpected status', { status: result.status })
      emailOtpError.value = 'Verification incomplete. Please try again.'
    }
  } catch (err: any) {
    emailOtpError.value = err?.errors?.[0]?.longMessage || err?.message || 'Invalid code'
    addDebugLog('error', 'Email OTP verify error', emailOtpError.value)
  } finally {
    emailOtpLoading.value = false
  }
}

function handleEmailOtpBack() {
  emailOtpStep.value = 'email'
  clearOtpDigits()
  emailOtpError.value = ''
  pendingSignIn = null
  pendingSignUp = null
  isSignUpFlow.value = false
}

async function refreshRealtimeAuth() {
  const token = await session.value?.getToken()
  supabase.realtime.setAuth(token ?? null)
}

let realtimeResumeDebounce: number | null = null

async function handleRealtimeResume(source: 'visibility' | 'app-state') {
  // Debounce rapid resume events (e.g. barcode scanner open/close triggers
  // both visibilitychange and appStateChange within milliseconds).
  if (realtimeResumeDebounce !== null) {
    window.clearTimeout(realtimeResumeDebounce)
  }

  realtimeResumeDebounce = window.setTimeout(async () => {
    realtimeResumeDebounce = null
    await refreshRealtimeAuth()
    window.dispatchEvent(new CustomEvent('famcart:realtime-resume'))

    if (debugOverlayEnabled) {
      addDebugLog('info', 'Realtime resumed', { source })
    }
  }, 1000)
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

  if (realtimeResumeDebounce !== null) {
    window.clearTimeout(realtimeResumeDebounce)
    realtimeResumeDebounce = null
  }

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

    <div class="auth-body">
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

    <!-- Custom sign-in -->
    <div class="centered auth-signin">
      <div class="custom-auth">
        <!-- Email OTP -->
        <div class="email-otp">
          <template v-if="emailOtpStep === 'email'">
            <label class="otp-label" for="otp-email">Email address</label>
            <input
              id="otp-email"
              v-model="emailInput"
              type="email"
              class="otp-input"
              placeholder="you@example.com"
              autocomplete="email"
              inputmode="email"
              :disabled="emailOtpLoading"
              @keyup.enter="handleEmailOtpStart"
            />
            <button
              class="otp-submit"
              :disabled="emailOtpLoading || !emailInput.trim()"
              @click="handleEmailOtpStart"
            >
              {{ emailOtpLoading ? 'Sending...' : 'Send sign-in code' }}
            </button>
          </template>

          <template v-else>
            <p class="otp-sent-msg">Enter the code sent to <strong>{{ emailInput }}</strong></p>
            <div class="otp-code-grid" @paste="handleOtpPaste">
              <input
                v-for="(_, index) in otpDigits"
                :id="`otp-digit-${index}`"
                :key="index"
                :value="otpDigits[index]"
                type="text"
                :class="['otp-digit', { 'otp-digit--all-selected': otpAllSelected }]"
                autocomplete="one-time-code"
                inputmode="numeric"
                pattern="[0-9]*"
                maxlength="1"
                :disabled="emailOtpLoading"
                @input="handleOtpDigitInput(index, $event)"
                @keydown="handleOtpDigitKeydown(index, $event)"
                @focus="otpAllSelected = false"
                @keyup.enter="handleEmailOtpVerify"
              />
            </div>
            <button
              class="otp-submit"
              :disabled="emailOtpLoading || !isOtpCodeComplete"
              @click="handleEmailOtpVerify"
            >
              {{ emailOtpLoading ? 'Verifying...' : 'Verify code' }}
            </button>
            <button class="otp-back" @click="handleEmailOtpBack">
              &larr; Use a different email
            </button>
          </template>

          <p v-if="emailOtpError" class="auth-error">{{ emailOtpError }}</p>
        </div>

        <!-- Divider -->
        <div class="auth-divider">
          <span class="auth-divider__line"></span>
          <span class="auth-divider__text">or</span>
          <span class="auth-divider__line"></span>
        </div>

        <!-- OAuth buttons -->
        <div class="oauth-buttons">
          <button
            class="oauth-btn oauth-btn--google"
            :class="{ 'oauth-btn--loading': isOAuthLoading('oauth_google') }"
            :disabled="!!oauthLoading"
            @click="handleOAuth('oauth_google')"
            aria-label="Continue with Google"
          >
            <span v-if="isOAuthLoading('oauth_google')" class="oauth-spinner" aria-hidden="true"></span>
            <svg v-else class="oauth-icon" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09a6.97 6.97 0 0 1 0-4.17V7.07H2.18A11.97 11.97 0 0 0 0 12c0 1.94.46 3.77 1.28 5.4l3.56-2.77.01-.54z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
          </button>
          <button
            class="oauth-btn oauth-btn--apple"
            :class="{ 'oauth-btn--loading': isOAuthLoading('oauth_apple') }"
            :disabled="!!oauthLoading"
            @click="handleOAuth('oauth_apple')"
            aria-label="Continue with Apple"
          >
            <span v-if="isOAuthLoading('oauth_apple')" class="oauth-spinner" aria-hidden="true"></span>
            <svg v-else class="oauth-icon" viewBox="0 0 24 24"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" fill="currentColor"/></svg>
          </button>
          <button
            class="oauth-btn oauth-btn--microsoft"
            :class="{ 'oauth-btn--loading': isOAuthLoading('oauth_microsoft') }"
            :disabled="!!oauthLoading"
            @click="handleOAuth('oauth_microsoft')"
            aria-label="Continue with Microsoft"
          >
            <span v-if="isOAuthLoading('oauth_microsoft')" class="oauth-spinner" aria-hidden="true"></span>
            <svg v-else class="oauth-icon" viewBox="0 0 24 24"><rect x="1" y="1" width="10" height="10" fill="#F25022"/><rect x="13" y="1" width="10" height="10" fill="#7FBA00"/><rect x="1" y="13" width="10" height="10" fill="#00A4EF"/><rect x="13" y="13" width="10" height="10" fill="#FFB900"/></svg>
          </button>
        </div>
      </div>
    </div>
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

.auth-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  justify-content: center;
  padding: 0 0 calc(var(--safe-bottom) + 16px);
  gap: 0;
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
  width: calc(100% - 32px);
  max-width: 400px;
  border-radius: 18px;
  background: linear-gradient(135deg, rgba(48, 232, 140, 0.14) 0%, rgba(48, 232, 140, 0.04) 100%);
  min-height: 110px;
  overflow: hidden;
  animation: fadeIn 0.5s ease-out both;
}

@media (min-height: 700px) {
  .auth-banner {
    min-height: 150px;
  }
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
  padding: 16px 24px 4px;
  animation: slideUp 0.5s 0.2s ease-out both;
}

@media (min-height: 700px) {
  .auth-welcome {
    padding: 20px 24px 4px;
  }
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
  font-size: 1.625rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: #0f172a;
}

.auth-welcome p {
  margin-top: 6px;
  color: #64748b;
  font-size: 0.875rem;
  line-height: 1.45;
  max-width: 300px;
  margin-left: auto;
  margin-right: auto;
}

.auth-signin {
  animation: slideUp 0.5s 0.4s ease-out both;
  margin-top: 4px;
  width: 100%;
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

.native-auth,
.custom-auth {
  margin-inline: 24px;
  box-sizing: border-box;
  padding: 20px 24px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06), 0 4px 16px rgba(0, 0, 0, 0.04);
}

/* --- OAuth buttons --- */
.oauth-buttons {
  display: flex;
  flex-direction: row;
  gap: 10px;
  justify-content: center;
}

.oauth-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 12px;
  border: 1.5px solid #e5e7eb;
  border-radius: 10px;
  background: #fafbfc;
  color: #1e293b;
  font-size: 0;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
}

.oauth-btn:hover {
  background: #f1f5f9;
  border-color: #cbd5e1;
}

.oauth-btn:active {
  background: #e8ecf1;
  box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.15);
}

.oauth-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.oauth-btn--loading {
  border-color: #94a3b8;
  background: #f8fafc;
}

.oauth-icon {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}

.oauth-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(148, 163, 184, 0.35);
  border-top-color: #334155;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.oauth-btn--apple {
  color: #000;
}

/* --- Divider --- */
.auth-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 16px 0;
}

.auth-divider__line {
  flex: 1;
  height: 1px;
  background: #e2e8f0;
}

.auth-divider__text {
  font-size: 0.75rem;
  color: #94a3b8;
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.05em;
}

.email-otp {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.otp-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #374151;
}

.otp-input {
  width: 100%;
  padding: 13px 14px;
  border: 1.5px solid #d1d5db;
  border-radius: 10px;
  font-size: 1rem;
  font-family: inherit;
  color: #111827;
  background: #fff;
  outline: none;
  transition: border-color 0.15s;
  box-sizing: border-box;
}

.otp-input:focus {
  border-color: #30e88c;
  box-shadow: 0 0 0 3px rgba(48, 232, 140, 0.15);
}

.otp-input--code {
  text-align: center;
  letter-spacing: 0.3em;
  font-weight: 700;
}

.otp-code-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 8px;
}

.otp-digit {
  width: 100%;
  height: 48px;
  border: 1.5px solid #d1d5db;
  border-radius: 10px;
  background: #fff;
  color: #111827;
  text-align: center;
  font-size: 1.05rem;
  font-weight: 700;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  box-sizing: border-box;
}

.otp-digit:focus {
  border-color: #30e88c;
  box-shadow: 0 0 0 3px rgba(48, 232, 140, 0.15);
}

.otp-digit--all-selected {
  border-color: #30e88c;
  background: #ecfdf4;
  box-shadow: 0 0 0 2px rgba(48, 232, 140, 0.18);
}

.otp-digit:disabled {
  background: #f8fafc;
}

.otp-submit {
  width: 100%;
  padding: 12px 24px;
  border: none;
  border-radius: 10px;
  background: linear-gradient(135deg, #1a7a48 0%, #22885a 100%);
  color: #fff;
  font-size: 0.9375rem;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
  box-shadow: 0 2px 8px rgba(26, 122, 72, 0.25);
}

.otp-submit:hover {
  background: linear-gradient(135deg, #15633a 0%, #1d7a4e 100%);
}

.otp-submit:active {
  transform: scale(0.98);
}

.otp-submit:disabled {
  opacity: 0.5;
  cursor: default;
}

.otp-back {
  background: none;
  border: none;
  color: #64748b;
  font-size: 0.8125rem;
  font-family: inherit;
  cursor: pointer;
  padding: 0;
  text-align: center;
}

.otp-back:active {
  color: #334155;
}

.otp-sent-msg {
  font-size: 0.8125rem;
  color: #374151;
  text-align: center;
  margin: 0;
  line-height: 1.4;
}

.auth-error {
  color: #ef4444;
  font-size: 0.85rem;
  text-align: center;
  margin-top: 4px;
}

@media (min-width: 900px) {
  .auth-body {
    padding: 12px 32px calc(var(--safe-bottom) + 24px);
  }

  .auth-banner {
    max-width: 520px;
  }

  .auth-welcome p {
    max-width: 420px;
  }

  .auth-signin {
    max-width: 920px;
  }

  .native-auth,
  .custom-auth {
    margin-inline: 0;
    padding: 24px 28px;
  }
}
</style>