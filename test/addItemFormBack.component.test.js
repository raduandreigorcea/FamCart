// @vitest-environment happy-dom
//
// What Android's Back button does to the add-item search.
//
// The press itself is handled in lib/nativeBack, which asks lib/modalStack to
// close whatever is in front of the page and only leaves the app when there is
// nothing. The form is not an AppModal and not a PopoverMenu, so it fell through
// both registration paths and the press went straight past it to exitApp() —
// closing the app from under a half-typed search. This pins the registration
// that fixes that: focus puts the form on the stack, blur takes it off.
//
// Its own file rather than a block in addItemForm.component.test.js because the
// stack is module state and that file leaves forms mounted; a separate file gets
// a fresh module registry and can assert on an empty stack.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AddItemForm from '../src/components/AddItemForm.vue'
import { closeTopModal, hasOpenModal } from '../src/lib/modalStack'

const PRODUCTS = [
  { name: 'Apa Plata 2L', maker: 'Dorna' },
  { name: 'Banane 1kg', maker: null },
]

// Unmounted after every test, so no layer outlives the form that opened it.
let wrapper = null

function mountForm(props = {}) {
  wrapper = mount(AddItemForm, {
    props: { name: 'apa', suggestions: PRODUCTS, ...props },
  })
  return wrapper
}

afterEach(() => {
  if (wrapper) wrapper.unmount()
  wrapper = null
})

describe('the add form and the Back press', () => {
  it('is not something Back closes until the field is focused', async () => {
    mountForm()
    await flushPromises()

    // Nothing painted over the page, so the press falls through to the router —
    // which on Home means leaving, and correctly so.
    expect(hasOpenModal()).toBe(false)
    expect(closeTopModal()).toBe(false)
  })

  it('becomes the thing Back closes as soon as the field is focused', async () => {
    mountForm()
    await wrapper.find('input').trigger('focus')
    await flushPromises()

    expect(hasOpenModal()).toBe(true)
  })

  it('takes the press itself rather than letting the app exit', async () => {
    mountForm()
    await wrapper.find('input').trigger('focus')
    await flushPromises()

    // true is what nativeBack reads as "handled" — the one thing standing
    // between a focused field and App.exitApp().
    expect(closeTopModal()).toBe(true)
    await flushPromises()

    expect(document.activeElement).not.toBe(wrapper.find('input').element)
    expect(wrapper.find('.suggestions-wrap').exists()).toBe(false)
  })

  it('stops being the press\'s business once the field is blurred by hand', async () => {
    mountForm()
    await wrapper.find('input').trigger('focus')
    await flushPromises()
    await wrapper.find('input').trigger('blur')
    await flushPromises()

    expect(hasOpenModal()).toBe(false)
  })

  it('leaves nothing on the stack when the form goes away', async () => {
    mountForm()
    await wrapper.find('input').trigger('focus')
    await flushPromises()
    expect(hasOpenModal()).toBe(true)

    wrapper.unmount()
    wrapper = null

    // A layer outliving its component could never be closed again — Back would
    // call into a dead form for the rest of the session.
    expect(hasOpenModal()).toBe(false)
  })

  // The lifted phone screen is the case this was written for: full screen, over
  // the list, with the keyboard up and a query typed into it.
  describe('on a phone, where the form is a whole screen', () => {
    let realMatchMedia

    beforeEach(() => {
      realMatchMedia = window.matchMedia
      window.matchMedia = (query) => ({
        matches: query.includes('599.98px'),
        media: query,
        addEventListener() {},
        removeEventListener() {},
      })
    })

    afterEach(() => {
      window.matchMedia = realMatchMedia
    })

    it('puts the search screen away instead of the app', async () => {
      mountForm()
      await wrapper.find('input').trigger('focus')
      await flushPromises()
      expect(wrapper.find('.add-form').classes()).toContain('add-form--expanded')

      expect(closeTopModal()).toBe(true)
      await flushPromises()

      expect(wrapper.find('.add-form').classes()).not.toContain('add-form--expanded')
      expect(wrapper.find('.add-cover').exists()).toBe(false)
      // And the press is spent: a second one has nothing left to close and falls
      // through to the router, which is how Back gets you out of the app from
      // the list itself.
      expect(closeTopModal()).toBe(false)
    })
  })
})
