import type { SupabaseClient } from '@supabase/supabase-js'
import { deriveProfileFields, type UserLike } from './userIdentity'

// Write the caller's own profiles row (name + Clerk avatar), the single source
// of truth every roster and list-item avatar now reads from. Called on the
// create-family path (the FK target must exist before the membership insert) and
// once per app load, so a changed Clerk photo propagates everywhere. Best-effort
// on load: a failure here must never block the dashboard, so callers ignore the
// returned error there.
export async function upsertOwnProfile(
  db: SupabaseClient,
  userId: string,
  user: UserLike | null | undefined,
) {
  const fields = deriveProfileFields(user)
  return db
    .from('profiles')
    .upsert(
      { user_id: userId, ...fields, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
}
