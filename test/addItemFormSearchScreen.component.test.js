// @vitest-environment happy-dom
//
// Refocusing the field while the search screen is on its way out.
//
// A dialog opened from the search — the item-limit popup is the one you can
// actually reach, by tapping a suggestion with the list already full — does not
// take focus when it opens, so the screen stays up behind it. Dismissing it is
// what moves focus: onto the dialog's own button, which blurs the field and
// starts the slide down, and then straight back onto the field, because
// AppModal hands focus to whatever was focused when it opened.
//
// That focus lands mid-slide, and expand() used to read `expanded` as "already
// a screen" and do nothing. A moment later the slide it ignored settled and
// turned `expanded` off underneath it. The field kept focus and the keyboard
// stayed up, so no further focus event was ever coming: the search was stuck as
// a 275px dropdown in the middle of an empty screen for the rest of the
// session, which is the layout this whole module exists to avoid.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AddItemForm from '../src/components/AddItemForm.vue'

const PRODUCTS = [
  { name: 'Apa Plata 2L', maker: 'Dorna' },
  { name: 'Banane 1kg', maker: null },
]

let wrapper = null
let realMatchMedia

// happy-dom measures everything as zero, and a zero delta is the one case
// collapse() settles synchronously — the very window this is about would not
// exist. Give the row and its slot real, different positions so the slide is a
// slide.
function measureAsPhone() {
  wrapper.find('.add-row').element.getBoundingClientRect = () => ({ top: 100, height: 56 })
  wrapper.find('.add-slot').element.getBoundingClientRect = () => ({ top: 300, height: 56 })
}

beforeEach(() => {
  vi.useFakeTimers()
  realMatchMedia = window.matchMedia
  // Phone width, and motion not reduced: both queries have to answer for the
  // slide to run at all.
  window.matchMedia = (query) => ({
    matches: query.includes('599.98px'),
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

async function focusIntoSearch() {
  wrapper = mount(AddItemForm, { props: { name: 'coca', suggestions: PRODUCTS } })
  await wrapper.find('input').trigger('focus')
  await flushPromises()
  measureAsPhone()
  expect(wrapper.find('.add-form').classes()).toContain('add-form--expanded')
}

describe('the phone search screen and a dialog that hands focus back', () => {
  it('stays a screen when the field is refocused mid-collapse', async () => {
    await focusIntoSearch()

    // Tapping the dialog's button blurs the field: the slide down begins.
    await wrapper.find('input').trigger('blur')
    await flushPromises()
    expect(wrapper.find('.add-form').classes()).toContain('add-form--closing')

    // The dialog closes and gives the field its focus back, mid-slide.
    await wrapper.find('input').trigger('focus')
    await flushPromises()

    // Past the slide's own fallback timer, which is what used to end it.
    vi.advanceTimersByTime(500)
    await flushPromises()

    expect(wrapper.find('.add-form').classes()).toContain('add-form--expanded')
    expect(wrapper.find('.add-form').classes()).not.toContain('add-form--closing')
    expect(wrapper.find('.add-cover').exists()).toBe(true)
  })

  it('still comes down when the field is left alone', async () => {
    await focusIntoSearch()

    await wrapper.find('input').trigger('blur')
    await flushPromises()

    vi.advanceTimersByTime(500)
    await flushPromises()

    expect(wrapper.find('.add-form').classes()).not.toContain('add-form--expanded')
    expect(wrapper.find('.add-cover').exists()).toBe(false)
  })
})
