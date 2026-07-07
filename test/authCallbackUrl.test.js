import { describe, it, expect } from 'vitest'
import { cleanAuthCallbackUrl } from '../src/lib/authCallbackUrl'

describe('cleanAuthCallbackUrl', () => {
  it('returns null when the URL is already clean', () => {
    expect(cleanAuthCallbackUrl('https://app.test/home?foo=1#top')).toBeNull()
  })

  it('strips __clerk_ params and keeps the rest', () => {
    expect(cleanAuthCallbackUrl('https://app.test/home?__clerk_status=verified&foo=1'))
      .toBe('/home?foo=1')
  })

  it('drops the query string entirely when only __clerk_ params were present', () => {
    expect(cleanAuthCallbackUrl('https://app.test/home?__clerk_db_jwt=abc')).toBe('/home')
  })

  it('collapses duplicate leading slashes in the path', () => {
    expect(cleanAuthCallbackUrl('https://app.test//home')).toBe('/home')
  })

  it('preserves the hash fragment', () => {
    expect(cleanAuthCallbackUrl('https://app.test//home?__clerk_x=1#section')).toBe('/home#section')
  })
})
