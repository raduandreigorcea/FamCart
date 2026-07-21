import { createApp } from 'vue'
import { clerkPlugin } from '@clerk/vue'
import * as Sentry from '@sentry/vue'
import './style.css'
import App from './App.vue'
import router from './router'
import { startConnectivity } from './lib/connectivity'
import { initPushNotifications } from './lib/pushNotifications'

// Begin tracking real connectivity as early as possible so the router's first
// navigation can make a trustworthy offline/online decision.
startConnectivity()

// OneSignal push: loads the web SDK (or initializes the native plugin) when a
// VITE_ONESIGNAL_APP_ID is configured; a no-op otherwise.
initPushNotifications()

// A lazy import can fail after a fresh deploy: the running page still asks for
// the old hashed chunk, which no longer exists and 404s to index.html — hence
// "'text/html' is not a valid JavaScript MIME type" and "Unable to preload CSS"
// from Vite's async component/CSS loader. A reload pulls the current manifest.
// Guard with a one-shot session flag: a second failure means the chunk is
// genuinely broken, not merely stale, so reloading again would only loop.
const CHUNK_RELOAD_KEY = 'famcart-chunk-reloaded'
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) return
  sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
  window.location.reload()
})

const savedTheme = localStorage.getItem('famcart-theme')
const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
if (savedTheme === 'light' || savedTheme === 'dark') {
  document.documentElement.setAttribute('data-theme', savedTheme)
} else {
  document.documentElement.setAttribute('data-theme', systemPrefersDark ? 'dark' : 'light')
}

const app = createApp(App)

// Error monitoring is opt-in per environment: without a DSN (local dev, CI)
// Sentry never initializes and adds no runtime behavior.
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    app,
    dsn: import.meta.env.VITE_SENTRY_DSN,
    integrations: [Sentry.browserTracingIntegration({ router })],
    tracesSampleRate: 0.1,
    // A fetch/websocket aborted because the user navigated mid-request (e.g.
    // Clerk during a login redirect) is expected teardown, not a fault we can
    // act on. Keep it out of the issue stream.
    ignoreErrors: ['AbortError: The connection was closed.'],
    beforeSend(event) {
      // Service-worker registration (vite-plugin-pwa's registerSW.js) can reject
      // while the OAuth callback page is already unloading to redirect; the PWA
      // re-registers on the next load, so there is nothing to fix here.
      const frames = event.exception?.values?.flatMap(
        (value) => value.stacktrace?.frames ?? [],
      )
      if (frames?.some((frame) => (frame.filename ?? '').includes('registerSW.js'))) {
        return null
      }
      return event
    },
  })
}

app.use(clerkPlugin, {
  publishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
})

app.use(router)
app.mount('#app')
