// The awaitable confirm dialog. Its whole point is that a caller can write
// `if (!(await confirm(...))) return` and have the answer arrive there, so what
// matters is that the promise always settles — including in the awkward cases
// where a second question arrives, or the same answer is delivered twice.
import { describe, it, expect } from 'vitest'
import { useConfirm } from '../src/lib/useConfirm'

describe('useConfirm', () => {
  it('starts closed', () => {
    const { state } = useConfirm()
    expect(state.value.open).toBe(false)
  })

  it('opens with the question and resolves true when confirmed', async () => {
    const { state, confirm, resolveWith } = useConfirm()

    const answer = confirm({ title: 'Delete household?', message: 'Gone for good.', danger: true })
    expect(state.value.open).toBe(true)
    expect(state.value.title).toBe('Delete household?')
    expect(state.value.danger).toBe(true)

    resolveWith(true)
    await expect(answer).resolves.toBe(true)
    expect(state.value.open).toBe(false)
  })

  it('resolves false when cancelled', async () => {
    const { confirm, resolveWith } = useConfirm()
    const answer = confirm({ title: 'Leave?', message: 'You will lose access.' })
    resolveWith(false)
    await expect(answer).resolves.toBe(false)
  })

  it('fills in the defaults a caller leaves out', async () => {
    const { state, confirm } = useConfirm()
    void confirm({ title: 'T', message: 'M' })

    // Empty, and it has to stay empty. ConfirmModal renders
    // `confirmText || t('common.confirm')` in a computed so the copy follows a
    // language change; a friendly-looking 'Confirm' here is the value that
    // suppresses that fallback, and since no caller in the app passes its own
    // button text, it left every confirm dialog English in all six languages.
    // The words themselves are asserted in
    // test/sharedPrimitivesLanguage.component.test.js, which is the layer that
    // can see them.
    expect(state.value.confirmText).toBe('')
    expect(state.value.cancelText).toBe('')
    expect(state.value.showCancel).toBe(true)
    expect(state.value.danger).toBe(false)
  })

  it('does not carry the previous question into the next one', async () => {
    const { state, confirm, resolveWith } = useConfirm()

    const first = confirm({ title: 'One', message: 'M', danger: true, showCancel: false })
    resolveWith(true)
    await first

    void confirm({ title: 'Two', message: 'M' })
    expect(state.value.danger).toBe(false)
    expect(state.value.showCancel).toBe(true)
  })

  it('never strands a caller when a second question interrupts the first', async () => {
    const { confirm, resolveWith } = useConfirm()

    const first = confirm({ title: 'One', message: 'M' })
    const second = confirm({ title: 'Two', message: 'M' })

    // The interrupted question answers itself "no" rather than hanging forever.
    await expect(first).resolves.toBe(false)

    resolveWith(true)
    await expect(second).resolves.toBe(true)
  })

  it('ignores an answer when nothing was asked', () => {
    const { resolveWith } = useConfirm()
    expect(() => resolveWith(true)).not.toThrow()
  })
})
