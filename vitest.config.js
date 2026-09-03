import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// Mirrors the define in vite.config.js. Without it every component that shows
// the version throws "__APP_VERSION__ is not defined" under test, since the
// constant is injected by the bundler rather than existing at runtime.
const appVersion = JSON.parse(fs.readFileSync('./package.json', 'utf8')).version

// Separate from vite.config.js so the PWA plugin doesn't run during unit tests.
// Pure-logic tests run in the default node environment; component tests opt in
// to happy-dom with a `// @vitest-environment happy-dom` docblock per file.
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [vue()],
  resolve: {
    // Templates reference public-dir assets by absolute URL (e.g.
    // /icons/pwa-192.png); dev/build serve them from public/, but the test
    // runner has no server, so point the imports at the files directly.
    alias: [{ find: /^\/icons\//, replacement: fileURLToPath(new URL('./public/icons/', import.meta.url)) }],
  },
  test: {
    // The suite describes the shipped app, so it runs as the production
    // channel. Without this it would run as nightly, because lib/appChannel
    // treats DEV as nightly and vitest sets it -- which would quietly flip the
    // version string, the update check and the OAuth scheme under every test
    // that never mentions channels. Cases that want nightly mock IS_NIGHTLY.
    env: {
      VITE_APP_CHANNEL: 'production',
    },
    environment: 'node',
    include: ['test/**/*.{test,spec}.{js,ts}'],
  },
})
