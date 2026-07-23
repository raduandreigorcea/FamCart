import { describe, it, expect } from 'vitest'
import {
  normalizeMemberRole,
  sortMembersForDisplay,
  sortMembersForSwitcher,
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

describe('sortMembersForSwitcher', () => {
  const owner = { user_id: 'owner', role: 'moderator' }
  const mod = { user_id: 'mod', role: 'moderator' }
  const me = { user_id: 'me', role: 'member' }
  const member = { user_id: 'plain', role: 'member' }

  it('orders the current user first, then owner, then moderators, then members', () => {
    const sorted = sortMembersForSwitcher([member, mod, owner, me], 'owner', 'me')
    expect(sorted.map((m) => m.user_id)).toEqual(['me', 'owner', 'mod', 'plain'])
  })

  it('keeps the current user first even when they are the owner', () => {
    const sorted = sortMembersForSwitcher([mod, member, me], 'me', 'me')
    expect(sorted[0].user_id).toBe('me')
  })

  it('does not mutate the input array', () => {
    const input = [member, me]
    sortMembersForSwitcher(input, 'owner', 'me')
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
