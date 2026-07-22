// Minimal structural view of a Clerk user, so lib stays free of @clerk imports.
export interface UserLike {
  fullName?: string | null
  firstName?: string | null
  imageUrl?: string | null
  primaryEmailAddress?: { emailAddress?: string | null } | null
  emailAddresses?: ReadonlyArray<{ emailAddress?: string | null }> | null
}

// The two identity fields the profiles table stores, derived from a Clerk user.
// The one authority the client uses for both the create/join writes and the
// keep-fresh upsert, so they can never disagree. Mirrors the clamping the DB
// applies (migrations 020/026): name capped at 80 chars, avatar https-only.
export interface ProfileFields {
  display_name: string
  image_url: string | null
}

export function deriveProfileFields(user: UserLike | null | undefined): ProfileFields {
  const name = getUserDisplayName(user) || getUserPrimaryEmail(user) || 'Member'
  const raw = user?.imageUrl || null
  const image_url = raw && /^https:\/\//.test(raw) && raw.length <= 2048 ? raw : null
  return { display_name: name.slice(0, 80), image_url }
}

export function getUserDisplayName(user: UserLike | null | undefined): string {
  return user?.fullName || user?.firstName || ''
}

export function getUserPrimaryEmail(user: UserLike | null | undefined): string {
  return (
    user?.primaryEmailAddress?.emailAddress
    || user?.emailAddresses?.[0]?.emailAddress
    || ''
  )
}

export function getUserInitial(user: UserLike | null | undefined): string {
  const name = getUserDisplayName(user) || getUserPrimaryEmail(user) || '?'
  return name.slice(0, 1).toUpperCase()
}
