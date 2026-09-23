// @vitest-environment happy-dom
//
// Which changes to the list read as somebody else's. The failures are both
// quiet: our own add glowing as if it came from elsewhere is noise on every
// tap, and our own checkout toasting "someone checked out" is simply false.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useRemoteChanges } from '../src/lib/useRemoteChanges'

const row = (id, added_by, checked = false) => ({ id, added_by, checked, name: `Item ${id}`, maker: null })

function setup(initial) {
  const items = ref(initial)
  const onRemoteCheckout = vi.fn()
  let api
  mount(
    defineComponent({
      setup() {
        api = useRemoteChanges({ items, userId: () => 'me', active: () => true, onRemoteCheckout })
        return () => null
      },
    }),
  )
  return { items, onRemoteCheckout, api }
}

afterEach(() => vi.useRealTimers())

describe('useRemoteChanges', () => {
  it('glows a row somebody else added, briefly', async () => {
    vi.useFakeTimers()
    const { items, api } = setup([row('a', 'me')])
    await nextTick()
    items.value = [...items.value, row('b', 'ana')]
    await nextTick()
    expect([...api.freshIds.value]).toEqual(['b'])
    vi.advanceTimersByTime(2000)
    expect(api.freshIds.value.size).toBe(0)
  })

  it('does not glow your own adds', async () => {
    const { items, api } = setup([])
    await nextTick()
    items.value = [row('a', 'me')]
    await nextTick()
    expect(api.freshIds.value.size).toBe(0)
  })

  it('says so when somebody else checks out the cart', async () => {
    const { items, onRemoteCheckout } = setup([row('a', 'me', true), row('b', 'me', true), row('c', 'me')])
    await nextTick()
    items.value = [row('c', 'me')]
    await nextTick()
    expect(onRemoteCheckout).toHaveBeenCalledWith(2)
  })

  // A merge deletes one of two rows of the same product. Seen from another
  // device the deleted row can arrive before the other row's tick, so for a
  // moment the cart is empty: that is not a checkout.
  it('does not read a merge as somebody checking out', async () => {
    const { items, onRemoteCheckout } = setup([
      { id: 'a', added_by: 'me', checked: true, name: 'Milk', maker: null },
      { id: 'b', added_by: 'me', checked: false, name: 'Milk', maker: null },
    ])
    await nextTick()
    items.value = [{ id: 'b', added_by: 'me', checked: false, name: 'Milk', maker: null }]
    await nextTick()
    expect(onRemoteCheckout).not.toHaveBeenCalled()
  })

  it('stays quiet about your own checkout', async () => {
    const { items, onRemoteCheckout, api } = setup([row('a', 'me', true)])
    await nextTick()
    api.markLocal(['a'])
    items.value = []
    await nextTick()
    expect(onRemoteCheckout).not.toHaveBeenCalled()
  })
})
