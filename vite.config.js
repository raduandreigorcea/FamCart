import fs from 'node:fs'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { sentryVitePlugin } from '@sentry/vite-plugin'

// Source maps are built and uploaded to Sentry only when an auth token is
// available: locally via .env.sentry-build-plugin (auto-read by the plugin),
// in CI/hosting via the SENTRY_AUTH_TOKEN env var. Builds without a token are
// completely unaffected.
const uploadSourceMaps = !!process.env.SENTRY_AUTH_TOKEN || fs.existsSync('.env.sentry-build-plugin')

// https://vite.dev/config/
export default defineConfig({
  build: {
    // 'hidden' emits the maps for upload without adding sourceMappingURL
    // comments to the bundles; the maps are deleted after upload so they are
    // never deployed or precached.
    sourcemap: uploadSourceMaps ? 'hidden' : false,
  },
  plugins: [
    vue(),
    VitePWA({
      // Custom SW (src/sw.js): precaching plus the Web Push handlers that
      // generateSW cannot express. skipWaiting/clientsClaim in the SW mirror
      // the autoUpdate behavior.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
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
      injectManifest: {
        // Precache the app shell + brand assets so the list opens offline; the
        // navigation fallback lives in src/sw.js (NavigationRoute).
        globPatterns: ['**/*.{js,css,html,svg,png,webp,ico,woff2}'],
      },
    }),
    uploadSourceMaps &&
      sentryVitePlugin({
        org: 'famcart',
        project: 'javascript-vue',
        sourcemaps: { filesToDeleteAfterUpload: 'dist/**/*.map' },
      }),
  ],
})
