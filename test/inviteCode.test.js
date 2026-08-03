// The invite code is the only credential guarding family membership, and it was
// duplicated across two components before it lived here. These pin the two
// properties that make it worth anything: it is unguessable, and it always
// passes the check the join form applies to it.
import { describe, it, expect } from 'vitest'
import {
  INVITE_CODE_LENGTH,
  isValidInviteCode,
  normalizeInviteCode,
  randomInviteCode,
} from '../src/lib/inviteCode'

describe('randomInviteCode', () => {
  it('produces a code the join form accepts', () => {
    for (let i = 0; i < 200; i++) {
      const code = randomInviteCode()
      expect(code).toHaveLength(INVITE_CODE_LENGTH)
      expect(isValidInviteCode(code)).toBe(true)
    }
  })

  it('never emits the characters that get misread aloud', () => {
    // I/O/0/1 are excluded on purpose: codes are read out and typed by hand.
    const codes = Array.from({ length: 300 }, () => randomInviteCode()).join('')
    expect(codes).not.toMatch(/[IO01]/)
  })

  it('draws from the whole alphabet without modulo bias', () => {
    // 32 characters divide 256 evenly, so every character should appear at a
    // comparable rate. With 2000 codes (16k characters) each of the 32 has an
    // expected count of ~500; a biased mapping would leave some at zero or
    // roughly double others.
    const counts = new Map()
    for (let i = 0; i < 2000; i++) {
      for (const ch of randomInviteCode()) counts.set(ch, (counts.get(ch) ?? 0) + 1)
    }

    expect(counts.size).toBe(32)
    const frequencies = [...counts.values()]
    expect(Math.min(...frequencies)).toBeGreaterThan(250)
    expect(Math.max(...frequencies)).toBeLessThan(1000)
  })

  it('does not repeat itself', () => {
    const codes = new Set(Array.from({ length: 500 }, () => randomInviteCode()))
    // 32^8 is ~1.1e12, so 500 draws colliding would mean the entropy is fake.
    expect(codes.size).toBe(500)
  })
})

describe('reading a code someone typed', () => {
  it('accepts a lowercase, padded paste', () => {
    expect(normalizeInviteCode('  abcd2345 ')).toBe('ABCD2345')
    expect(isValidInviteCode(normalizeInviteCode('  abcd2345 '))).toBe(true)
  })

  it('rejects the wrong length, the excluded characters, and punctuation', () => {
    expect(isValidInviteCode('ABCD234')).toBe(false)
    expect(isValidInviteCode('ABCD23456')).toBe(false)
    expect(isValidInviteCode('ABCD234O')).toBe(false)
    expect(isValidInviteCode('ABCD2341')).toBe(false)
    expect(isValidInviteCode('ABCD-234')).toBe(false)
    expect(isValidInviteCode('')).toBe(false)
  })
})
