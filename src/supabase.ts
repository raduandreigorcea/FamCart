import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { useAuth } from '@clerk/vue'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// The product catalog is a THIRD Supabase project, separate from the production
// and development app databases and shared live by both. It holds the imported
// and curated reference rows and nothing that belongs to anybody; households,
// lists, history and household-contributed products stay in the app database.
// Its schema is NOT in this repo and never was: it belonged to the importer
// repo, the only thing that ever wrote that database, where this app only reads
// it. That repo has been deleted and the catalog project reset to bare
// catalog_admins, so RIGHT NOW there is no product_catalog and no
// search_catalog() on the other end of this client.
//
// This file needs no special case for that, because what it depends on is an
// API rather than a schema: search_catalog() and bump_product_popularity(),
// whose shapes are fixed elsewhere. Calls to a missing RPC reject, and
// productSuggestions.ts already treats a failed catalog leg as zero rows via
// Promise.allSettled. When a replacement pipeline recreates the RPCs this comes
// back on its own. Wire that project's pgTAP suite into this repo's CI again
// when it does: it is what turns a change to either RPC into a failed build
// rather than an empty suggestions dropdown.
//
// One Clerk session authenticates both, because the catalog project's
// Third-Party Auth integration names the same issuer. That is why the resolver
// below is shared rather than duplicated.
const catalogUrl = import.meta.env.VITE_CATALOG_SUPABASE_URL
const catalogAnonKey = import.meta.env.VITE_CATALOG_SUPABASE_ANON_KEY

let authClient: SupabaseClient | null = null
let catalogClient: SupabaseClient | null = null
let getTokenFn: (() => Promise<string | null>) | null = null

// Reads that die at the network layer are retried with a short backoff: after
// the machine sleeps, the first request often goes out on a dead keep-alive
// socket and fails without ever reaching Supabase (the browser reports this as
// a CORS error). HTTP responses — including 4xx/5xx — are never retried, and
// neither are mutations: a POST whose response was lost may already have been
// applied, so replaying it could double-apply.
const RETRY_DELAYS_MS = [250, 750]

export async function fetchWithRetry(
  url: RequestInfo | URL,
  options: RequestInit = {},
): Promise<Response> {
  const method = (options.method || 'GET').toUpperCase()
  const retriable = method === 'GET' || method === 'HEAD'
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, options)
    } catch (error) {
      const aborted =
        options.signal?.aborted || (error as { name?: string })?.name === 'AbortError'
      if (!retriable || aborted || attempt >= RETRY_DELAYS_MS.length) throw error
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]))
    }
  }
}

// There was an unauthenticated `supabase` client exported here for
// "public/unauthenticated queries". Nothing ever imported it — every table is
// behind RLS and every read needs a Clerk token — but being at module scope it
// was constructed on any page that imported this file, for nobody.

// The one client, built once and shared. The token comes from whatever resolver
// was last installed, so the client itself never needs rebuilding when the
// session changes.
export function getSupabase(): SupabaseClient {
  if (!authClient) {
    authClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      // Single source of auth: supabase-js resolves this callback once per
      // request (REST and realtime setAuth) and attaches the Authorization
      // header itself — no custom header wiring, no second token fetch.
      accessToken: async () => (getTokenFn ? await getTokenFn() : null),
      global: {
        fetch: fetchWithRetry,
      },
    })
  }
  return authClient
}

// The catalog project's client, or null where it is not configured.
//
// Null is a supported state, not a broken one. It is what a checkout with no
// VITE_CATALOG_* variables gets, and every caller treats a missing catalog the
// same way it treats a failed catalog request: the household's own products
// still appear and the add-item box still works. Suggestions are a convenience,
// and a third project being unreachable must not be able to empty the dropdown.
export function getCatalogSupabase(): SupabaseClient | null {
  if (!catalogUrl || !catalogAnonKey) return null
  if (!catalogClient) {
    catalogClient = createClient(catalogUrl, catalogAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      // The same resolver the app client uses, deliberately. Two clients, one
      // session: the token Clerk issued verifies against both projects because
      // both name the same issuer in their Third-Party Auth settings.
      accessToken: async () => (getTokenFn ? await getTokenFn() : null),
      global: {
        fetch: fetchWithRetry,
      },
    })
  }
  return catalogClient
}

// How the client learns to mint tokens. Kept separate from getSupabase because
// the two have different requirements: this needs Clerk's useAuth() and so a
// component context, while the client is wanted from places that have none —
// the router guard in particular, which used to hand-roll its own fetch with
// its own apikey/Authorization headers (and no fetchWithRetry) purely to work
// around that.
export function setSupabaseTokenResolver(resolve: () => Promise<string | null>): void {
  getTokenFn = resolve
}

// Returns a Supabase client authenticated with the current Clerk session token.
// Use this inside Vue components/composables where useAuth() is available.
export function useSupabase(): SupabaseClient {
  const { getToken } = useAuth()
  // The plain session token, NOT getToken({ template: 'supabase' }).
  //
  // All three projects authenticate through Supabase's native Third-Party Auth,
  // which verifies a Clerk session token against Clerk's JWKS directly. The
  // `supabase` JWT template is the older integration and cost two things for no
  // benefit: a template token carries nbf = iat - 5 against the session token's
  // nbf = iat - 10, halving the clock tolerance before a request is refused as
  // `JWT not yet valid`; and it is minted by a separate call to Clerk's API on
  // every resolve, where the session token is already in memory.
  //
  // Verified against all three projects before the change: each one accepts the
  // session token and answers is_admin()/catalog_is_admin() with it.
  setSupabaseTokenResolver(async () => getToken.value())
  return getSupabase()
}
