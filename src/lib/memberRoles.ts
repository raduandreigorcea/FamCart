// Pure role/permission rules for family members. Free of Vue and Supabase so
// they can be unit-tested; components decide presentation, these decide policy.

export type NormalizedRole = 'moderator' | 'member'

export interface MemberLike {
  user_id: string
  role?: string | null
}

// Legacy rows may carry 'admin' (pre-rename of the moderator rank); anything
// unrecognized is a plain member.
export function normalizeMemberRole(role: string | null | undefined): NormalizedRole {
  if (role === 'admin') return 'moderator'
  return role === 'moderator' ? 'moderator' : 'member'
}

// Owner first, then moderators, then members; otherwise keeps incoming order.
export function sortMembersForDisplay<T extends MemberLike>(
  members: T[],
  ownerUserId: string,
): T[] {
  return [...members].sort((a, b) => {
    if (a.user_id === ownerUserId) return -1
    if (b.user_id === ownerUserId) return 1
    const roleA = normalizeMemberRole(a.role)
    const roleB = normalizeMemberRole(b.role)
    if (roleA === 'moderator' && roleB !== 'moderator') return -1
    if (roleB === 'moderator' && roleA !== 'moderator') return 1
    return 0
  })
}

export interface ManageContext {
  actorIsOwnerOrModerator: boolean
  ownerUserId: string
  actorUserId: string
}

// Owners and moderators can manage anyone except the owner and themselves.
export function canManageMember(member: MemberLike, ctx: ManageContext): boolean {
  if (!ctx.actorIsOwnerOrModerator) return false
  if (member.user_id === ctx.ownerUserId) return false
  if (member.user_id === ctx.actorUserId) return false
  return true
}

// Only the owner grants or revokes the moderator rank.
export function canPromoteToModerator(member: MemberLike, actorIsOwner: boolean): boolean {
  return actorIsOwner && normalizeMemberRole(member.role) !== 'moderator'
}

export function canDemoteFromModerator(member: MemberLike, actorIsOwner: boolean): boolean {
  return actorIsOwner && normalizeMemberRole(member.role) === 'moderator'
}
