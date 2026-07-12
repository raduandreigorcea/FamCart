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
  })
}

app.use(clerkPlugin, {
  publishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
})

app.use(router)
app.mount('#app')
