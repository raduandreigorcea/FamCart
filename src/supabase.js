import { createClient } from '@supabase/supabase-js'
import { useAuth } from '@clerk/vue'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
let authClient = null
let getTokenFn = null

// Base client (no auth) — for public/unauthenticated queries.
// Disable auth persistence so this client does not compete with the authenticated one.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
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
      accessToken: async () => {
        const token = getTokenFn ? await getTokenFn() : null
        return token
      },
      global: {
        fetch: async (url, options = {}) => {
          const token = getTokenFn ? await getTokenFn() : null
          const headers = new Headers(options.headers)
          if (token) headers.set('Authorization', `Bearer ${token}`)
          return fetch(url, { ...options, headers })
        },
      },
    })
  }

  return authClient
}
