import type { SupabaseClient } from '@supabase/supabase-js'

export function setSupabaseAccessTokenGetter(
	getter: (() => Promise<string | null>) | null | undefined,
): void

export const supabase: SupabaseClient