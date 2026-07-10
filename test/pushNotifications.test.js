// Unit tests for the pure parts of the Web Push client: VAPID key decoding and
// the subscription→row mapping. The browser API orchestration is thin and
// guarded by feature detection (verified via the unsupported path below).
import { describe, it, expect } from 'vitest'
import {
  urlBase64ToUint8Array,
  toSubscriptionRow,
  isPushSupported,
  enablePushNotifications,
} from '../src/lib/pushNotifications'

describe('urlBase64ToUint8Array', () => {
  it('decodes plain base64', () => {
    expect(Array.from(urlBase64ToUint8Array('AQID'))).toEqual([1, 2, 3])
  })

  it('decodes the url-safe alphabet and re-pads', () => {
    // '-' → '+' (62) and '_' → '/' (63): 111110 111111 1111(00) → 0xFB 0xFF
    expect(Array.from(urlBase64ToUint8Array('-_8'))).toEqual([251, 255])
  })
})

describe('toSubscriptionRow', () => {
  const json = {
    endpoint: 'https://push.example.com/send/abc',
    keys: { p256dh: 'key-p256dh', auth: 'key-auth' },
  }

  it('maps a complete subscription to the row shape', () => {
    expect(toSubscriptionRow('user-1', json)).toEqual({
      user_id: 'user-1',
      endpoint: 'https://push.example.com/send/abc',
      p256dh: 'key-p256dh',
      auth: 'key-auth',
    })
  })

  it('returns null when any required field is missing', () => {
    expect(toSubscriptionRow('', json)).toBeNull()
    expect(toSubscriptionRow('user-1', { ...json, endpoint: undefined })).toBeNull()
    expect(toSubscriptionRow('user-1', { endpoint: json.endpoint, keys: { auth: 'a' } })).toBeNull()
    expect(toSubscriptionRow('user-1', { endpoint: json.endpoint })).toBeNull()
  })
})

describe('environment guards', () => {
  it('reports unsupported outside a push-capable browser', async () => {
    // Node test environment: no window/PushManager. The toggle must degrade to
    // a saved preference instead of throwing.
    expect(isPushSupported()).toBe(false)
    expect(await enablePushNotifications({ from: () => {} }, 'user-1')).toBe('unsupported')
  })
})
