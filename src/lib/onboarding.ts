// Whether the one-time onboarding tour has been shown. Stored locally (not on the
// server) — it's a per-device UI nicety, and showing it once more on a new device
// is harmless. Bumping the key re-runs the tour for everyone, which is what we want
// when the tour teaches a changed interaction (e.g. swipe replacing the buttons).
const TOUR_SEEN_KEY = 'famcart_tour_seen_v1'

export function hasSeenTour(storage: Storage): boolean {
  try {
    return storage.getItem(TOUR_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

export function markTourSeen(storage: Storage): void {
  try {
    storage.setItem(TOUR_SEEN_KEY, '1')
  } catch {
    // Private-mode / storage-disabled: the tour just shows again next time.
  }
}
