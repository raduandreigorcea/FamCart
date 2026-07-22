<script setup>
import { useAuth, useClerk, useSignIn, useSignUp } from '@clerk/vue'
import { Capacitor } from '@capacitor/core'
import * as Sentry from '@sentry/vue'
import { ref, nextTick, toRaw, watch } from 'vue'
import { useRouter } from 'vue-router'
import { startNativeOAuth } from '../lib/nativeOAuth'
import InputRow from '../components/InputRow.vue'
import ErrorModal from '../components/ErrorModal.vue'
import ConfirmModal from '../components/ConfirmModal.vue'
import AppCard from '../components/AppCard.vue'
import BackButton from '../components/BackButton.vue'
import { isOfflineError } from '../lib/offlineQueue'

const clerk = useClerk()
const { signIn, isLoaded: signInLoaded } = useSignIn()
const { signUp } = useSignUp()
const { isSignedIn } = useAuth()
const router = useRouter()

const step = ref('email') // 'email' | 'code'
const email = ref('')
const digits = ref(['', '', '', '', '', ''])
const digitRefs = ref([])
const error = ref('')
const loading = ref(false)
const loadingProvider = ref(null)
const alreadySignedInOpen = ref(false)

// The router guard redirects signed-in users away from /login, but it can be
// bypassed: Clerk may load after the guard's timeout let the navigation
// through, or the user signs in from another tab while this one sits on the
// login page. Home is always the right destination for a signed-in user.
watch(isSignedIn, (signedIn) => {
    if (signedIn) router.replace('/')
}, { immediate: true })

// Clerk rejects sign-in attempts with session_exists when a session is
// already active. That is an account-level condition, not an input problem,
// so it gets the app's announcement dialog instead of the inline field error.
function handleSignInError(e, fallback) {
    if (e?.errors?.some((err) => err.code === 'session_exists')) {
        alreadySignedInOpen.value = true
        return
    }
    // A network failure has no Clerk error array; show a plain offline message
    // rather than the raw "Failed to fetch".
    if (isOfflineError(e) && !e?.errors?.length) {
        error.value = 'You appear to be offline. Check your connection and try again.'
        return
    }
    error.value = e?.errors?.[0]?.longMessage ?? e?.errors?.[0]?.message ?? fallback
}

function goToApp() {
    // Full reload so Clerk re-reads the active session before HomeView boots.
    window.location.href = '/'
}

