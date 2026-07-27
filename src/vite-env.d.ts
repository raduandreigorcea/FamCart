/// <reference types="vite/client" />

// Injected by the bundler from package.json (see the `define` in
// vite.config.js, mirrored in vitest.config.js). Not an env var and not
// available at runtime -- it is replaced with a literal at build time.
declare const __APP_VERSION__: string

// Lets plain `tsc` typecheck .ts files that import Vue SFCs. The SFCs
// themselves are still JS; switch to vue-tsc for real component typing.
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}
