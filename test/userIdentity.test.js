import { describe, it, expect } from 'vitest'
import {
  getUserDisplayName,
  getUserPrimaryEmail,
  getUserInitial,
} from '../src/lib/userIdentity'

describe('getUserDisplayName', () => {
  it('prefers the full name', () => {
    expect(getUserDisplayName({ fullName: 'Ada Lovelace', firstName: 'Ada' })).toBe('Ada Lovelace')
  })

  it('falls back to the first name', () => {
    expect(getUserDisplayName({ fullName: null, firstName: 'Ada' })).toBe('Ada')
  })

  it.each([null, undefined, {}])('returns an empty string for %o', (user) => {
    expect(getUserDisplayName(user)).toBe('')
  })
})

describe('getUserPrimaryEmail', () => {
  it('prefers the primary email address', () => {
    const user = {
      primaryEmailAddress: { emailAddress: 'primary@example.com' },
      emailAddresses: [{ emailAddress: 'first@example.com' }],
    }
    expect(getUserPrimaryEmail(user)).toBe('primary@example.com')
  })

  it('falls back to the first listed address', () => {
    const user = { emailAddresses: [{ emailAddress: 'first@example.com' }] }
    expect(getUserPrimaryEmail(user)).toBe('first@example.com')
  })

  it.each([null, undefined, {}, { emailAddresses: [] }])('returns an empty string for %o', (user) => {
    expect(getUserPrimaryEmail(user)).toBe('')
  })
})

describe('getUserInitial', () => {
  it('uses the first letter of the display name, uppercased', () => {
    expect(getUserInitial({ fullName: 'ada lovelace' })).toBe('A')
  })

  it('falls back to the email when there is no name', () => {
    expect(getUserInitial({ emailAddresses: [{ emailAddress: 'zoe@example.com' }] })).toBe('Z')
  })

  it('returns ? when nothing is available', () => {
    expect(getUserInitial(null)).toBe('?')
  })
})
