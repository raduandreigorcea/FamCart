// Android's hardware Back button, wired to mean what it looks like it means.
//
// Until now nothing listened for it, so Capacitor's default took over: Back
// walked the WebView's own history, which a single-page app with dialogs mostly
// does not have. Pressing it with a dialog open did nothing visible, or left
// the app entirely with the dialog still on screen — the two worst answers.
//
// The order below is the whole design, and it is just "closest thing first":
//
//   1. Anything painted over the page — a dialog, a bottom sheet. On a phone
//      the layer in front of you IS what "back" refers to.
//   2. The previous screen, if this is not one someone starts on.
//   3. Leaving the app, which is what Back means on a root screen and is the
//      one case where Android users expect the app to close.
//
// Only step 3 is irreversible, so it is the last thing tried rather than the
// first thing that happens when the other two are not obviously applicable.

import { Capacitor } from '@capacitor/core'
import type { Router } from 'vue-router'
import { closeTopModal } from './modalStack'

// Screens with nothing behind them. Home is the app; login and offline are
// where someone lands when they cannot be in it. Backing out of any of these
// has nowhere to go, so it means leave — going "back" from login to home would
// only bounce off the router guard and return to login.
const ROOT_ROUTES = new Set(['home', 'login', 'offline'])

// Split from the listener so the decision can be tested without a device.
export function handleBackPress(
  router: Pick<Router, 'currentRoute' | 'back' | 'replace'>,
  canGoBack: boolean,
  exit: () => void,
): void {
  // A dialog closes rather than the screen changing under it.
  if (closeTopModal()) return

  const name = router.currentRoute.value.name
  const onRoot = typeof name !== 'string' || ROOT_ROUTES.has(name)

  if (!onRoot) {
    // canGoBack is the WebView's own history. Deep-linked straight onto a inner
    // screen there is none, and back() would sit there doing nothing — so send
    // them home instead of leaving them stuck.
    if (canGoBack) router.back()
    else void router.replace({ name: 'home' })
    return
  }

  exit()
}

// Registers the listener. A no-op off native, where Back is the browser's own
// and belongs to the browser.
export function startNativeBack(router: Router): () => void {
  let isNative = false
  try {
    isNative = Capacitor.isNativePlatform()
  } catch {
    return () => {}
  }
  if (!isNative) return () => {}

  let remove: (() => void) | null = null
  let stopped = false

  void import('@capacitor/app')
    .then(({ App }) =>
      App.addListener('backButton', ({ canGoBack }) => {
        handleBackPress(router, canGoBack, () => {
          void App.exitApp()
        })
      }),
    )
    .then((handle) => {
      // Unregistered before the handle arrived: drop it rather than leaking a
      // listener that outlives the app instance that asked for it.
      if (stopped) void handle.remove()
      else remove = () => void handle.remove()
    })
    .catch(() => {
      // No plugin, no listener — Back keeps Capacitor's default behaviour,
      // which is the state this file was written to improve on, not a crash.
    })

  return () => {
    stopped = true
    remove?.()
  }
}
