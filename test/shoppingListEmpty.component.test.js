// @vitest-environment happy-dom
//
// The empty list. An empty grocery list is usually a FINISHED one — checking
// out is what leaves the screen looking like this — so telling an established
// household that their list is empty and inviting them to add their first item
// reads as though something has gone missing. Only a household that has never
// bought anything is actually starting from nothing.
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ShoppingList from '../src/components/ShoppingList.vue'

const ROSTER = new Map([
  ['user-1', { display_name: 'Radu', image_url: null }],
  ['user-2', { display_name: 'Cristina', image_url: null }],
])

const REGULARS = [
  { name: 'Lapte 3.5% 1L', maker: 'Napolact' },
  { name: 'Paine Alba', maker: null },
]

const mountEmpty = (props = {}) =>
  mount(ShoppingList, {
    props: { items: [], showEmpty: true, memberProfiles: ROSTER, ...props },
  })

const title = (wrapper) => wrapper.find('.empty-state__title').text()

describe('the empty list', () => {
  it('reads as finished for a household that has shopped', () => {
    const wrapper = mountEmpty({ hasShopped: true })

    expect(title(wrapper)).toBe('All bought')
    expect(wrapper.find('.empty-state__text').text()).toBe('Nothing left to pick up.')
  })

  it('reads as a beginning for a household that never has', () => {
    const wrapper = mountEmpty({ hasShopped: false })

    expect(title(wrapper)).toBe('Nothing here yet')
    expect(wrapper.find('.empty-state__text').text()).toContain('first thing')
  })

  // The substance of the screen: the next grocery list is largely the last one,
  // so the regulars are here as one tap each rather than as something to read.
  describe('the regulars', () => {
    it('offers them as one tap each', () => {
      const wrapper = mountEmpty({ hasShopped: true, suggestedProducts: REGULARS })
      const chips = wrapper.findAll('.chip')

      expect(chips).toHaveLength(2)
      expect(chips.map((c) => c.find('.chip__name').text())).toEqual(['Lapte 3.5% 1L', 'Paine Alba'])
    })

    it('hands the whole product up, not just its name', async () => {
      const wrapper = mountEmpty({ hasShopped: true, suggestedProducts: REGULARS })
      await wrapper.findAll('.chip')[0].trigger('click')

      expect(wrapper.emitted('add')[0][0]).toEqual(REGULARS[0])
    })

    it('falls back to the words alone for a household with no history', () => {
      const wrapper = mountEmpty({ hasShopped: false, suggestedProducts: [] })

      expect(wrapper.find('.restart').exists()).toBe(false)
      expect(wrapper.find('.empty-state').exists()).toBe(true)
    })

    // The words come from the cached snapshot on the first painted frame; the
    // regulars have to wait for the purchase history that ranks them. Left to
    // itself the screen resolved twice — a title alone, then pills arriving
    // underneath and shoving it up a row.
    describe('while the history that ranks them is still in flight', () => {
      const placeholders = (wrapper) => wrapper.findAll('.chip--skeleton')

      it('holds the space with pills in the same shape', () => {
        const wrapper = mountEmpty({ hasShopped: true, suggestedProductsLoading: true })

        expect(placeholders(wrapper).length).toBeGreaterThan(0)
        // Under the same heading the real ones will land under, so the label
        // does not arrive with them and move everything again.
        expect(wrapper.find('.restart__label').text()).toBe('Buy again')
      })

      it('offers nothing to press, and nothing for a reader to hear', () => {
        const wrapper = mountEmpty({ hasShopped: true, suggestedProductsLoading: true })

        // Spans, not buttons: there is nothing behind them to add yet.
        expect(placeholders(wrapper).every((chip) => chip.element.tagName === 'SPAN')).toBe(true)
        expect(wrapper.findAll('.chip__name')).toHaveLength(0)
        expect(wrapper.find('.restart__chips').attributes('aria-hidden')).toBe('true')
      })

      it('gives way to the real regulars rather than sitting alongside them', async () => {
        const wrapper = mountEmpty({ hasShopped: true, suggestedProductsLoading: true })
        await wrapper.setProps({ suggestedProducts: REGULARS, suggestedProductsLoading: false })

        expect(placeholders(wrapper)).toHaveLength(0)
        expect(wrapper.findAll('.chip')).toHaveLength(2)
      })

      // A household with no history is not waiting for anything, and pills that
      // resolve to nothing are a promise the screen cannot keep.
      it('holds no space for a household that has never shopped', () => {
        const wrapper = mountEmpty({ hasShopped: false, suggestedProductsLoading: false })

        expect(wrapper.find('.restart').exists()).toBe(false)
      })

      // The history came back empty — retention caps it at 30 days, so a
      // household that shopped long enough ago has nothing to offer after all.
      it('takes the whole block away when the answer is that there are none', async () => {
        const wrapper = mountEmpty({ hasShopped: true, suggestedProductsLoading: true })
        await wrapper.setProps({ suggestedProducts: [], suggestedProductsLoading: false })

        expect(wrapper.find('.restart').exists()).toBe(false)
        expect(title(wrapper)).toBe('All bought')
      })
    })
  })

  it('stays out of the way while there are rows to show', () => {
    const wrapper = mount(ShoppingList, {
      props: {
        items: [{ id: 'a', name: 'Paine', checked: false, quantity: 1, added_by: 'user-1' }],
        showEmpty: false,
        memberProfiles: ROSTER,
      },
    })
    expect(wrapper.find('.empty-state').exists()).toBe(false)
  })

  // A first load with nothing yet fetched is not the same as a list with
  // nothing in it, and the skeleton already speaks for that moment.
  it('waits for the load rather than claiming the list is done', () => {
    const wrapper = mountEmpty({ showEmpty: false, loading: true })
    expect(wrapper.find('.empty-state').exists()).toBe(false)
  })
})
