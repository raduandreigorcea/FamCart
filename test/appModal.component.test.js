// @vitest-environment happy-dom
//
// The dialog shell. Six dialogs each grew their own overlay and drifted: only
// one closed on Escape, none locked the page behind them, and only one put
// focus anywhere. These pin the behaviour now that it lives in one place —
// especially the parts that only misbehave when two dialogs are open at once,
// which is exactly when nobody tests by hand.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import AppModal from '../src/components/AppModal.vue'

const mounted = []

function open(props = {}) {
  const wrapper = mount(AppModal, {
    props: { open: true, ...props },
    slots: {
      default: '<div class="dlg"><button class="a">A</button><button class="b">B</button></div>',
    },
    attachTo: document.body,
  })
  mounted.push(wrapper)
  return wrapper
}

const press = (key, opts = {}) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }))

beforeEach(() => {
  document.body.style.overflow = ''
})

afterEach(() => {
  while (mounted.length) mounted.pop().unmount()
  document.body.style.overflow = ''
  vi.restoreAllMocks()
})

describe('dismissal', () => {
  it('closes on Escape', async () => {
    const wrapper = open()
    press('Escape')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('closes on a click outside the dialog', async () => {
    const wrapper = open()
    await wrapper.find('.app-modal-overlay').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('ignores a click that started inside the dialog', async () => {
    const wrapper = open()
    await wrapper.find('.dlg').trigger('click')
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('can refuse backdrop dismissal, for something destructive', async () => {
    const wrapper = open({ closeOnBackdrop: false })
    await wrapper.find('.app-modal-overlay').trigger('click')
    expect(wrapper.emitted('close')).toBeUndefined()
  })
})

describe('the page behind it', () => {
  it('locks scrolling while open', () => {
    open()
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('gives scrolling back on close', async () => {
    const wrapper = open()
    await wrapper.setProps({ open: false })
    expect(document.body.style.overflow).toBe('')
  })

  it('gives it back when unmounted while still open', () => {
    const wrapper = open()
    expect(document.body.style.overflow).toBe('hidden')
    wrapper.unmount()
    mounted.pop()
    expect(document.body.style.overflow).toBe('')
  })

  // The refcount earns its keep here: a naive set/clear pair would hand the
  // page back the moment the top dialog closed, with one still on screen.
  it('stays locked while a second dialog is still open', async () => {
    const first = open()
    const second = open()

    await second.setProps({ open: false })
    expect(document.body.style.overflow).toBe('hidden')

    await first.setProps({ open: false })
    expect(document.body.style.overflow).toBe('')
  })

  // Dialogs do not always close in the order they opened. When the state was
  // per-instance this left the page locked with nothing on screen: the lower
  // dialog restored the value it captured before either opened, and the upper
  // one then wrote "hidden" straight back.
  it('gives it back even when the dialogs close bottom-first', async () => {
    const first = open()
    const second = open()

    await first.setProps({ open: false })
    expect(document.body.style.overflow).toBe('hidden')

    await second.setProps({ open: false })
    expect(document.body.style.overflow).toBe('')
  })
})

describe('stacking', () => {
  // Without a stack, one keystroke closes every open dialog at once.
  it('sends Escape only to the dialog on top', () => {
    const under = open()
    const over = open()

    press('Escape')

    expect(over.emitted('close')).toHaveLength(1)
    expect(under.emitted('close')).toBeUndefined()
  })

  it('hands Escape back to the one underneath once the top closes', async () => {
    const under = open()
    const over = open()

    await over.setProps({ open: false })
    press('Escape')

    expect(under.emitted('close')).toHaveLength(1)
  })
})

describe('focus', () => {
  it('moves focus into the dialog on open', async () => {
    const wrapper = open()
    await nextTick()
    expect(document.activeElement).toBe(wrapper.find('.a').element)
  })

  it('returns focus to whatever opened it', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    expect(document.activeElement).toBe(opener)

    const wrapper = open()
    await nextTick()
    await wrapper.setProps({ open: false })

    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  // Tab out of the last control wraps to the first rather than walking into the
  // page behind, which the overlay hides from a mouse but not from a keyboard.
  it('keeps Tab inside the dialog', async () => {
    const wrapper = open()
    await nextTick()

    wrapper.find('.b').element.focus()
    press('Tab')
    expect(document.activeElement).toBe(wrapper.find('.a').element)

    press('Tab', { shiftKey: true })
    expect(document.activeElement).toBe(wrapper.find('.b').element)
  })
})
