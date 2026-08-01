import { ref, type Ref } from 'vue'
import { hasSeenTour, markTourSeen } from './onboarding'
import {
  enablePushNotifications,
  getNotificationPreference,
  getOneSignalAppId,
  isDesktopBrowser,
  isPushSupported,
  setNotificationPreference,
} from './pushNotifications'

// What a new user is shown once, and in what order: the gesture tour first, then
// the notifications ask. One unit rather than two, because the order is the
// point — the tour hands off to the ask when it closes, and being asked for a
// permission before you know what the app does is how you get a "no".
//
// Extracted from HomeView, which owned both alongside six other concerns. The
// view now just renders the two dialogs and hands back the answers.

export interface FirstRunGreeting {
  onboardingTourOpen: Ref<boolean>
  notificationPromptOpen: Ref<boolean>
  // Surfaced by the caller through its own error dialog rather than here, so
  // every failure in the view arrives on one surface.
  notificationError: Ref<string>
  /** Begin the sequence, once the list is up and worth looking at. */
  start: () => void
  closeTour: () => void
  acceptNotifications: () => Promise<void>
  declineNotifications: () => void
}

export function useFirstRunGreeting(options: {
  userId: Ref<string | null | undefined>
  // Passed in rather than read here: the view's notion of offline includes a
  // failed write, not just navigator.onLine, and there should be one answer.
  isOffline: () => boolean
  storage?: Storage
}): FirstRunGreeting {
  const { userId, isOffline } = options
  const storage = options.storage ?? localStorage

  const onboardingTourOpen = ref(false)
  const notificationPromptOpen = ref(false)
  const notificationError = ref('')

  // First-login greeting: users who never answered the notifications question
  // get asked once, right after their list is up. An unset preference is the
  // signal — both prompt buttons store a decision, so it never re-appears.
  function maybePromptForNotifications(): void {
    if (!userId.value) return
    if (getNotificationPreference(storage)) return
    // No point asking where accepting could do nothing: unsupported browser,
    // push not configured, or offline (the OneSignal subscription needs the
    // network). Leaving the preference unset re-asks on the next login instead.
    if (!isPushSupported() || !getOneSignalAppId() || isOffline()) return
    // Desktop browsers never get greeted with a permission ask; the preference
    // stays unset so the same account is still asked on a phone later.
    if (isDesktopBrowser()) return
    notificationPromptOpen.value = true
  }

  function start(): void {
    if (!userId.value) return
    if (!hasSeenTour(storage)) {
      onboardingTourOpen.value = true
      return
    }
    maybePromptForNotifications()
  }

  function closeTour(): void {
    onboardingTourOpen.value = false
    markTourSeen(storage)
    maybePromptForNotifications()
  }

  async function acceptNotifications(): Promise<void> {
    notificationPromptOpen.value = false
    setNotificationPreference(storage, 'on')
    const result = await enablePushNotifications(userId.value ?? '')
    if (result === 'permission-denied') {
      // The browser said no — reflect reality instead of a preference that lies.
      setNotificationPreference(storage, 'off')
      notificationError.value =
        'Notifications are blocked for FamCart in your device or browser settings.'
    } else if (result === 'error') {
      setNotificationPreference(storage, 'off')
      notificationError.value =
        'Could not enable notifications. You can try again from Account Settings.'
    }
  }

  function declineNotifications(): void {
    notificationPromptOpen.value = false
    setNotificationPreference(storage, 'off')
  }

  return {
    onboardingTourOpen,
    notificationPromptOpen,
    notificationError,
    start,
    closeTour,
    acceptNotifications,
    declineNotifications,
  }
}
