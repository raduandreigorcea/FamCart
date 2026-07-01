<script setup>
import { useSignIn } from '@clerk/vue'
import { ref, nextTick } from 'vue'
import screenBg from '../assets/screen.png'
import logoImg from '../assets/logo.png'
import InputRow from '../components/InputRow.vue'
import ErrorMessage from '../components/ErrorMessage.vue'
import AppCard from '../components/AppCard.vue'
import BackButton from '../components/BackButton.vue'

const { signIn, isLoaded: signInLoaded } = useSignIn()

const step = ref('email') // 'email' | 'code'
const email = ref('')
const digits = ref(['', '', '', '', '', ''])
const digitRefs = ref([])
const error = ref('')
const loading = ref(false)
const loadingProvider = ref(null)

const oauthProviders = [
    {
        id: 'oauth_google',
        label: 'Google',
        icon: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`,
    },
    {
        id: 'oauth_apple',
        label: 'Apple',
        icon: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.7 9.05 7.4c1.39.07 2.36.74 3.18.77 1.22-.24 2.39-.93 3.7-.84 1.58.13 2.77.76 3.54 1.94-3.24 1.94-2.47 5.88.48 7.03-.55 1.42-1.28 2.83-2.9 3.98zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>`,
    },
    {
        id: 'oauth_microsoft',
        label: 'Microsoft',
        icon: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M1 1h10v10H1z"/><path fill="currentColor" d="M13 1h10v10H13z"/><path fill="currentColor" d="M1 13h10v10H1z"/><path fill="currentColor" d="M13 13h10v10H13z"/></svg>`,
    },
]

async function signInWithOAuth(providerId) {
    if (!signInLoaded.value || loadingProvider.value) return
    error.value = ''
    loadingProvider.value = providerId
    try {
        await signIn.value.authenticateWithRedirect({
            strategy: providerId,
            redirectUrl: '/sso-callback',
            redirectUrlComplete: `${window.location.origin}/`,
        })
    } catch (e) {
        error.value = e.errors?.[0]?.message ?? 'OAuth sign-in failed.'
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
        error.value = e.errors?.[0]?.longMessage ?? e.errors?.[0]?.message ?? 'Something went wrong.'
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
        error.value = e.errors?.[0]?.longMessage ?? e.errors?.[0]?.message ?? 'Invalid code.'
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
    <div class="login-page" :style="{ backgroundImage: `url(${screenBg})` }">
        <AppCard variant="narrow">
            <!-- Brand -->
            <div class="brand">
                <div class="brand-top">
                    <img :src="logoImg" alt="FamCart logo" class="brand-logo" />
                    <!-- <span class="brand-name">Fam<span class="brand-name--accent">Cart</span></span> -->
                </div>
                <p class="brand-tagline">Family Groceries, <span class="brand-tagline--accent">fresh together daily</span></p>
            </div>

            <!-- Email form -->
            <form v-if="step === 'email'" @submit.prevent="handleEmailSubmit" class="email-form">
                <InputRow v-model="email" type="email" placeholder="your@email.com" autocomplete="email" :loading="loading" required />
                <ErrorMessage :message="error" />
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
                    <ErrorMessage v-else :message="error" />
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
    </div>
</template>

<style scoped>
.login-page {
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    position: relative;
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
    font-size: 2.1rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: var(--text-primary);
    line-height: 1;
}

.brand-name--accent {
    color: var(--color-primary);
}

.brand-tagline {
    font-family: inherit;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
    line-height: 1.4;
}

.brand-tagline--accent {
    color: var(--color-primary);
    font-weight: 600;
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
    font-size: 0.85rem;
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
    font-size: 1.4rem;
    font-weight: 700;
    border: 1.5px solid var(--border-main);
    border-radius: var(--radius-lg);
    outline: none;
    color: var(--text-primary);
    background: var(--bg-surface);
    transition: border-color 0.15s, background 0.15s;
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
    border: 2px solid var(--spinner-stroke);
    border-top-color: var(--bg-surface);
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
    font-size: 0.75rem;
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
    border: 1.5px solid var(--border-main);
    border-radius: var(--radius-xl);
    background: var(--bg-surface);
    color: var(--text-secondary);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
    padding: 0;
}

.oauth-btn:hover:not(:disabled) {
    background: var(--bg-main);
    border-color: var(--color-primary);
    color: var(--color-primary);
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
    border: 2px solid color-mix(in srgb, var(--color-primary) 20%, var(--bg-surface));
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