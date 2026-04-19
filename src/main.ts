import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { clerkPlugin } from '@clerk/vue'
import { Clerk } from '@clerk/clerk-js'
import { ui } from '@clerk/ui'
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
    'info',
    'Native build is using a Clerk development key — dev browser token will be fetched automatically.',
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

async function bootstrap() {
  // Extract the Clerk FAPI domain from the publishable key.
  const apiDomain = atob(PUBLISHABLE_KEY.replace(/^pk_(test|live)_/, ''))
    .replace(/\$$/, '')
  const isDevKey = PUBLISHABLE_KEY.startsWith('pk_test_')

  if (isNativePlatform && isDevKey) {
    // For dev keys in a WebView we must:
    // 1. Obtain a dev browser token (POST /v1/dev_browser)
    // 2. Patch global fetch to attach it as ?__clerk_db_jwt=<token> to all
    //    requests to the Clerk FAPI (the SDK only does this when
    //    standardBrowser=true, which causes a broken handshake redirect).
    // 3. Use standardBrowser=false so no handshake redirect occurs.
    let devBrowserToken: string | null = null

    addDebugLog('info', 'Fetching dev browser token...', { apiDomain })
    try {
      const res = await fetch(`https://${apiDomain}/v1/dev_browser`, {
        method: 'POST',
      })
      const data = await res.json()
      if (data?.id) {
        devBrowserToken = data.id
        addDebugLog('info', 'Dev browser token obtained')
      } else {
        addDebugLog('error', 'Dev browser token missing from response', data)
      }
    } catch (err: any) {
      addDebugLog('error', 'Dev browser token fetch failed', err?.message || String(err))
    }

    if (devBrowserToken) {
      // Patch fetch so every Clerk FAPI request includes the dev browser JWT.
      const originalFetch = window.fetch.bind(window)
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        let url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

        if (url.includes(apiDomain)) {
          const separator = url.includes('?') ? '&' : '?'
          url = `${url}${separator}__clerk_db_jwt=${devBrowserToken}`
          if (typeof input === 'string') {
            input = url
          } else if (input instanceof URL) {
            input = new URL(url)
          } else {
            input = new Request(url, input)
          }
        }

        const response = await originalFetch(input, init)

        // Refresh the token from response headers (Clerk rotates it).
        const refreshedToken = response.headers.get('Clerk-Db-Jwt')
        if (refreshedToken) {
          devBrowserToken = refreshedToken
        }

        return response
      }
    }
  }

  if (isNativePlatform) {
    // Pre-instantiate Clerk so the plugin skips CDN script loading.
    const clerkInstance = new Clerk(PUBLISHABLE_KEY)
    ;(window as any).Clerk = clerkInstance
  }

  const app = createApp(App)
  app.use(clerkPlugin, {
    publishableKey: PUBLISHABLE_KEY,
    standardBrowser: !isNativePlatform,
    ui,
  })
  app.mount('#app')
  addDebugLog('info', 'Vue app mounted')
}

bootstrap().catch((error) => {
  addDebugLog('error', 'Bootstrap crash', error)

  if (debugOverlayEnabled) {
    renderBootstrapFailure(error)
  }
})