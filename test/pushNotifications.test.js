// Tests for the OneSignal-backed push client. The web SDK is faked by draining
// the window.OneSignalDeferred queue the module pushes its commands into — the
// same contract the real CDN script fulfils when it loads.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isPushSupported,
  enablePushNotifications,
  disablePushNotifications,
  getNotificationPreference,
  setNotificationPreference,
} from '../src/lib/pushNotifications'

function fakeSdk({ permission = 'granted' } = {}) {
  const sdk = {
    init: vi.fn(async () => {}),
    login: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    User: {
      PushSubscription: {
        optIn: vi.fn(async () => {}),
        optOut: vi.fn(async () => {}),
      },
    },
  }
  vi.stubGlobal('Notification', { permission })
  return sdk
}

// A window/navigator pair that passes isPushSupported()'s feature checks.
function stubPushCapableBrowser() {
  const win = { PushManager: function () {}, Notification: function () {}, OneSignalDeferred: [] }
  vi.stubGlobal('window', win)
  vi.stubGlobal('navigator', { serviceWorker: {} })
  return win
}

// Resolve the module's queued SDK commands the way the loaded script would.
function drainDeferred(win, sdk) {
  while (win.OneSignalDeferred.length) win.OneSignalDeferred.shift()(sdk)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('environment guards', () => {
  it('reports unsupported outside a push-capable browser', async () => {
    // Node test environment: no PushManager. The toggle must degrade to a
    // saved preference instead of throwing.
    expect(isPushSupported()).toBe(false)
    expect(await enablePushNotifications('user-1')).toBe('unsupported')
  })

  it('reports not-configured when no OneSignal app id is set', async () => {
    // Force-empty: vitest loads .env, which carries the real app id.
    vi.stubEnv('VITE_ONESIGNAL_APP_ID', '')
    stubPushCapableBrowser()
    expect(await enablePushNotifications('user-1')).toBe('not-configured')
  })

  it('rejects an empty user id before touching any SDK', async () => {
    expect(await enablePushNotifications('')).toBe('error')
  })
})

describe('web enable via OneSignal', () => {
  it('logs in with the user id, opts in, and reports subscribed', async () => {
    vi.stubEnv('VITE_ONESIGNAL_APP_ID', 'app-123')
    const win = stubPushCapableBrowser()
    const sdk = fakeSdk({ permission: 'granted' })

    const pending = enablePushNotifications('user-1')
    drainDeferred(win, sdk)

    expect(await pending).toBe('subscribed')
    expect(sdk.login).toHaveBeenCalledWith('user-1')
    expect(sdk.User.PushSubscription.optIn).toHaveBeenCalled()
  })

  it('reports permission-denied when the browser refuses', async () => {
    vi.stubEnv('VITE_ONESIGNAL_APP_ID', 'app-123')
    const win = stubPushCapableBrowser()
    const sdk = fakeSdk({ permission: 'denied' })

    const pending = enablePushNotifications('user-1')
    drainDeferred(win, sdk)

    expect(await pending).toBe('permission-denied')
  })

  it('reports error when the SDK throws for a non-permission reason', async () => {
    vi.stubEnv('VITE_ONESIGNAL_APP_ID', 'app-123')
    const win = stubPushCapableBrowser()
    const sdk = fakeSdk({ permission: 'granted' })
    sdk.User.PushSubscription.optIn.mockRejectedValue(new Error('boom'))

    const pending = enablePushNotifications('user-1')
    drainDeferred(win, sdk)

    expect(await pending).toBe('error')
  })
})

describe('disable', () => {
  it('opts the web subscription out', async () => {
    vi.stubEnv('VITE_ONESIGNAL_APP_ID', 'app-123')
    const win = stubPushCapableBrowser()
    const sdk = fakeSdk()

    const pending = disablePushNotifications()
    drainDeferred(win, sdk)
    await pending

    expect(sdk.User.PushSubscription.optOut).toHaveBeenCalled()
  })

  it('is a silent no-op when push is not configured', async () => {
    vi.stubEnv('VITE_ONESIGNAL_APP_ID', '')
    stubPushCapableBrowser()
    await expect(disablePushNotifications()).resolves.toBeUndefined()
  })
})

describe('notification preference', () => {
  function fakeStorage(initial = {}) {
    const data = { ...initial }
    return {
      getItem: (key) => (key in data ? data[key] : null),
      setItem: (key, value) => { data[key] = value },
    }
  }

  it('reports null when the user has never decided', () => {
    expect(getNotificationPreference(fakeStorage())).toBe(null)
  })

  it('round-trips an explicit decision', () => {
    const storage = fakeStorage()
    setNotificationPreference(storage, 'on')
    expect(getNotificationPreference(storage)).toBe('on')
    setNotificationPreference(storage, 'off')
    expect(getNotificationPreference(storage)).toBe('off')
  })

  it('treats a corrupted stored value as undecided', () => {
    expect(getNotificationPreference(fakeStorage({ 'famcart-notifications': 'maybe' }))).toBe(null)
  })
})
