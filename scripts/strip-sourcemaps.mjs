// Guarantees no source map ships, whatever emitted it.
//
// vite.config.js already asks the Sentry plugin to clean up after itself
// (`filesToDeleteAfterUpload: 'dist/**/*.map'`), and for the main bundle it
// does. But that sweep runs at the end of the MAIN build, and vite-plugin-pwa
// builds the service worker in a second pass afterwards — so dist/sw.js.map
// survived it and was deployed on every production build. 142KB of map for the
// 23 lines of src/sw.js: not a serious disclosure, but the mechanism is the
// problem. Anything emitted after the Sentry plugin finishes is missed by it,
// silently, and the next thing added to the build pipeline would be missed too.
//
// Deliberately a post-build script rather than another Vite plugin. A plugin
// would have to run after vite-plugin-pwa's closeBundle but *before* nothing —
// and getting that wrong in the other direction (running before Sentry's
// upload) would delete the maps Sentry needs and break symbolication with no
// error. `vite build` finishing is the one moment with no ordering question.
//
// Runs unconditionally: builds without a Sentry token emit no maps at all, so
// this finds nothing and costs a directory walk.
import fs from 'node:fs'
import path from 'node:path'

const DIST = 'dist'

if (!fs.existsSync(DIST)) {
  console.error(`strip-sourcemaps: no ${DIST}/ directory — nothing to do.`)
  process.exit(0)
}

const removed = []
for (const entry of fs.readdirSync(DIST, { recursive: true })) {
  // `recursive: true` yields Buffers when the encoding is not a string, and
  // relative paths otherwise; this call gets strings.
  if (typeof entry !== 'string' || !entry.endsWith('.map')) continue
  const file = path.join(DIST, entry)
  fs.rmSync(file, { force: true })
  removed.push(file)
}

if (removed.length) {
  console.log(`strip-sourcemaps: removed ${removed.length} map(s): ${removed.join(', ')}`)
}
