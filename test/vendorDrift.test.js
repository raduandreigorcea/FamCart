// The FamCart half of the importer's vendoring guard.
//
// tools/catalog-importer is a separate repo (a submodule) that carries
// byte-for-byte copies of src/lib/productSearch.ts and src/lib/productEmoji.ts,
// because it has to work as a standalone clone too.
//
// This test is the one that fires at the moment of the edit: change either
// module here and it fails immediately, rather than the drift being discovered
// later by an import that collapses a different set of products than
// product_search_text() does.
//
// Skipped entirely when the submodule is not checked out, so a plain
// `git clone` without --recurse-submodules still goes green.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const lf = (text) => text.replace(/\r\n/g, '\n')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const vendorDir = join(root, 'tools', 'catalog-importer', 'src', 'vendor')
const metaPath = join(vendorDir, 'vendor.meta.json')
const haveImporter = existsSync(metaPath)

describe.skipIf(!haveImporter)('the catalog importer vendors these modules unchanged', () => {
  const meta = haveImporter ? JSON.parse(readFileSync(metaPath, 'utf8')) : { files: {} }

  for (const [name, entry] of Object.entries(meta.files)) {
    it(`${entry.upstream} matches the importer's copy`, () => {
      // If this fails you edited one side only. Re-copy the file into
      // tools/catalog-importer/src/vendor/ and update the sha256 in
      // vendor.meta.json -- never patch the vendored copy by hand.
      //
      // CR is stripped first: core.autocrlf=true gives a CRLF working copy on
      // Windows and LF on a Linux runner, and git stores LF either way, so raw
      // bytes would differ across platforms while the content is identical.
      expect(lf(readFileSync(join(vendorDir, name), 'utf8'))).toBe(
        lf(readFileSync(join(root, entry.upstream), 'utf8')),
      )
    })
  }
})