const oauthProviders = [
    {
        id: 'oauth_google',
        label: 'Google',
        icon: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.45c-.28 1.48-1.12 2.74-2.38 3.59v2.98h3.86c2.26-2.08 3.56-5.15 3.56-8.6z"/><path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.86-2.98c-1.07.72-2.44 1.15-4.08 1.15-3.13 0-5.79-2.12-6.74-4.97H1.28v3.12A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.26 14.3A7.2 7.2 0 0 1 4.88 12c0-.8.14-1.58.38-2.3V6.58H1.28A12 12 0 0 0 0 12c0 1.94.46 3.78 1.28 5.42l3.98-3.12z"/><path fill="#EA4335" d="M12 4.73c1.76 0 3.34.61 4.58 1.8l3.43-3.43C17.95 1.2 15.24 0 12 0A12 12 0 0 0 1.28 6.58l3.98 3.12c.95-2.85 3.61-4.97 6.74-4.97z"/></svg>`,
    },
    {
        id: 'oauth_apple',
        label: 'Apple',
        icon: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.7 9.05 7.4c1.39.07 2.36.74 3.18.77 1.22-.24 2.39-.93 3.7-.84 1.58.13 2.77.76 3.54 1.94-3.24 1.94-2.47 5.88.48 7.03-.55 1.42-1.28 2.83-2.9 3.98zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>`,
    },
    {
        id: 'oauth_microsoft',
        label: 'Microsoft',
        icon: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="#F25022" d="M1 1h10v10H1z"/><path fill="#7FBA00" d="M13 1h10v10H13z"/><path fill="#00A4EF" d="M1 13h10v10H1z"/><path fill="#FFB900" d="M13 13h10v10H13z"/></svg>`,
    },
]

async function signInWithOAuth(providerId) {
    if (!signInLoaded.value || loadingProvider.value) return
    error.value = ''
    loadingProvider.value = providerId

    // Native app: the WebView cannot run OAuth (Google refuses embedded
    // browsers), so the round-trip happens in the system browser and returns
    // through the famcart:// deep link. A null session id means the user
    // closed the browser — quietly re-arm the buttons.
    if (Capacitor.isNativePlatform()) {
        try {
            const sessionId = await startNativeOAuth(signIn.value, signUp.value, providerId)
            if (sessionId) {
                // Reaching here means the session already exists server-side
                // (the attempt completed in the external browser); activating
                // it is client bookkeeping. If Clerk's wrapper still trips
                // over it, don't strand a signed-in user on the login screen:
                // the full reload in goToApp() re-reads the session anyway —
                // a cold restart demonstrably comes back logged in.
                try {
                    // toRaw + calling on the instance: both the Vue proxy and
                    // a detached method crash on Clerk's private class fields.
                    await toRaw(clerk.value).setActive({ session: sessionId })
                } catch (activationError) {
                    Sentry.captureException(activationError)
                }
                goToApp()
                return
            }
        } catch (e) {
            // Native OAuth failures are unexpected by definition (user
            // cancellation resolves null instead) — worth a Sentry event
            // (no-op without a DSN). The dialog shows the diagnosis the
            // error carries: which state the attempt got stuck in.
            Sentry.captureException(e)
            handleSignInError(e, e?.message || 'OAuth sign-in failed.')
        }
        loadingProvider.value = null
        return
    }

    try {
        await signIn.value.authenticateWithRedirect({
            strategy: providerId,
            redirectUrl: '/sso-callback',
            redirectUrlComplete: `${window.location.origin}/`,
        })
    } catch (e) {
        handleSignInError(e, 'OAuth sign-in failed.')
        loadingProvider.value = null
    }
}

async function handleEmailSubmit() {
    if (!signInLoaded.value || loading.value) return
    error.value = ''
    loading.value = true
    try {
        const { supportedFirstFactors } = await signIn.value.create({
            identifier: email.value,
        })
        const otpFactor = supportedFirstFactors?.find(
            (f) => f.strategy === 'email_code',
        )
        if (!otpFactor) {
            error.value = 'Email code sign-in is not enabled for this account.'
            return
        }
        await signIn.value.prepareFirstFactor({
            strategy: 'email_code',
            emailAddressId: otpFactor.emailAddressId,
        })
        digits.value = ['', '', '', '', '', '']
        step.value = 'code'
        await nextTick()
        digitRefs.value[0]?.focus()
    } catch (e) {
        handleSignInError(e, 'Something went wrong.')
    } finally {
        loading.value = false
    }
}

async function handleCodeSubmit() {
    if (!signInLoaded.value || loading.value) return
    const code = digits.value.join('')
    if (code.length < 6) return
    error.value = ''
    loading.value = true
    try {
        const result = await signIn.value.attemptFirstFactor({
            strategy: 'email_code',
            code,
        })
        if (result.status === 'complete') {
            window.location.href = '/'
        } else {
            error.value = 'Verification incomplete. Please try again.'
        }
    } catch (e) {
        handleSignInError(e, 'Invalid code.')
        digits.value = ['', '', '', '', '', '']
        await nextTick()
        digitRefs.value[0]?.focus()
    } finally {
        loading.value = false
    }
}

function onDigitInput(index, event) {
    const val = event.target.value.replace(/\D/g, '')
    digits.value[index] = val.slice(-1)
    if (val && index < 5) {
        digitRefs.value[index + 1]?.focus()
    }
    if (digits.value.every(d => d !== '')) {
        handleCodeSubmit()
    }
}

function onDigitKeydown(index, event) {
    if (event.key === 'Backspace' && !digits.value[index] && index > 0) {
        digitRefs.value[index - 1]?.focus()
    }
}

function onDigitPaste(event) {
    event.preventDefault()
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    pasted.split('').forEach((ch, i) => { digits.value[i] = ch })
    const next = Math.min(pasted.length, 5)
    nextTick(() => digitRefs.value[next]?.focus())
    if (pasted.length === 6) handleCodeSubmit()
}

function goBack() {
    step.value = 'email'
    digits.value = ['', '', '', '', '', '']
    error.value = ''
}
</script>

<template>
    <div class="login-page">
        <AppCard variant="narrow">
            <!-- Brand -->
            <div class="brand">
                <div class="brand-top">
                    <img src="/icons/pwa-192.png" alt="FamCart logo" class="brand-logo" />
                    <!-- <span class="brand-name">Fam<span class="brand-name--accent">Cart</span></span> -->
                </div>
                <p class="brand-tagline">Family Groceries, <span class="brand-tagline--accent">fresh together daily</span></p>
            </div>

            <!-- Email form -->
            <form v-if="step === 'email'" @submit.prevent="handleEmailSubmit" class="email-form">
                <InputRow v-model="email" type="email" placeholder="your@email.com" autocomplete="email" :loading="loading" required />
            </form>

            <!-- OTP code form -->
            <div v-else class="otp-section">
                <p class="code-hint">Enter the 6-digit code sent to <strong>{{ email }}</strong></p>
                <div class="otp-row" :class="{ 'otp-row--loading': loading }">
                    <input
                        v-for="(_, i) in digits"
                        :key="i"
                        :ref="el => { if (el) digitRefs[i] = el }"
                        v-model="digits[i]"
                        type="text"
                        inputmode="numeric"
                        maxlength="1"
                        class="otp-input"
                        :disabled="loading"
                        autocomplete="one-time-code"
                        @input="onDigitInput(i, $event)"
                        @keydown="onDigitKeydown(i, $event)"
                        @paste="onDigitPaste"
                        @focus="$event.target.select()"
                    />
                </div>
                <div class="otp-status">
                    <span v-if="loading" class="spinner spinner--dark"></span>
                </div>
                <BackButton @click="goBack" />
            </div>

            <!-- Divider -->
            <div class="divider"><span>or</span></div>

            <!-- OAuth icon buttons -->
            <div class="oauth-row">
                <button v-for="provider in oauthProviders" :key="provider.id" class="oauth-btn"
                    :class="{ 'oauth-btn--loading': loadingProvider === provider.id }"
                    :disabled="!!loadingProvider"
                    :aria-label="provider.label" :title="provider.label" @click="signInWithOAuth(provider.id)">
                    <span v-if="loadingProvider === provider.id" class="oauth-spinner"></span>
                    <span v-else class="oauth-icon" v-html="provider.icon"></span>
                </button>
            </div>
        </AppCard>

        <ConfirmModal
            :open="alreadySignedInOpen"
            title="You're already signed in"
            message="This device already has an active FamCart session."
            confirm-text="Go to my list"
            :show-cancel="false"
            @confirm="goToApp"
            @cancel="goToApp"
        />

        <ErrorModal title="Sign-in failed" :message="error" @dismiss="error = ''" />
    </div>
</template>

<style scoped>
.login-page {
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: calc(1rem + var(--safe-top)) 1rem calc(1rem + var(--safe-bottom));
    position: relative;
    /* The backdrop's gradient runs top-to-bottom, so it must span the full
       height exactly once (no vertical tiling). Size it to the viewport height,
       anchor from the centre, and tile only horizontally to fill wide screens.
       The fill is a fallback behind it. */
    background-color: var(--color-primary-bg);
    background-image: url('/screen.webp');
    background-size: auto 100%;
    background-position: center;
    background-repeat: repeat-x;
}

/* Brand */
.brand {
    text-align: center;
    margin-bottom: 1.75rem;
}

.brand-top {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    margin-bottom: 0.5rem;
}

.brand-logo {
    width: 84px;
    height: 84px;
    object-fit: contain;
}

.brand-name {
    font-family: inherit;
    font-size: var(--text-3xl);
    font-weight: var(--weight-extrabold);
    letter-spacing: -0.02em;
    color: var(--text-primary);
    line-height: 1;
}

.brand-name--accent {
    color: var(--color-primary);
}

.brand-tagline {
    font-family: inherit;
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
    margin: 0;
    line-height: 1.4;
}

.brand-tagline--accent {
    color: var(--color-primary);
    font-weight: var(--weight-semibold);
}

/* Email form */
.email-form {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
}

.otp-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.code-hint {
    font-size: var(--text-base);
    color: var(--text-secondary);
    margin: 0;
    line-height: 1.4;
}

.otp-row {
    display: flex;
    gap: 0.5rem;
    justify-content: space-between;
}

.otp-row--loading {
    opacity: 0.55;
}

.otp-input {
    width: 100%;
    aspect-ratio: 1;
    text-align: center;
    font-family: inherit;
    font-size: var(--text-xl);
    font-weight: var(--weight-bold);
    border: var(--border-width-base) solid var(--border-main);
    border-radius: var(--radius-lg);
    outline: none;
    color: var(--text-primary);
    background: var(--bg-surface);
    transition: border-color var(--transition-fast), background var(--transition-fast);
    caret-color: transparent;
}

.otp-input:focus {
    border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 10%, var(--bg-surface));
}

.otp-status {
    min-height: 1.5rem;
    display: flex;
    align-items: center;
}

.spinner--dark {
    border-color: var(--color-primary);
    border-top-color: var(--color-primary);
}

.spinner {
    width: var(--size-icon-lg);
    height: var(--size-icon-lg);
    border: var(--border-width-thick) solid var(--spinner-stroke);
    border-top-color: var(--text-inverse);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
}

@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}

/* Divider */
.divider {
    display: flex;
    align-items: center;
    margin: 1.25rem 0;
    color: var(--text-disabled);
    font-size: var(--text-xs);
    gap: 0.75rem;
}

.divider::before,
.divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border-main);
}

/* OAuth row */
.oauth-row {
    display: flex;
    gap: 0.875rem;
}

.oauth-btn {
    flex: 1;
    height: var(--size-control-lg);
    display: flex;
    align-items: center;
    justify-content: center;
    border: var(--border-width-base) solid var(--border-main);
    border-radius: var(--radius-xl);
    background: var(--bg-surface);
    color: var(--text-secondary);
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast);
    padding: 0;
}

.oauth-btn:hover:not(:disabled) {
    background: var(--bg-main);
    border-color: var(--color-primary);
}

.oauth-btn:disabled {
    cursor: not-allowed;
    opacity: 0.55;
}

.oauth-btn--loading {
    opacity: 1 !important;
    border-color: var(--color-primary) !important;
    background: color-mix(in srgb, var(--color-primary) 12%, var(--bg-surface)) !important;
}

.oauth-spinner {
    width: 20px;
    height: 20px;
    border: var(--border-width-thick) solid color-mix(in srgb, var(--color-primary) 20%, var(--bg-surface));
    border-top-color: var(--color-primary);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
}

.oauth-icon {
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.oauth-icon :deep(svg) {
    width: 22px;
    height: 22px;
}
</style>