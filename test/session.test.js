import { describe, it, expect, beforeEach } from 'vitest'
import { rememberUser, getRememberedUser, forgetUser } from '../src/lib/session'

// A minimal in-memory Storage stand-in.
function makeStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  }
}

describe('session', () => {
  let storage
  beforeEach(() => { storage = makeStorage() })

  it('returns null when no user has been remembered', () => {
    expect(getRememberedUser(storage)).toBe(null)
  })

  it('remembers and reads back the last signed-in user', () => {
    rememberUser(storage, 'user-abc')
    expect(getRememberedUser(storage)).toBe('user-abc')
  })

  it('forgets the user on sign-out', () => {
    rememberUser(storage, 'user-abc')
    forgetUser(storage)
    expect(getRememberedUser(storage)).toBe(null)
  })

  it('never throws when storage is unavailable', () => {
    const broken = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    }
    expect(() => rememberUser(broken, 'x')).not.toThrow()
    expect(getRememberedUser(broken)).toBe(null)
    expect(() => forgetUser(broken)).not.toThrow()
  })
})
