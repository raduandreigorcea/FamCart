// @vitest-environment happy-dom
//
// The suggestions dropdown: what it shows, and that picking never races the
// input's blur (the options use mousedown, not click, for exactly that reason).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AddItemForm from '../src/components/AddItemForm.vue'

const PRODUCTS = [
  { name: 'Apa Plata 2L', maker: 'Dorna' },
  { name: 'Banane 1kg', maker: null },
]

// What the phone search screen opens on before anything is typed.
const RECENTS = [
  { name: 'Paine Alba', maker: 'Vel Pitar' },
  { name: 'Oua M 10 buc', maker: null },
]

async function mountForm(props = {}) {
  const wrapper = mount(AddItemForm, {
    props: {
      name: 'apa',
      quantity: 1,
      suggestions: [],
      suggestionsLoading: false,
      canAddCustom: false,
      ...props,
    },
  })
  // The dropdown only exists while the input has focus.
  await wrapper.find('input').trigger('focus')
  return wrapper
}

const hatch = (wrapper) => wrapper.find('.suggestion--custom')

describe('AddItemForm suggestions', () => {
  it('stays closed when there is nothing to offer', async () => {
    const wrapper = await mountForm()
    expect(wrapper.find('.suggestions-wrap').exists()).toBe(false)
  })

  it('stays closed while the input is not focused', () => {
    const wrapper = mount(AddItemForm, {
      props: { name: 'apa', quantity: 1, suggestions: PRODUCTS, canAddCustom: true },
    })
    expect(wrapper.find('.suggestions-wrap').exists()).toBe(false)
  })

  it('lists the matches with their makers', async () => {
    const wrapper = await mountForm({ suggestions: PRODUCTS })
    const names = wrapper.findAll('.suggestion-name').map((n) => n.text())
    expect(names).toEqual(['Apa Plata 2L', 'Banane 1kg'])
    expect(wrapper.findAll('.suggestion-maker').map((m) => m.text())).toEqual(['Dorna'])
  })

  it('reports the picked product rather than filling the input', async () => {
    const wrapper = await mountForm({ suggestions: PRODUCTS })
    await wrapper.findAll('.suggestion')[0].trigger('mousedown')

    expect(wrapper.emitted('select')[0][0]).toEqual(PRODUCTS[0])
    // Picking must not touch the input's value — the parent adds it outright.
    expect(wrapper.emitted('update:name')).toBeUndefined()
  })

  it('opens for the escape hatch alone when nothing matched', async () => {
    const wrapper = await mountForm({ suggestions: [], canAddCustom: true })

    expect(wrapper.find('.suggestions-wrap').exists()).toBe(true)
    expect(wrapper.findAll('.suggestion')).toHaveLength(1)
    expect(hatch(wrapper).text()).toContain("Can't find it?")
  })

  it('offers the escape hatch below the matches when there are some', async () => {
    const wrapper = await mountForm({ suggestions: PRODUCTS, canAddCustom: true })

    const rows = wrapper.findAll('.suggestion')
    expect(rows).toHaveLength(3)
    // Last, so it never displaces a real product.
    expect(rows[2].classes()).toContain('suggestion--custom')
  })

  it('hides the escape hatch when the parent says the query is too short', async () => {
    const wrapper = await mountForm({ suggestions: PRODUCTS, canAddCustom: false })
    expect(hatch(wrapper).exists()).toBe(false)
  })

  it('asks the parent to open the custom-product modal', async () => {
    const wrapper = await mountForm({ suggestions: [], canAddCustom: true })
    await hatch(wrapper).trigger('mousedown')
    expect(wrapper.emitted('add-custom')).toHaveLength(1)
  })

  // While a search is running the dropdown must not answer the question it is
  // still asking: no stale matches, and above all no "Can't find it?".
  describe('while a search is running', () => {
    it('opens with skeleton rows before any match has arrived', async () => {
      const wrapper = await mountForm({ suggestions: [], suggestionsLoading: true })

      expect(wrapper.find('.suggestions-wrap').exists()).toBe(true)
      expect(wrapper.findAll('.suggestion-skeleton').length).toBeGreaterThan(0)
    })

    it('does not offer the escape hatch mid-search', async () => {
      const wrapper = await mountForm({ suggestions: [], suggestionsLoading: true, canAddCustom: true })
      expect(hatch(wrapper).exists()).toBe(false)
    })

    it('hides the previous query matches rather than passing them off as this one', async () => {
      const wrapper = await mountForm({ suggestions: PRODUCTS, suggestionsLoading: true, canAddCustom: true })

      expect(wrapper.findAll('.suggestion')).toHaveLength(0)
      expect(wrapper.findAll('.suggestion-skeleton').length).toBeGreaterThan(0)
    })

    it('marks the list busy for screen readers', async () => {
      const wrapper = await mountForm({ suggestions: [], suggestionsLoading: true })
      expect(wrapper.find('.suggestions').attributes('aria-busy')).toBe('true')
    })

    it('swaps the skeletons for the real rows once the search settles', async () => {
      const wrapper = await mountForm({ suggestions: [], suggestionsLoading: true, canAddCustom: true })
      await wrapper.setProps({ suggestions: PRODUCTS, suggestionsLoading: false })

      expect(wrapper.findAll('.suggestion-skeleton')).toHaveLength(0)
      expect(wrapper.findAll('.suggestion-name').map((n) => n.text())).toEqual([
        'Apa Plata 2L',
        'Banane 1kg',
        "Can't find it?",
      ])
      expect(wrapper.find('.suggestions').attributes('aria-busy')).toBe('false')
    })
  })

  // Every control in the add row swallows mousedown to hold focus in the input.
  // preventDefault there suppresses the focus move and nothing else, so the
  // button stays an ordinary submit button and the browser submits on click.
  // happy-dom does not implement implicit form submission, so this pins the two
  // halves it can see; the click path itself is browser spec.
  it('leaves the add button submitting the form', async () => {
    const wrapper = await mountForm()

    expect(wrapper.find('.add-btn').attributes('type')).toBe('submit')

    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('submit')).toHaveLength(1)
  })

  it('keeps focus in the input when a row is pressed, so blur cannot beat it', async () => {
    const wrapper = await mountForm({ suggestions: PRODUCTS, canAddCustom: true })

    for (const row of wrapper.findAll('.suggestion')) {
      const event = new Event('mousedown', { bubbles: true, cancelable: true })
      row.element.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }
  })

  // On a phone the form lifts to the top of the screen so the dropdown gets the
  // whole screen rather than the slot between the topbar and the keyboard.
  // Above 600px none of this happens, which every test above relies on.
  describe('on a phone', () => {
    let realMatchMedia

    const stubViewport = (isPhone) => {
      window.matchMedia = (query) => ({
        matches: isPhone && query.includes('599.98px'),
        media: query,
        addEventListener() {},
        removeEventListener() {},
      })
    }

    beforeEach(() => {
      realMatchMedia = window.matchMedia
      stubViewport(true)
    })

    afterEach(() => {
      window.matchMedia = realMatchMedia
    })

    it('lifts the form and covers the list when the input takes focus', async () => {
      const wrapper = await mountForm({ suggestions: PRODUCTS })

      expect(wrapper.find('.add-form').classes()).toContain('add-form--expanded')
      expect(wrapper.find('.add-cover').exists()).toBe(true)
      expect(wrapper.emitted('update:expanded').at(-1)).toEqual([true])
    })

    it('sizes the screen to the viewport rather than capping the list', async () => {
      const wrapper = await mountForm({ suggestions: PRODUCTS })
      await flushPromises()

      // The screen is measured; the list simply fills what is left of it, so
      // nothing caps the rows themselves any more.
      expect(wrapper.find('.add-form').attributes('style')).toMatch(/height:\s*\d+px/)
      expect(wrapper.find('.suggestions').attributes('style')).toBeUndefined()
    })

    it('offers a way out that the keyboard cannot cover', async () => {
      const wrapper = await mountForm({ suggestions: PRODUCTS })
      const back = wrapper.find('.back-btn')
      expect(back.exists()).toBe(true)

      // Same contract as the option rows: pressing it must not move focus first.
      const event = new Event('mousedown', { bubbles: true, cancelable: true })
      back.element.dispatchEvent(event)
      await flushPromises()

      expect(event.defaultPrevented).toBe(true)
      expect(wrapper.find('.add-form').classes()).not.toContain('add-form--expanded')
    })

    // Enter on a focused back button sends click, never mousedown.
    it('also closes from the keyboard', async () => {
      const wrapper = await mountForm({ suggestions: PRODUCTS })
      await wrapper.find('.back-btn').trigger('click')

      expect(wrapper.find('.add-form').classes()).not.toContain('add-form--expanded')
    })

    // A leave transition here would keep the button mounted past the moment the
    // band loses its padding, and it would then take ordinary layout above the
    // field and shove the field — just landed — back down for the length of the
    // fade. It has to be gone the instant the screen is.
    it('takes the way out with it, leaving nothing above the field', async () => {
      const wrapper = await mountForm({ suggestions: PRODUCTS })
      expect(wrapper.find('.back-btn').exists()).toBe(true)

      await wrapper.find('input').trigger('blur')
      await flushPromises()

      expect(wrapper.find('.add-form').classes()).not.toContain('add-form--expanded')
      expect(wrapper.find('.add-head__bar').exists()).toBe(false)
    })

    it('stays open while the quantity is set', async () => {
      const wrapper = await mountForm({ suggestions: PRODUCTS, quantity: 1 })

      // The press must not move focus off the input, or the blur would put the
      // whole screen away mid-flow.
      for (const btn of wrapper.findAll('.qty-btn')) {
        const event = new Event('mousedown', { bubbles: true, cancelable: true })
        btn.element.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(true)
      }

      await wrapper.findAll('.qty-btn')[1].trigger('click')

      expect(wrapper.emitted('update:quantity').at(-1)).toEqual([2])
      expect(wrapper.find('.add-form').classes()).toContain('add-form--expanded')
    })

    it('stays open when the add button is pressed', async () => {
      const wrapper = await mountForm({ suggestions: PRODUCTS })

      const event = new Event('mousedown', { bubbles: true, cancelable: true })
      wrapper.find('.add-btn').element.dispatchEvent(event)

      expect(event.defaultPrevented).toBe(true)
      expect(wrapper.find('.add-form').classes()).toContain('add-form--expanded')
    })

    // The list is behind the screen, so the tap has no other visible result.
    describe('confirming an add', () => {
      it('names what landed on the list', async () => {
        const wrapper = await mountForm({ suggestions: PRODUCTS })
        await wrapper.setProps({ lastAdded: { name: 'Lapte 3.5% 1L', maker: 'Napolact' } })

        expect(wrapper.find('.added-row__name').text()).toBe('Lapte 3.5% 1L')
        expect(wrapper.find('.added-row__note').text()).toBe('Added to your list')
      })

      it('announces it to a screen reader', async () => {
        const wrapper = await mountForm({ suggestions: PRODUCTS })
        const region = wrapper.find('.added-slot')

        // The live region has to pre-exist the news for it to be announced.
        expect(region.exists()).toBe(true)
        expect(region.attributes('aria-live')).toBe('polite')
      })

      it('takes it back when the add turns out to have failed', async () => {
        const wrapper = await mountForm({ suggestions: PRODUCTS })
        await wrapper.setProps({ lastAdded: { name: 'Lapte 3.5% 1L', maker: null } })
        expect(wrapper.find('.added-row').exists()).toBe(true)

        await wrapper.setProps({ lastAdded: null })
        expect(wrapper.find('.added-row').exists()).toBe(false)
      })

      it('says nothing on a wider screen, where the list is in plain sight', async () => {
        stubViewport(false)
        const wrapper = await mountForm({ suggestions: PRODUCTS })
        await wrapper.setProps({ lastAdded: { name: 'Lapte 3.5% 1L', maker: null } })

        expect(wrapper.find('.added-row').exists()).toBe(false)
      })
    })

    it('opens on what the household buys before anything is typed', async () => {
      const wrapper = await mountForm({ name: '', suggestions: [], recents: RECENTS })

      expect(wrapper.find('.suggestions-label').text()).toBe('Buy again')
      expect(wrapper.findAll('.suggestion-name').map((n) => n.text())).toEqual([
        'Paine Alba',
        'Oua M 10 buc',
      ])
    })

    it('drops the usuals the moment there is a query to answer', async () => {
      const wrapper = await mountForm({ name: 'apa', suggestions: PRODUCTS, recents: RECENTS })

      expect(wrapper.find('.suggestions-label').exists()).toBe(false)
      expect(wrapper.findAll('.suggestion-name').map((n) => n.text())).toEqual([
        'Apa Plata 2L',
        'Banane 1kg',
      ])
    })

    it('tells a household with no history what to do with the empty screen', async () => {
      const wrapper = await mountForm({ name: '', suggestions: [], recents: [] })

      expect(wrapper.find('.suggestions-hint').text()).toBe('Type a product name to search.')
      expect(wrapper.find('.suggestions-label').exists()).toBe(false)
    })

    it('never shows the usuals on a wider screen, which has no room for them', async () => {
      stubViewport(false)
      const wrapper = await mountForm({ name: '', suggestions: [], recents: RECENTS })

      expect(wrapper.find('.suggestions-wrap').exists()).toBe(false)
    })

    it('holds the gap the form leaves behind, so the list below cannot jump', async () => {
      const wrapper = await mountForm({ suggestions: PRODUCTS })
      expect(wrapper.find('.add-slot').attributes('style')).toMatch(/height:/)

      await wrapper.find('input').trigger('blur')
      expect(wrapper.find('.add-slot').attributes('style')).toBeUndefined()
    })

    it('puts the form back when the input is blurred', async () => {
      const wrapper = await mountForm({ suggestions: PRODUCTS })
      await wrapper.find('input').trigger('blur')

      expect(wrapper.find('.add-form').classes()).not.toContain('add-form--expanded')
      expect(wrapper.emitted('update:expanded').at(-1)).toEqual([false])
    })

    it('puts the form back on Escape', async () => {
      const wrapper = await mountForm({ suggestions: PRODUCTS })
      await wrapper.find('input').trigger('keydown.esc')

      expect(wrapper.find('.add-form').classes()).not.toContain('add-form--expanded')
      expect(wrapper.find('.suggestions-wrap').exists()).toBe(false)
    })

    // Same contract as the option rows: the cover must close search without
    // the tap itself moving focus first.
    it('closes when the cover is pressed, without stealing focus', async () => {
      const wrapper = await mountForm({ suggestions: PRODUCTS })

      const event = new Event('mousedown', { bubbles: true, cancelable: true })
      wrapper.find('.add-cover').element.dispatchEvent(event)
      await flushPromises()

      expect(event.defaultPrevented).toBe(true)
      expect(wrapper.find('.add-form').classes()).not.toContain('add-form--expanded')
    })

    it('leaves a wider screen entirely alone', async () => {
      stubViewport(false)
      const wrapper = await mountForm({ suggestions: PRODUCTS })

      expect(wrapper.find('.add-form').classes()).not.toContain('add-form--expanded')
      expect(wrapper.find('.add-cover').exists()).toBe(false)
      expect(wrapper.find('.suggestions').attributes('style')).toBeUndefined()
    })
  })
})
