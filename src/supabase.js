import { createClient } from '@supabase/supabase-js'
import { useAuth } from '@clerk/vue'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
let authClient = null
let getTokenFn = null

// Reads that die at the network layer are retried with a short backoff: after
// the machine sleeps, the first request often goes out on a dead keep-alive
// socket and fails without ever reaching Supabase (the browser reports this as
// a CORS error). HTTP responses — including 4xx/5xx — are never retried, and
// neither are mutations: a POST whose response was lost may already have been
// applied, so replaying it could double-apply.
const RETRY_DELAYS_MS = [250, 750]

export async function fetchWithRetry(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  const retriable = method === 'GET' || method === 'HEAD'
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, options)
    } catch (error) {
      const aborted = options.signal?.aborted || error?.name === 'AbortError'
      if (!retriable || aborted || attempt >= RETRY_DELAYS_MS.length) throw error
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]))
    }
  }
}

// Base client (no auth) — for public/unauthenticated queries.
// Disable auth persistence so this client does not compete with the authenticated one.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  global: {
    fetch: fetchWithRetry,
  },
})

// Returns a Supabase client authenticated with the current Clerk session token.
// Use this inside Vue components/composables where useAuth() is available.
export function useSupabase() {
  const { getToken } = useAuth()
  getTokenFn = async () => getToken.value({ template: 'supabase' })

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
