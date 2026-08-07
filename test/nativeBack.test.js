// @vitest-environment happy-dom
//
// What Android's Back button does, in order: close the thing in front of you,
// then go back a screen, then leave the app. Only the last of those cannot be
// undone, which is why it is the last one reached.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleBackPress } from '../src/lib/nativeBack'
import { closeModal, closeTopModal, hasOpenModal, openModal } from '../src/lib/modalStack'

function fakeRouter(name) {
  return {
    currentRoute: { value: { name } },
    back: vi.fn(),
    replace: vi.fn(),
  }
}

// The stack is module state, so anything a test opens it must also close.
const opened = []
function openLayer(close, locksScroll = true) {
  const token = Symbol('layer')
  opened.push(token)
  openModal(token, { close, locksScroll })
  return token
}

beforeEach(() => {
  while (opened.length) closeModal(opened.pop())
  document.body.style.overflow = ''
})

describe('with something open in front', () => {
  it('closes the dialog instead of touching the screen behind it', () => {
    const close = vi.fn()
    openLayer(close)
    const router = fakeRouter('home')
    const exit = vi.fn()

    handleBackPress(router, true, exit)

    expect(close).toHaveBeenCalledTimes(1)
    expect(router.back).not.toHaveBeenCalled()
    // The one that matters: an open dialog must never fall through to exit.
    expect(exit).not.toHaveBeenCalled()
  })

  // Two dialogs deep, Back peels one at a time rather than clearing the stack.
  it('closes only the topmost of several', () => {
    const under = vi.fn()
    const over = vi.fn()
    openLayer(under)
    openLayer(over)

    handleBackPress(fakeRouter('home'), true, vi.fn())

    expect(over).toHaveBeenCalledTimes(1)
    expect(under).not.toHaveBeenCalled()
  })

  // A menu is a bottom sheet on a phone. A sheet the hardware button ignores
  // reads as a dead button, so menus join the same stack as dialogs.
  it('reaches a menu that does not lock the page', () => {
    const close = vi.fn()
    openLayer(close, false)

    handleBackPress(fakeRouter('home'), true, vi.fn())

    expect(close).toHaveBeenCalledTimes(1)
  })
})

describe('with nothing open', () => {
  it('goes back a screen from one you did not start on', () => {
    const router = fakeRouter('household-setup')
    const exit = vi.fn()

    handleBackPress(router, true, exit)

    expect(router.back).toHaveBeenCalledTimes(1)
    expect(exit).not.toHaveBeenCalled()
  })

  // Deep-linked straight onto an inner screen there is no history, and back()
  // would sit there doing nothing.
  it('sends you home rather than nowhere when there is no history', () => {
    const router = fakeRouter('household-setup')

    handleBackPress(router, false, vi.fn())

    expect(router.back).not.toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledWith({ name: 'home' })
  })

  // Back on a root screen means leave — and going "back" from login to home
  // would only bounce off the router guard and return to login.
  it.each(['home', 'login', 'offline'])('leaves the app from %s', (name) => {
    const router = fakeRouter(name)
    const exit = vi.fn()

    handleBackPress(router, true, exit)

    expect(exit).toHaveBeenCalledTimes(1)
    expect(router.back).not.toHaveBeenCalled()
  })
})

describe('the layer stack itself', () => {
  it('reports nothing to close when nothing is open', () => {
    expect(hasOpenModal()).toBe(false)
    expect(closeTopModal()).toBe(false)
  })

  // A menu scrolls with the page behind it by design; a dialog does not. The
  // lock has to follow the dialogs only, or opening a menu would freeze the
  // list underneath it.
  it('locks the page for dialogs but not for menus', () => {
    const menu = openLayer(vi.fn(), false)
    expect(document.body.style.overflow).toBe('')

    const dialog = openLayer(vi.fn(), true)
    expect(document.body.style.overflow).toBe('hidden')

    closeModal(dialog)
    expect(document.body.style.overflow).toBe('')

    closeModal(menu)
  })

  // Dialogs do not always close in the order they opened: a route change can
  // unmount one from under another.
  it('releases the lock only once the last dialog is gone', () => {
    const first = openLayer(vi.fn())
    const second = openLayer(vi.fn())
    expect(document.body.style.overflow).toBe('hidden')

    closeModal(first)
    expect(document.body.style.overflow).toBe('hidden')

    closeModal(second)
    expect(document.body.style.overflow).toBe('')
  })
})
