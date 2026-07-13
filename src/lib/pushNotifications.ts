// Push client backed by OneSignal. Two SDKs, chosen at runtime:
//   • Native Capacitor app (Android/iOS) → @onesignal/capacitor-plugin.
//   • Web browser / PWA → OneSignal Web SDK v16, loaded from their CDN by
//     initPushNotifications(); commands go through the window.OneSignalDeferred
//     queue so they work no matter when the script finishes loading.
// Devices are keyed to users via OneSignal.login(<Clerk user id>), and the
// push-on-item-insert edge function targets those external ids through the
// OneSignal REST API. Everything degrades gracefully: without support or
// config the toggle still saves the local preference and nothing else happens.

import { Capacitor } from '@capacitor/core'

// Minimal slice of the v16 web SDK surface this module touches.
interface OneSignalWebSdk {
  init(options: Record<string, unknown>): Promise<void>
  login(externalId: string): Promise<void>
  logout(): Promise<void>
  User: { PushSubscription: { optIn(): Promise<void>; optOut(): Promise<void> } }
  Notifications: {
    addEventListener(
      event: 'foregroundWillDisplay',
      listener: (event: { preventDefault(): void }) => void,
    ): void
  }
}

type DeferredQueue = Array<(sdk: OneSignalWebSdk) => void>

const WEB_SDK_URL = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js'
// Registered under its own scope so it coexists with the root-scope PWA
// service worker (src/sw.js); the push subscription lives on this one.
const WORKER_PATH = 'onesignal/OneSignalSDKWorker.js'
const WORKER_SCOPE = '/onesignal/'

export function getOneSignalAppId(): string {
  return (import.meta.env.VITE_ONESIGNAL_APP_ID as string | undefined) ?? ''
}

// The saved preference doubles as "has this user ever decided": null means the
// login prompt hasn't been answered yet, which is exactly what HomeView keys on.
export type NotificationPreference = 'on' | 'off'

const PREFERENCE_KEY = 'famcart-notifications'

export function getNotificationPreference(
  storage: Pick<Storage, 'getItem'>,
): NotificationPreference | null {
  const value = storage.getItem(PREFERENCE_KEY)
  return value === 'on' || value === 'off' ? value : null
}

export function setNotificationPreference(
  storage: Pick<Storage, 'setItem'>,
  mode: NotificationPreference,
): void {
  storage.setItem(PREFERENCE_KEY, mode)
}

export function isPushSupported(): boolean {
  // Native app: OneSignal uses FCM directly, regardless of WebView support.
  if (Capacitor.isNativePlatform()) return true
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

// Pushes matter on devices that leave the desk: a desktop tab is either open
// (the list is already live via Realtime) or closed with the user away from
// the machine, so greeting desktop users with a permission prompt is noise.
// Coarse primary pointer separates phones/tablets from desktops — including
// touch-screen laptops, whose primary pointer is still the mouse/trackpad.
// Desktop users can still opt in from Account Settings.
export function isDesktopBrowser(): boolean {
  if (Capacitor.isNativePlatform()) return false
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    !window.matchMedia('(pointer: coarse)').matches
  )
}

function deferredQueue(): DeferredQueue {
  const w = window as unknown as { OneSignalDeferred?: DeferredQueue }
  w.OneSignalDeferred = w.OneSignalDeferred ?? []
  return w.OneSignalDeferred
}

// Resolve the loaded web SDK, or null if it hasn't loaded within the cap —
// the CDN script may never arrive (offline, blocked); the toggle must not hang.
function webSdk(timeoutMs = 15000): Promise<OneSignalWebSdk | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: OneSignalWebSdk | null) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    deferredQueue().push((sdk) => finish(sdk))
    setTimeout(() => finish(null), timeoutMs)
  })
}

