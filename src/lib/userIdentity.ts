// Minimal structural view of a Clerk user, so lib stays free of @clerk imports.
export interface UserLike {
  fullName?: string | null
  firstName?: string | null
  primaryEmailAddress?: { emailAddress?: string | null } | null
  emailAddresses?: ReadonlyArray<{ emailAddress?: string | null }> | null
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
