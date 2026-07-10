// Push client. Two delivery backends, chosen at runtime:
//   • Native Capacitor app (Android/iOS) → Firebase Cloud Messaging device token,
//     stored in device_push_tokens (migration 017).
//   • Web browser / PWA → Web Push subscription, stored in push_subscriptions
//     (migration 016).
// Both are fanned out by the push-on-item-insert edge function. Everything
// degrades gracefully: without support or config the toggle still saves the
// local preference and nothing else happens.

import { Capacitor } from '@capacitor/core'

interface Db {
  from(table: string): any
  rpc(fn: string, args?: Record<string, unknown>): any
}

export interface PushSubscriptionRow {
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
}

const TABLE = 'push_subscriptions'
const DEVICE_TABLE = 'device_push_tokens'
// Remembers the FCM token this install last registered, so disable can delete
// the right row (the plugin doesn't hand the token back on demand).
const FCM_TOKEN_KEY = 'famcart-fcm-token'

export function getVapidPublicKey(): string {
  return (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? ''
}

export function isPushSupported(): boolean {
  // Native app: FCM works regardless of the WebView's Web Push support.
  if (Capacitor.isNativePlatform()) return true
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

// VAPID public keys travel base64url-encoded; PushManager wants the raw bytes.
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

// Flatten a PushSubscriptionJSON into the push_subscriptions row shape.
// Returns null when the browser produced an unusable subscription.
export function toSubscriptionRow(
  userId: string,
  subscription: PushSubscriptionJSON,
): PushSubscriptionRow | null {
  const endpoint = subscription.endpoint
  const p256dh = subscription.keys?.p256dh
  const auth = subscription.keys?.auth
  if (!userId || !endpoint || !p256dh || !auth) return null
  return { user_id: userId, endpoint, p256dh, auth }
}

export type EnablePushResult =
  | 'subscribed'
  | 'unsupported'
  | 'not-configured'
  | 'permission-denied'
  | 'error'

interface ListenerHandle {
  remove: () => void
}

// Register with FCM and resolve the device token, or null if the OS denied
// permission (handled by the caller) or registration failed / timed out.
async function requestFcmToken(): Promise<{ token: string | null; denied: boolean }> {
  const { PushNotifications } = await import('@capacitor/push-notifications')

  let perm = await PushNotifications.checkPermissions()
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
    perm = await PushNotifications.requestPermissions()
  }
  if (perm.receive !== 'granted') return { token: null, denied: true }

  const token = await new Promise<string | null>((resolve) => {
    let settled = false
    let regHandle: ListenerHandle | undefined
    let errHandle: ListenerHandle | undefined
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      regHandle?.remove()
      errHandle?.remove()
      resolve(value)
    }
    PushNotifications.addListener('registration', (t: { value: string }) => finish(t.value)).then(
      (h: ListenerHandle) => {
        regHandle = h
        if (settled) h.remove()
      },
    )
    PushNotifications.addListener('registrationError', () => finish(null)).then(
      (h: ListenerHandle) => {
        errHandle = h
        if (settled) h.remove()
      },
    )
    void PushNotifications.register()
    // The registration event normally arrives in well under a second; cap the
    // wait so the toggle can't hang if it never does.
    setTimeout(() => finish(null), 15000)
  })

  return { token, denied: false }
}

async function enableNativePush(db: Db): Promise<EnablePushResult> {
  try {
    const { token, denied } = await requestFcmToken()
    if (denied) return 'permission-denied'
    if (!token) return 'error'

    const { error } = await db.rpc('claim_device_push_token', {
      _token: token,
      _platform: Capacitor.getPlatform(),
    })
    if (error) return 'error'

    try {
      localStorage.setItem(FCM_TOKEN_KEY, token)
    } catch {
      // Storage disabled — disable() falls back to a no-op; the row is pruned
      // by the sender on its first failed push instead.
    }
    return 'subscribed'
  } catch {
    return 'error'
  }
}

async function enableWebPush(db: Db, userId: string): Promise<EnablePushResult> {
  const vapidKey = getVapidPublicKey()
  if (!vapidKey) return 'not-configured'

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'permission-denied'

  try {
    // getRegistration resolves immediately; `.ready` would hang forever in dev,
    // where the service worker is not registered at all.
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) return 'unsupported'

    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      }))

    const row = toSubscriptionRow(userId, subscription.toJSON())
    if (!row) return 'error'
    // Definer RPC (migration 016): endpoints are unique per browser profile, and
    // claiming one left behind by a previously signed-in account is an update
    // RLS could never allow — the takeover lives in the scoped function.
    const { error } = await db.rpc('claim_push_subscription', {
      _endpoint: row.endpoint,
      _p256dh: row.p256dh,
      _auth: row.auth,
    })
    return error ? 'error' : 'subscribed'
  } catch {
    return 'error'
  }
}

export async function enablePushNotifications(db: Db, userId: string): Promise<EnablePushResult> {
  if (!isPushSupported()) return 'unsupported'
  if (Capacitor.isNativePlatform()) return enableNativePush(db)
  return enableWebPush(db, userId)
}

async function disableNativePush(db: Db): Promise<void> {
  try {
    let token: string | null = null
    try {
      token = localStorage.getItem(FCM_TOKEN_KEY)
    } catch {
      token = null
    }
    if (token) {
      await db.from(DEVICE_TABLE).delete().eq('token', token)
      try {
        localStorage.removeItem(FCM_TOKEN_KEY)
      } catch {
        // Best-effort.
      }
    }
    const { PushNotifications } = await import('@capacitor/push-notifications')
    await PushNotifications.removeAllListeners()
  } catch {
    // Best-effort: a stale token stops delivering once the sender prunes it on
    // its first UNREGISTERED/NOT_FOUND response.
  }
}

async function disableWebPush(db: Db): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    const subscription = await registration?.pushManager.getSubscription()
    if (!subscription) return
    await db.from(TABLE).delete().eq('endpoint', subscription.endpoint)
    await subscription.unsubscribe()
  } catch {
    // Best-effort: a leaked subscription stops delivering after the sender
    // prunes the endpoint on its first expired push.
  }
}

export async function disablePushNotifications(db: Db): Promise<void> {
  if (Capacitor.isNativePlatform()) return disableNativePush(db)
  if (!isPushSupported()) return
  return disableWebPush(db)
}
