import { describe, it, expect } from 'vitest'
import {
  normalizeMemberRole,
  sortMembersForDisplay,
  canManageMember,
  canPromoteToModerator,
  canDemoteFromModerator,
} from '../src/lib/memberRoles'

describe('normalizeMemberRole', () => {
  it('maps the legacy admin rank to moderator', () => {
    expect(normalizeMemberRole('admin')).toBe('moderator')
  })

  it('keeps moderator as moderator', () => {
    expect(normalizeMemberRole('moderator')).toBe('moderator')
  })

  it.each(['member', 'owner', '', null, undefined, 'MODERATOR'])(
    'treats %o as member',
    (role) => {
      expect(normalizeMemberRole(role)).toBe('member')
    },
  )
})

describe('sortMembersForDisplay', () => {
  const owner = { user_id: 'owner', role: 'member' }
  const mod = { user_id: 'mod', role: 'moderator' }
  const legacyMod = { user_id: 'legacy', role: 'admin' }
  const member = { user_id: 'plain', role: 'member' }

  it('orders owner, then moderators, then members', () => {
    const sorted = sortMembersForDisplay([member, legacyMod, owner, mod], 'owner')
    expect(sorted.map((m) => m.user_id)).toEqual(['owner', 'legacy', 'mod', 'plain'])
  })

  it('does not mutate the input array', () => {
    const input = [member, owner]
    sortMembersForDisplay(input, 'owner')
    expect(input[0]).toBe(member)
  })
})

describe('canManageMember', () => {
  const ctx = { actorIsOwnerOrModerator: true, ownerUserId: 'owner', actorUserId: 'me' }

  it('allows managing a regular member', () => {
    expect(canManageMember({ user_id: 'other' }, ctx)).toBe(true)
  })

  it('never allows managing the owner', () => {
    expect(canManageMember({ user_id: 'owner' }, ctx)).toBe(false)
  })

  it('never allows managing yourself', () => {
    expect(canManageMember({ user_id: 'me' }, ctx)).toBe(false)
  })

  it('requires the actor to be owner or moderator', () => {
    expect(canManageMember({ user_id: 'other' }, { ...ctx, actorIsOwnerOrModerator: false })).toBe(false)
  })
})

describe('promotion and demotion', () => {
  it('only the owner can promote, and only non-moderators', () => {
    expect(canPromoteToModerator({ user_id: 'x', role: 'member' }, true)).toBe(true)
    expect(canPromoteToModerator({ user_id: 'x', role: 'moderator' }, true)).toBe(false)
    expect(canPromoteToModerator({ user_id: 'x', role: 'member' }, false)).toBe(false)
  })

  it('only the owner can demote, and only moderators (including legacy admin)', () => {
    expect(canDemoteFromModerator({ user_id: 'x', role: 'moderator' }, true)).toBe(true)
    expect(canDemoteFromModerator({ user_id: 'x', role: 'admin' }, true)).toBe(true)
    expect(canDemoteFromModerator({ user_id: 'x', role: 'member' }, true)).toBe(false)
    expect(canDemoteFromModerator({ user_id: 'x', role: 'moderator' }, false)).toBe(false)
  })
})
