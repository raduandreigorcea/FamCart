/// <reference types="vite/client" />

// Injected by the bundler from package.json (see the `define` in
// vite.config.js, mirrored in vitest.config.js). Not an env var and not
// available at runtime -- it is replaced with a literal at build time.
declare const __APP_VERSION__: string

// There was a `declare module '*.vue'` shim here, for a time when the SFCs were
// plain JS and plain `tsc` needed something to import. Both halves of that are
// gone: every SFC declares lang="ts", and `npm run typecheck` is vue-tsc, which
// resolves .vue files properly and checks props, emits and templates against
// their real types. The shim was inert — verified by checking that a deliberate
// prop type error is still caught with it removed — but it described the project
// as it has not been for a while, and it is exactly the declaration that would
// silently reduce every component to `any` if resolution ever fell back to it.
