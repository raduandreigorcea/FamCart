import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

let accessTokenGetter = async () => null

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to the .env file')
}

export function setSupabaseAccessTokenGetter(getter) {
  accessTokenGetter = getter || (async () => null)
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  async accessToken() {
    return await accessTokenGetter()
  },
})