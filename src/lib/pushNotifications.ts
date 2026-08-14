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

// One preference per account, keyed like the offline queue and the household
// snapshot, and for a sharper reason than either.
//
// This used to be a single device-wide key. Signing out clears the session, the
// snapshot and the queue but deliberately not this — a preference is a standing
// answer, and someone signing back in should not have to give it again. Which
// meant it outlived the account that set it: A turns notifications on, A signs
// out, B signs in, and syncPushUser below reads 'on' and calls
// OneSignal.login(B). The first-run prompt then skips B, because a preference
// exists. B is subscribed to push having never been asked.
//
// Keyed by user, that whole sequence is correct without anything else changing:
// B has no preference and gets asked, and A's survives for when A comes back.
const PREFERENCE_PREFIX = 'famcart-notifications'
// The device-wide key every build before this one wrote.
const LEGACY_PREFERENCE_KEY = PREFERENCE_PREFIX

function preferenceKey(userId: string): string {
  return `${PREFERENCE_PREFIX}:${userId}`
}

// The legacy value is deliberately NOT migrated onto the first account to read
// it, which is what householdCache and offlineQueue do with theirs.
//
// Those two carry a cached list and unsent writes: adopting them for the wrong
// account is caught by their own userId checks, and dropping them costs a
// returning user something for nothing. This carries a consent, there is no
// account recorded alongside it to check against, and adopting it for whoever
// happens to be signed in now is precisely the bug above — narrowed to one
// device rather than fixed. So it is ignored, and removed on the next write.
//
// The cost is one notification prompt for everyone who had already answered.
// They answer it in one tap, and it is the honest question to ask.
export function getNotificationPreference(
  storage: Pick<Storage, 'getItem'>,
  userId: string,
): NotificationPreference | null {
  if (!userId) return null
  const value = storage.getItem(preferenceKey(userId))
  return value === 'on' || value === 'off' ? value : null
}

export function setNotificationPreference(
  storage: Pick<Storage, 'setItem'> & Partial<Pick<Storage, 'removeItem'>>,
  userId: string,
  mode: NotificationPreference,
): void {
  if (!userId) return
  storage.setItem(preferenceKey(userId), mode)
  // Superseded by the line above: this account has now answered under its own
  // key, so the unattributed one has nothing left to say. Optional on the type
  // because the unit tests hand in a two-accessor stub.
  storage.removeItem?.(LEGACY_PREFERENCE_KEY)
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
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = (value: OneSignalWebSdk | null) => {
      if (settled) return
      settled = true
      // Cleared whichever way this settles, so an SDK that arrives immediately
      // does not leave a 15-second timer holding this closure behind it. Called
      // from the enable, disable and boot-sync paths, so they accumulated.
      if (timer !== null) clearTimeout(timer)
      resolve(value)
    }
    deferredQueue().push((sdk) => finish(sdk))
    timer = setTimeout(() => finish(null), timeoutMs)
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
    // init() rejects when the OneSignal app has no web-push configuration
    // ("App not configured for web push", code 2) — a project-config state, not
    // a runtime fault. Swallow it so it doesn't surface as an unhandled
    // rejection; push simply stays off until the app is configured.
    sdk
      .init({
        appId,
        serviceWorkerParam: { scope: WORKER_SCOPE },
        serviceWorkerPath: WORKER_PATH,
        allowLocalhostAsSecureOrigin: true,
      })
      .catch(() => {})
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

// Re-attach this device to the signed-in user, on every boot.
//
// login() is what ties a device to a Clerk id, and it used to run in exactly one
// place: the moment somebody switched notifications on. That made the binding a
// one-shot. Signing out calls logoutPushUser(), which detaches the device;
// signing back in re-initialises the SDK but never re-binds, so the device stayed
// subscribed to OneSignal while belonging to nobody. The symptom is invisible
// from the client — the toggle still reads On, because that is a separate local
// preference — and only shows up at the far end: the edge function targets the
// right external ids, OneSignal matches no devices, and the REST call comes back
// with an empty notification id and a non-zero `targeted` count.
//
// Idempotent on purpose. OneSignal no-ops a login for the id it already holds,
// so calling this on every boot costs nothing in the normal case and repairs the
// detached one. It stays out of the way of an explicit decision: with no stored
// preference, or one set to off, it does nothing at all, so it can never
// resurrect push for somebody who turned it off.
export async function syncPushUser(
  userId: string,
  storage: Pick<Storage, 'getItem'>,
): Promise<void> {
  if (!userId) return
  const appId = getOneSignalAppId()
  if (!appId) return
  if (getNotificationPreference(storage, userId) !== 'on') return
  if (!isPushSupported()) return

  try {
    if (Capacitor.isNativePlatform()) {
      const { default: OneSignal } = await import('@onesignal/capacitor-plugin')
      // Same init-before-use guard the enable path uses: the native SDK throws
      // and takes the app down when touched before initialize.
      await OneSignal.initialize(appId)
      await OneSignal.login(userId)
      return
    }
    // Short of the full cap: this is background repair, not a user waiting on a
    // toggle, and the next boot will try again.
    const sdk = await webSdk(5000)
    await sdk?.login(userId)
  } catch {
    // Best-effort. A failed re-bind leaves push exactly as broken as it already
    // was, and the toggle in Account settings is still there to force it.
  }
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
