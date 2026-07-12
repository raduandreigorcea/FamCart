// Custom service worker (vite-plugin-pwa injectManifest mode). Owns the
// app-shell precache that generateSW used to emit. Push is NOT handled here:
// OneSignal registers its own worker under /onesignal/ (see
// public/onesignal/OneSignalSDKWorker.js), and push events, notification
// display, and clicks all live on that registration.
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
import { clientsClaim } from 'workbox-core'

// Mirror registerType: 'autoUpdate' — a new SW takes over immediately instead
// of waiting for every tab to close.
self.skipWaiting()
clientsClaim()

cleanupOutdatedCaches()
// Same-origin build output only; the Supabase and Clerk APIs are cross-origin
// and are never intercepted or cached here.
precacheAndRoute(self.__WB_MANIFEST)
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))
