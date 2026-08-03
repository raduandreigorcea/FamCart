// Seeds public.product_catalog from scripts/products.json.
//
// Usage:
//   npm run seed:products
//
// Needs two values, read from the env files below (or the real environment):
//   VITE_SUPABASE_URL          - from .env, alongside the other client config.
//   SUPABASE_SERVICE_ROLE_KEY  - from .env.scripts. Supabase dashboard >
//     Project Settings > API.
//
// The two live in separate files on purpose. Vite loads .env and ships every
// VITE_-prefixed key to the browser, so a service-role key sitting there is one
// typo away from publishing RLS-bypassing access to the whole database. Vite
// never loads .env.scripts, so the mistake is impossible rather than unlikely.
//
// Re-running is safe: rows are upserted on (name, maker, family_id), so edits to
// products.json update existing rows instead of duplicating them, and products
// families contributed themselves (family_id not null) are left untouched.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

// Either file may be absent (CI, or a machine running off the real
// environment); a missing one is not an error, a missing *value* is.
for (const file of ['.env', '.env.scripts']) {
  try {
    process.loadEnvFile(path.join(root, file))
  } catch {
    // Not present — fall back to the real environment for this file's values.
  }
}

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error(
    'Missing configuration. Set VITE_SUPABASE_URL (or SUPABASE_URL) in .env ' +
      'and SUPABASE_SERVICE_ROLE_KEY in .env.scripts (or the environment).',
  )
  process.exit(1)
}

// Must match what the app does to the typed input before matching, so
// "apa" and "apă" both hit "Apa Plata 2L Dorna". NFD splits letters from
// their accents, then the accent marks are dropped.
function normalizeForSearch(text) {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const dataPath = path.join(root, 'scripts', 'products.json')
const products = JSON.parse(readFileSync(dataPath, 'utf8'))

if (!Array.isArray(products)) {
  console.error('products.json must be a JSON array of { name, maker? } objects.')
  process.exit(1)
}

const seen = new Set()
const seenSearch = new Set()
const rows = []
for (const [i, product] of products.entries()) {
  const name = typeof product.name === 'string' ? product.name.trim() : ''
  const maker =
    typeof product.maker === 'string' && product.maker.trim() ? product.maker.trim() : null

  if (!name || name.length > 120) {
    console.error(`products.json entry ${i}: "name" must be 1-120 characters.`)
    process.exit(1)
  }
  if (maker && maker.length > 60) {
    console.error(`products.json entry ${i} ("${name}"): "maker" must be at most 60 characters.`)
    process.exit(1)
  }

  // Optional editorial baseline for suggestion ranking. This is the cold-start
  // signal — it decides ordering before any real usage accrues. The upsert only
  // sets base_weight, never add_count, so re-seeding cannot wipe the usage
  // counts the bump RPC has earned (see 006_product_catalog.sql).
  //
  // The default is 10, not 0, and that matters now that the catalog is also fed
  // by tools/catalog-importer. Imported products land in a band of 1-9 (see
  // importedBaseWeight there), deliberately just under an ordinary curated
  // product. A curated entry left at 0 would rank BELOW every imported row —
  // hand-picked "Telemea de Oaie" losing to a random imported yoghurt. Anything
  // worth curating is worth at least the ordinary baseline, so the scale is now
  // two bands: 100 for a staple, 10 for everything else curated.
  const weight = product.weight ?? 10
  if (!Number.isInteger(weight) || weight < 0 || weight > 1000000) {
    console.error(`products.json entry ${i} ("${name}"): "weight" must be an integer 0-1000000.`)
    process.exit(1)
  }

  // A single upsert cannot touch the same (name, maker) row twice.
  const key = `${name}\u0000${maker ?? ''}`
  if (seen.has(key)) {
    console.warn(`Skipping duplicate entry: ${name}${maker ? ` (${maker})` : ''}`)
    continue
  }
  seen.add(key)

  // The DB enforces one global row per search_text (product_catalog_global_search,
  // 006_product_catalog.sql), and the upsert's (name, maker, family_id) conflict target does
  // NOT catch a collision there — two entries that differ only in case, accents, or
  // spacing normalize to the same key and the second would fail the whole chunk.
  // Skip it here, keeping the first (higher-priority) spelling, the same way an
  // exact duplicate is skipped above.
  const searchText = normalizeForSearch(maker ? `${name} ${maker}` : name)
  if (seenSearch.has(searchText)) {
    console.warn(
      `Skipping "${name}${maker ? ` (${maker})` : ''}": normalizes to "${searchText}", ` +
        'already seeded by an earlier entry.',
    )
    continue
  }
  seenSearch.add(searchText)

  rows.push({
    name,
    maker,
    search_text: searchText,
    base_weight: weight,
    // Seeded products are the global ones. A non-null family_id means a product
    // one family contributed via add_custom_product() (006_product_catalog.sql), which the
    // seed must never create or overwrite.
    family_id: null,
    // Provenance (006_product_catalog.sql). Stamping it here is what protects these rows:
    // import_catalog_products() refuses to change the name, maker or weight of
    // any row whose source is not its own, so a curated product can only ever
    // gain the upstream barcode from an import, never be rewritten by one.
    source: 'curated',
  })
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const CHUNK_SIZE = 500
let seeded = 0
for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
  const chunk = rows.slice(start, start + CHUNK_SIZE)
  const { error } = await supabase
    .from('product_catalog')
    .upsert(chunk, { onConflict: 'name,maker,family_id' })
  if (error) {
    console.error(`Seeding failed after ${seeded} rows: ${error.message}`)
    process.exit(1)
  }
  seeded += chunk.length
}

console.log(`Seeded ${seeded} products into product_catalog.`)
