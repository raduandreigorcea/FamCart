import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  onReconnect,
  isCurrentlyOffline,
  __setOnlineForTest,
} from '../src/lib/connectivity'

// The connectivity module is a singleton; normalise to "online, no listeners"
// before each case so tests are order-independent.
beforeEach(() => {
  __setOnlineForTest(true)
})

describe('connectivity', () => {
  it('reports offline only when the status is disconnected', () => {
    __setOnlineForTest(true)
    expect(isCurrentlyOffline()).toBe(false)
    __setOnlineForTest(false)
    expect(isCurrentlyOffline()).toBe(true)
  })

  it('fires reconnect handlers once, only on an offline→online edge', () => {
    const handler = vi.fn()
    const off = onReconnect(handler)

    __setOnlineForTest(false) // going offline never triggers a reconnect
    expect(handler).not.toHaveBeenCalled()

    __setOnlineForTest(true) // the edge back online triggers exactly one call
    expect(handler).toHaveBeenCalledTimes(1)

    __setOnlineForTest(true) // already online: no spurious re-fire
    expect(handler).toHaveBeenCalledTimes(1)

    off()
  })

  it('stops calling a handler after it unregisters', () => {
    const handler = vi.fn()
    const off = onReconnect(handler)
    off()

    __setOnlineForTest(false)
    __setOnlineForTest(true)
    expect(handler).not.toHaveBeenCalled()
  })

  it('keeps running other handlers when one throws', () => {
    const bad = onReconnect(() => { throw new Error('boom') })
    const good = vi.fn()
    const offGood = onReconnect(good)

    __setOnlineForTest(false)
    __setOnlineForTest(true)
    expect(good).toHaveBeenCalledTimes(1)

    bad()
    offGood()
  })
})
