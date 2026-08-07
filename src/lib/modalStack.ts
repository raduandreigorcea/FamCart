// Which dialogs are open, and what that means for the page behind them.
//
// This has to be module state, not component state. It lived in AppModal's
// <script setup> first, which looks like module scope but is the setup function
// — every instance got its own private copy, so the stack could never see a
// second dialog and the scroll lock was a per-instance save/restore. That was
// wrong in a way tests caught but a browser might not for a while: with two
// dialogs open, closing the *lower* one first restored the overflow value it had
// captured before either opened, handing the page back while a dialog was still
// on screen — and closing the upper one afterwards then wrote "hidden" back,
// leaving the page locked with nothing on it.

// A layer is anything painted over the page that a dismissal should reach:
// dialogs, and the menus that open as sheets on a phone. They share one stack
// because "what does Back close?" has a single answer — the thing on top —
// and two stacks could not agree on which that was.
interface Layer {
  token: symbol
  // How this layer asks to be dismissed. Dialogs emit 'close' to their caller,
  // which flips the prop that opened them; menus flip their own model. Either
  // way the layer is never torn down from here, only asked.
  close: (() => void) | null
  // Menus scroll with the page behind them by design; dialogs do not.
  locksScroll: boolean
}

const stack: Layer[] = []
let previousOverflow = ''

function locksAnything(): boolean {
  return stack.some((layer) => layer.locksScroll)
}

// Only the dialog on top acts on Escape, so one keystroke closes one dialog
// rather than every open one at once.
export function isTopModal(token: symbol): boolean {
  return stack.length > 0 && stack[stack.length - 1].token === token
}

export function openModal(
  token: symbol,
  options: { close?: () => void; locksScroll?: boolean } = {},
): void {
  const locksScroll = options.locksScroll !== false
  if (locksScroll && !locksAnything() && typeof document !== 'undefined') {
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  stack.push({ token, close: options.close ?? null, locksScroll })
}

// Removes by identity rather than popping, because dialogs do not always close
// in the order they opened — a route change can unmount one from under another.
export function closeModal(token: symbol): void {
  const at = stack.map((layer) => layer.token).lastIndexOf(token)
  if (at === -1) return // never opened, or already closed
  stack.splice(at, 1)
  if (!locksAnything() && typeof document !== 'undefined') {
    document.body.style.overflow = previousOverflow
  }
}

// Ask the topmost layer to close itself, and report whether there was one.
//
// This is what Android's Back press runs first: on a phone the thing in front
// of you is what "back" means, and an app that exits from under an open dialog
// instead of closing it has thrown away work. It asks rather than splicing, so
// the layer takes its own close path — transitions, focus restore, the caller's
// state — exactly as if it had been dismissed by hand.
export function closeTopModal(): boolean {
  const top = stack[stack.length - 1]
  if (!top?.close) return false
  top.close()
  return true
}

// Whether anything at all is painted over the page right now.
export function hasOpenModal(): boolean {
  return stack.length > 0
}
