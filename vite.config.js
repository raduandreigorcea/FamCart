import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      // Ship SW updates automatically — no "new version, reload?" prompt to wire up.
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icons/*.png', 'screen.webp'],
      manifest: {
        name: 'FamCart — Family Shopping List',
        short_name: 'FamCart',
        description: 'A shared grocery list for your family, with live updates.',
        theme_color: '#4d8c65',
        background_color: '#f5f5f7',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell + brand assets so the list opens offline. Only
        // same-origin build output is precached; the Supabase and Clerk APIs are
        // cross-origin and are never intercepted or cached here.
        globPatterns: ['**/*.{js,css,html,svg,png,webp,ico,woff2}'],
        navigateFallback: '/index.html',
      },
    }),
  ],
})
