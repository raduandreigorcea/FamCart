// @vitest-environment happy-dom
//
// The shared primitives' default copy, and the one property that is easy to
// lose: it has to follow the language AFTER the component is created.
//
// Their defaults look like they belong in the prop declaration —
// `confirmText: { type: String, default: t('common.confirm') }` reads better
// than an empty string plus a computed. It is also wrong: defineProps' object
// literal is evaluated once, the first time the module is imported, so the
// default would freeze in whichever language happened to be active then. On a
// device set to Romanian that is usually English, and every unlabelled Confirm
// button in the app stays English forever.
//
// Nothing else in the suite would notice, because every other test runs in
// English. These fail if anyone moves the fallback back into the declaration.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ConfirmModal from '../src/components/ConfirmModal.vue'
import ErrorModal from '../src/components/ErrorModal.vue'
import ModalCloseButton from '../src/components/ModalCloseButton.vue'
import BackButton from '../src/components/BackButton.vue'
import { setLocale } from '../src/lib/i18n'
import { useConfirm } from '../src/lib/useConfirm'

const wrappers = []
function track(w) {
  wrappers.push(w)
  return w
}

const dialogStubs = { global: { stubs: { AppModal: false } } }

beforeEach(async () => {
  // Warm the Romanian chunk, then settle on English: setLocale is a real
  // dynamic import and the first load of a language does not settle inside a
  // single tick.
  await setLocale('ro')
  await setLocale('en')
})

afterEach(async () => {
  while (wrappers.length) wrappers.pop().unmount()
  await setLocale('en')
})

describe('ConfirmModal default button copy', () => {
  it('falls back to the shared words when the caller names neither', () => {
    const w = track(mount(ConfirmModal, { ...dialogStubs, props: { open: true } }))
    expect(w.text()).toContain('Confirm')
    expect(w.text()).toContain('Cancel')
  })

  it('follows a language change made after mounting', async () => {
    const w = track(mount(ConfirmModal, { ...dialogStubs, props: { open: true } }))
    await setLocale('ro')
    await w.vm.$nextTick()
    expect(w.text()).toContain('Confirmă')
    expect(w.text()).toContain('Anulează')
  })

  it('still lets the caller override both', async () => {
    const w = track(
      mount(ConfirmModal, {
        ...dialogStubs,
        props: { open: true, confirmText: 'Delete it', cancelText: 'Keep it' },
      }),
    )
    await setLocale('ro')
    await w.vm.$nextTick()
    expect(w.text()).toContain('Delete it')
    expect(w.text()).toContain('Keep it')
    expect(w.text()).not.toContain('Confirmă')
  })
})

// The layer between the two: every confirm dialog in the app is driven by
// useConfirm, and its CLOSED state is what actually reaches ConfirmModal's
// props. It used to carry a literal 'Confirm'/'Cancel', which is not a default
// but an override — the fallback above never ran, and the tests above passed
// anyway because they mount the modal directly. Nothing in between was tested.
describe('a dialog driven by useConfirm', () => {
  it('reaches ConfirmModal with the fallback still available', async () => {
    const { state, confirm } = useConfirm()
    void confirm({ title: 'Sigur?', message: 'Fără cale de întoarcere.' })

    const w = track(
      mount(ConfirmModal, {
        ...dialogStubs,
        props: {
          open: state.value.open,
          confirmText: state.value.confirmText,
          cancelText: state.value.cancelText,
        },
      }),
    )
    expect(w.text()).toContain('Confirm')

    await setLocale('ro')
    await w.vm.$nextTick()
    expect(w.text()).toContain('Confirmă')
    expect(w.text()).toContain('Anulează')
  })
})

describe('ErrorModal default title', () => {
  it('falls back to the generic title, in the current language', async () => {
    const w = track(mount(ErrorModal, { ...dialogStubs, props: { message: 'Boom' } }))
    expect(w.text()).toContain('Something went wrong')

    await setLocale('ro')
    await w.vm.$nextTick()
    expect(w.text()).toContain('Ceva nu a mers bine')
  })

  it('leaves a caller-supplied title alone', async () => {
    const w = track(
      mount(ErrorModal, { ...dialogStubs, props: { message: 'Boom', title: 'Notifications' } }),
    )
    await setLocale('ro')
    await w.vm.$nextTick()
    expect(w.text()).toContain('Notifications')
  })
})

describe('ModalCloseButton and BackButton', () => {
  it('label themselves in the current language', async () => {
    const close = track(mount(ModalCloseButton))
    const back = track(mount(BackButton))

    expect(close.find('button').attributes('aria-label')).toBe('Close modal')
    expect(back.text()).toContain('Back')

    await setLocale('ro')
    await close.vm.$nextTick()
    await back.vm.$nextTick()

    expect(close.find('button').attributes('aria-label')).toBe('Închide fereastra')
    expect(back.text()).toContain('Înapoi')
  })

  it('lets a caller name the close button itself', async () => {
    const w = track(mount(ModalCloseButton, { props: { ariaLabel: 'Close about' } }))
    await setLocale('ro')
    await w.vm.$nextTick()
    expect(w.find('button').attributes('aria-label')).toBe('Close about')
  })
})
