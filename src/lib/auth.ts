import { useUser } from '@clerk/vue'
import type { UserResource } from '@clerk/shared/types'

export function useAuth() {
  return useUser()
}

export function getUserDisplayName(user: UserResource | null | undefined) {
  if (!user) return null

  return user.fullName?.trim()
    || [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
    || user.primaryEmailAddress?.emailAddress?.trim()
    || null
}

export function getUserAvatarUrl(user: UserResource | null | undefined) {
  if (!user?.imageUrl) return null
  return user.imageUrl
}