// Custom service worker (vite-plugin-pwa injectManifest mode). Owns two jobs:
// the app-shell precache that generateSW used to emit, and Web Push handling —
// push events arrive here even when every FamCart tab is closed.
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

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { body: event.data ? event.data.text() : '' }
  }
  const title = payload.title || 'FamCart'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || 'Your family list changed.',
      icon: '/icons/pwa-192.png',
      badge: '/icons/pwa-192.png',
      // One collapsing notification per family: a burst of adds updates the
      // banner in place instead of stacking.
      tag: payload.tag || 'famcart',
      data: { url: payload.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => 'focus' in client)
      if (existing) return existing.focus()
      return self.clients.openWindow(url)
    }),
  )
})