// Call once at app startup (main.ts). Loads/initializes the right SDK; a
// missing app id means push is unconfigured and this becomes a no-op.
export function initPushNotifications(): void {
  const appId = getOneSignalAppId()
  if (!appId) return

  if (Capacitor.isNativePlatform()) {
    void import('@onesignal/capacitor-plugin').then(({ default: OneSignal }) => {
      void OneSignal.initialize(appId)
      // The list is already live in front of an open app (Supabase Realtime);
      // a banner over it is noise. Suppress while the app is foregrounded.
      OneSignal.Notifications.addEventListener('foregroundWillDisplay', (event) => {
        event.preventDefault()
      })
    })
    return
  }

  if (!isPushSupported()) return
  deferredQueue().push((sdk) => {
    void sdk.init({
      appId,
      serviceWorkerParam: { scope: WORKER_SCOPE },
      serviceWorkerPath: WORKER_PATH,
      allowLocalhostAsSecureOrigin: true,
    })
    // Same reason as the native branch: no banners over a visible live list.
    sdk.Notifications.addEventListener('foregroundWillDisplay', (event) => {
      event.preventDefault()
    })
  })
  const script = document.createElement('script')
  script.src = WEB_SDK_URL
  script.defer = true
  document.head.appendChild(script)
}

export type EnablePushResult =
  | 'subscribed'
  | 'unsupported'
  | 'not-configured'
  | 'permission-denied'
  | 'error'

async function enableNativePush(userId: string): Promise<EnablePushResult> {
  const appId = getOneSignalAppId()
  if (!appId) return 'not-configured'
  try {
    const { default: OneSignal } = await import('@onesignal/capacitor-plugin')
    // Idempotent (the plugin no-ops repeat calls); doing it here instead of
    // trusting the startup init closes the gap where login() reaches a
    // not-yet-initialized native SDK — which throws and takes the app down.
    await OneSignal.initialize(appId)
    await OneSignal.login(userId)
    const accepted = await OneSignal.Notifications.requestPermission(true)
    if (!accepted) return 'permission-denied'
    await OneSignal.User.pushSubscription.optIn()
    return 'subscribed'
  } catch {
    return 'error'
  }
}

async function enableWebPush(userId: string): Promise<EnablePushResult> {
  if (!getOneSignalAppId()) return 'not-configured'
  const sdk = await webSdk()
  if (!sdk) return 'error'
  try {
    await sdk.login(userId)
    // optIn shows the browser permission prompt when it hasn't been granted.
    await sdk.User.PushSubscription.optIn()
  } catch {
    return Notification.permission === 'denied' ? 'permission-denied' : 'error'
  }
  return Notification.permission === 'granted' ? 'subscribed' : 'permission-denied'
}

export async function enablePushNotifications(userId: string): Promise<EnablePushResult> {
  if (!userId) return 'error'
  if (!isPushSupported()) return 'unsupported'
  if (Capacitor.isNativePlatform()) return enableNativePush(userId)
  return enableWebPush(userId)
}

export async function disablePushNotifications(): Promise<void> {
  try {
    if (Capacitor.isNativePlatform()) {
      const appId = getOneSignalAppId()
      if (!appId) return
      const { default: OneSignal } = await import('@onesignal/capacitor-plugin')
      // Same init-before-use guard as enableNativePush: the native SDK throws
      // (crashing the app) when touched before initialize.
      await OneSignal.initialize(appId)
      await OneSignal.User.pushSubscription.optOut()
      return
    }
    if (!isPushSupported() || !getOneSignalAppId()) return
    // Short cap: if the SDK never loaded there is no subscription to turn off.
    const sdk = await webSdk(3000)
    await sdk?.User.PushSubscription.optOut()
  } catch {
    // Best-effort: opting out again next time is harmless.
  }
}

// Detach this device from the account on sign-out, so pushes for the old
// account stop following a shared device.
export async function logoutPushUser(): Promise<void> {
  try {
    const appId = getOneSignalAppId()
    if (!appId) return
    if (Capacitor.isNativePlatform()) {
      const { default: OneSignal } = await import('@onesignal/capacitor-plugin')
      await OneSignal.initialize(appId)
      await OneSignal.logout()
      return
    }
    if (!isPushSupported()) return
    const sdk = await webSdk(3000)
    await sdk?.logout()
  } catch {
    // Best-effort.
  }
}
