import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { clerkPlugin } from '@clerk/vue'
import { Capacitor } from '@capacitor/core'
import {
  addDebugLog,
  debugOverlayEnabled,
  installDebugLogCapture,
  renderBootstrapFailure,
} from './lib/debugOverlay'

installDebugLogCapture()
const isNativePlatform = Capacitor.isNativePlatform()
const webPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
const nativePublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY_NATIVE
const PUBLISHABLE_KEY = isNativePlatform && nativePublishableKey
  ? nativePublishableKey
  : webPublishableKey

addDebugLog('info', 'Bootstrap start', {
  native: isNativePlatform,
  mode: import.meta.env.MODE,
  href: window.location.href,
  usingNativeKeyOverride: Boolean(isNativePlatform && nativePublishableKey),
})

if (isNativePlatform && PUBLISHABLE_KEY?.startsWith('pk_test_')) {
  addDebugLog(
    'warn',
    'Native build is using a Clerk development key (pk_test_*). This commonly fails in Android WebView; use VITE_CLERK_PUBLISHABLE_KEY_NATIVE with a production key.',
  )
}

if (!PUBLISHABLE_KEY) {
  const missingKeyError = new Error('Add your Clerk Publishable Key to the .env file')
  addDebugLog('error', missingKeyError)

  if (debugOverlayEnabled) {
    renderBootstrapFailure(missingKeyError)
  }

  throw missingKeyError
}

try {
  const app = createApp(App)
  app.use(clerkPlugin, {
    publishableKey: PUBLISHABLE_KEY,
    standardBrowser: !isNativePlatform,
  })
  app.mount('#app')
  addDebugLog('info', 'Vue app mounted')
} catch (error) {
  addDebugLog('error', 'Bootstrap crash', error)

  if (debugOverlayEnabled) {
    renderBootstrapFailure(error)
  }

  throw error
}