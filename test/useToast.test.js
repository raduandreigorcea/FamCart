// Undo on delete is built on the toast committing its deferred action every way
// it can leave except Undo. If any path skips onExpire, a deleted row comes back
// on the next load; if Undo runs it, the row is deleted anyway. Both are silent.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  dismissToast,
  pauseToast,
  resumeToast,
  showToast,
  triggerToastAction,
  useToast,
  MAX_VISIBLE_TOASTS,
} from '../src/lib/useToast'

beforeEach(() => {
  vi.useFakeTimers()
  dismissToast()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useToast', () => {
  it('commits the deferred action when it times out', () => {
    const onExpire = vi.fn()
    showToast({ message: 'Deleted', onExpire, duration: 5000 })
    vi.advanceTimersByTime(4999)
    expect(onExpire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onExpire).toHaveBeenCalledOnce()
    expect(useToast().toasts.value).toEqual([])
  })

  it('runs the action and never the deferred commit on Undo', () => {
    const onExpire = vi.fn()
    const onAction = vi.fn()
    showToast({ message: 'Deleted', actionLabel: 'Undo', onAction, onExpire })
    triggerToastAction()
    vi.advanceTimersByTime(10000)
    expect(onAction).toHaveBeenCalledOnce()
    expect(onExpire).not.toHaveBeenCalled()
  })

  it('stacks a new toast on top of the one already up, each keeping its Undo', () => {
    const first = vi.fn()
    const undoFirst = vi.fn()
    const a = showToast({ message: 'Removed A', actionLabel: 'Undo', onAction: undoFirst, onExpire: first })
    showToast({ message: 'Removed B' })

    expect(useToast().toasts.value.map((t) => t.message)).toEqual(['Removed A', 'Removed B'])
    expect(first).not.toHaveBeenCalled()

    triggerToastAction(a)
    expect(undoFirst).toHaveBeenCalledOnce()
    expect(useToast().toasts.value.map((t) => t.message)).toEqual(['Removed B'])
  })

  it('lets the oldest go, committing it, once the stack is full', () => {
    const oldest = vi.fn()
    showToast({ message: '1', onExpire: oldest })
    for (let i = 2; i <= MAX_VISIBLE_TOASTS + 1; i++) showToast({ message: String(i) })

    expect(oldest).toHaveBeenCalledOnce()
    expect(useToast().toasts.value).toHaveLength(MAX_VISIBLE_TOASTS)
  })

  it('times each toast out on its own clock', () => {
    const early = vi.fn()
    const late = vi.fn()
    showToast({ message: 'a', onExpire: early, duration: 5000 })
    vi.advanceTimersByTime(3000)
    showToast({ message: 'b', onExpire: late, duration: 5000 })
    vi.advanceTimersByTime(2000)
    expect(early).toHaveBeenCalledOnce()
    expect(late).not.toHaveBeenCalled()
  })

  it('does not time out while paused', () => {
    const onExpire = vi.fn()
    showToast({ message: 'Deleted', onExpire, duration: 5000 })
    vi.advanceTimersByTime(3000)
    pauseToast()
    vi.advanceTimersByTime(60000)
    expect(onExpire).not.toHaveBeenCalled()
    resumeToast()
    vi.advanceTimersByTime(2000)
    expect(onExpire).toHaveBeenCalledOnce()
  })
})
