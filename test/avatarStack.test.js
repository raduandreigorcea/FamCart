import { describe, it, expect } from 'vitest'
import {
  avatarSlotsForFamilyName,
  AVATAR_SLOTS_WIDE,
  AVATAR_SLOTS_NARROW,
  LONG_FAMILY_NAME_CHARS,
} from '../src/lib/avatarStack'

// Mirrors MemberAvatarStack's collapse rule, so these tests pin the circle
// counts the user actually sees rather than the slot number behind them.
const circlesFor = (memberCount, slots) =>
  memberCount <= slots + 1
    ? { avatars: memberCount, badge: 0 }
    : { avatars: slots, badge: memberCount - slots }

describe('avatarSlotsForFamilyName', () => {
  it('gives a short name the full stack', () => {
    expect(avatarSlotsForFamilyName('Home')).toBe(AVATAR_SLOTS_WIDE)
  })

  it('trims the stack once the name gets long', () => {
    expect(avatarSlotsForFamilyName('Radu si Cristina <3')).toBe(AVATAR_SLOTS_NARROW)
  })

  it('switches over exactly at the threshold', () => {
    const atLimit = 'x'.repeat(LONG_FAMILY_NAME_CHARS)
    expect(avatarSlotsForFamilyName(atLimit)).toBe(AVATAR_SLOTS_WIDE)
    expect(avatarSlotsForFamilyName(atLimit + 'x')).toBe(AVATAR_SLOTS_NARROW)
  })

  it('ignores surrounding whitespace and treats a missing name as short', () => {
    expect(avatarSlotsForFamilyName('   Home   ')).toBe(AVATAR_SLOTS_WIDE)
    expect(avatarSlotsForFamilyName('')).toBe(AVATAR_SLOTS_WIDE)
    expect(avatarSlotsForFamilyName(null)).toBe(AVATAR_SLOTS_WIDE)
    expect(avatarSlotsForFamilyName(undefined)).toBe(AVATAR_SLOTS_WIDE)
  })
})

describe('circles rendered for a short family name', () => {
  it('shows up to five, then collapses two or more into a badge', () => {
    const slots = avatarSlotsForFamilyName('Home')
    expect(circlesFor(4, slots)).toEqual({ avatars: 4, badge: 0 })
    expect(circlesFor(5, slots)).toEqual({ avatars: 5, badge: 0 })
    expect(circlesFor(6, slots)).toEqual({ avatars: 4, badge: 2 })
    expect(circlesFor(7, slots)).toEqual({ avatars: 4, badge: 3 })
  })
})

describe('circles rendered for a long family name', () => {
  it('shows all three at three members and two plus a "+2" at four', () => {
    const slots = avatarSlotsForFamilyName('Radu si Cristina <3')
    expect(circlesFor(3, slots)).toEqual({ avatars: 3, badge: 0 })
    expect(circlesFor(4, slots)).toEqual({ avatars: 2, badge: 2 })
    expect(circlesFor(5, slots)).toEqual({ avatars: 2, badge: 3 })
  })

  it('never renders a "+1"', () => {
    const slots = avatarSlotsForFamilyName('Radu si Cristina <3')
    for (let members = 1; members <= 8; members++) {
      expect(circlesFor(members, slots).badge).not.toBe(1)
    }
  })
})
