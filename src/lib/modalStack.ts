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

const stack: symbol[] = []
let previousOverflow = ''

// Only the dialog on top acts on Escape, so one keystroke closes one dialog
// rather than every open one at once.
export function isTopModal(token: symbol): boolean {
  return stack.length > 0 && stack[stack.length - 1] === token
}

export function openModal(token: symbol): void {
  if (stack.length === 0 && typeof document !== 'undefined') {
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  stack.push(token)
}

// Removes by identity rather than popping, because dialogs do not always close
// in the order they opened — a route change can unmount one from under another.
export function closeModal(token: symbol): void {
  const at = stack.lastIndexOf(token)
  if (at === -1) return // never opened, or already closed
  stack.splice(at, 1)
  if (stack.length === 0 && typeof document !== 'undefined') {
    document.body.style.overflow = previousOverflow
  }
}

// Test seam: the stack outlives any one component, so a test that unmounts
// mid-stack would otherwise leak state into the next one.
export function __resetModalStackForTest(): void {
  stack.length = 0
  previousOverflow = ''
}
