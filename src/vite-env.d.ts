/// <reference types="vite/client" />

// Lets plain `tsc` typecheck .ts files that import Vue SFCs. The SFCs
// themselves are still JS; switch to vue-tsc for real component typing.
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}
