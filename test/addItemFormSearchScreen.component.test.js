// @vitest-environment happy-dom
//
// A dialog opened from the search, and what it does to the screen behind it.
//
// The item-limit popup is the one you can actually reach: tap a suggestion with
// the list already full. It does not take focus when it opens, so the screen
// stays up behind it. Dismissing it is what moves focus — onto the dialog's own
// button, and then straight back onto the field, because AppModal hands focus to
// whatever was focused when it opened.
//
// That used to be a race, and this file was written for it. Losing focus started
// the screen closing; the focus coming back landed mid-exit, and expand() read
// `expanded` as "already a screen" and did nothing. A moment later the exit it
// had ignored settled and turned the screen off underneath a field that still
// had focus and a keyboard that was still up — so no further focus event was
// ever coming, and the search sat as a 275px dropdown in the middle of an empty
// screen for the rest of the session.
//
// There is no race left, and that is the point of these tests rather than a
// reason to delete them. Focus no longer dismisses the sheet at all, so the
// window the failure needed does not exist: the screen is still there when the
// dialog hands focus back, because it never began leaving. What closes it is a
// deliberate press, which is covered here too — a guarantee that costs nothing
// to keep and would be easy to lose again while making blur mean something.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AddItemForm from '../src/components/AddItemForm.vue'

const PRODUCTS = [
  { name: 'Apa Plata 2L', maker: 'Dorna' },
  { name: 'Banane 1kg', maker: null },
]

let wrapper = null
let realMatchMedia

beforeEach(() => {
  vi.useFakeTimers()
  realMatchMedia = window.matchMedia
  // Phone width, and motion not reduced: both queries have to answer for the
  // exit animation to run at all.
  window.matchMedia = (query) => ({
    matches: query.includes('899.98px'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })
})

afterEach(() => {
  if (wrapper) wrapper.unmount()
  wrapper = null
  window.matchMedia = realMatchMedia
  vi.useRealTimers()
})

// Raised the way the bar raises it, then focused: the order the component uses
// on its own way up, and the state the item-limit popup opens on top of.
async function focusIntoSearch() {
  wrapper = mount(AddItemForm, {
    props: { name: 'coca', suggestions: PRODUCTS, expanded: true },
  })
  await wrapper.find('input').trigger('focus')
  await flushPromises()
  expect(wrapper.find('.add-form').classes()).toContain('add-form--expanded')
}

describe('the phone search screen and a dialog that hands focus back', () => {
  it('is still a screen when the focus comes back', async () => {
    await focusIntoSearch()

    // Tapping the dialog's button blurs the field. Nothing follows from that.
    await wrapper.find('input').trigger('blur')
    await flushPromises()
    expect(wrapper.find('.add-form').classes()).not.toContain('add-form--closing')

    // The dialog closes and gives the field its focus back.
    await wrapper.find('input').trigger('focus')
    await flushPromises()

    // Past the exit's own fallback timer, which is what used to end it. There is
    // no exit in flight for it to end.
    vi.advanceTimersByTime(500)
    await flushPromises()

    expect(wrapper.find('.add-form').classes()).toContain('add-form--expanded')
    expect(wrapper.find('.add-cover').exists()).toBe(true)
    expect(wrapper.emitted('update:expanded')).toBeUndefined()
  })

  it('does not come down when the field is left alone', async () => {
    await focusIntoSearch()

    await wrapper.find('input').trigger('blur')
    await flushPromises()

    vi.advanceTimersByTime(500)
    await flushPromises()

    expect(wrapper.find('.add-form').classes()).toContain('add-form--expanded')
    expect(wrapper.find('.add-cover').exists()).toBe(true)
  })

  // The other half: it does still close, and only this way.
  it('comes down on the one press that means it', async () => {
    await focusIntoSearch()

    await wrapper.find('.back-btn').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('update:expanded').at(-1)).toEqual([false])
    expect(wrapper.find('.add-form').classes()).toContain('add-form--closing')

    vi.advanceTimersByTime(500)
    await flushPromises()

    expect(wrapper.find('.add-form').classes()).not.toContain('add-form--expanded')
    expect(wrapper.find('.add-cover').exists()).toBe(false)
  })
})
