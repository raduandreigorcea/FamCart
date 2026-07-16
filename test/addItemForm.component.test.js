// @vitest-environment happy-dom
//
// The suggestions dropdown: what it shows, and that picking never races the
// input's blur (the options use mousedown, not click, for exactly that reason).
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AddItemForm from '../src/components/AddItemForm.vue'

const PRODUCTS = [
  { name: 'Apa Plata 2L', maker: 'Dorna' },
  { name: 'Banane 1kg', maker: null },
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

  it('keeps focus in the input when a row is pressed, so blur cannot beat it', async () => {
    const wrapper = await mountForm({ suggestions: PRODUCTS, canAddCustom: true })

    for (const row of wrapper.findAll('.suggestion')) {
      const event = new Event('mousedown', { bubbles: true, cancelable: true })
      row.element.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }
  })
})
