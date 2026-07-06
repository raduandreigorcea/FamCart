import { defineConfig } from 'vitest/config'

// Separate from vite.config.js so the PWA plugin doesn't run during unit tests.
// These tests cover pure logic only, so no Vue/browser environment is needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.{test,spec}.{js,ts}'],
  },
})
