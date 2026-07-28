// @vitest-environment happy-dom
//
// The list filter. Ticking a row leaves it in place, so a long list mixes what
// you still need with what is already in the cart; these chips are the way back
// out of that.
//
// The load-bearing case is the buy bar. A filter hides rows, it does not remove
// them, so filtering to "To buy" must not take away the control that checks the
// hidden ones out — that would strand them with no way to reach the cart short
// of guessing which filter brings it back.
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ListFilterBar from '../src/components/ListFilterBar.vue'
import ShoppingList from '../src/components/ShoppingList.vue'

const item = (id, checked) => ({
  id,
  name: `Item ${id}`,
  checked,
  quantity: 1,
  added_by: 'user-1',
})

const MIXED = [item('a', false), item('b', true), item('c', false)]

const mountBar = (props = {}) =>
  mount(ListFilterBar, { props: { items: MIXED, modelValue: 'all', ...props } })

const mountList = (props = {}) =>
  mount(ShoppingList, { props: { items: MIXED, loading: false, ...props } })

const names = (wrapper) => wrapper.findAll('.item-name').map((n) => n.text())
const chips = (wrapper) => wrapper.findAll('.filter-chip')

describe('ListFilterBar', () => {
  it('offers all three views', () => {
    expect(chips(mountBar()).map((c) => c.text().replace(/\s+/g, ' '))).toEqual([
      'All 3',
      'To buy 2',
      'In cart 1',
    ])
  })

  // The counts come from the items rather than from the parent, so the number on
  // a chip can never disagree with what picking it shows.
  it('counts from the list it filters', () => {
    const wrapper = mountBar({ items: [item('a', true), item('b', true)] })
    expect(chips(wrapper).map((c) => c.text().replace(/\D+/g, ''))).toEqual(['2', '0', '2'])
  })

  it('marks the chosen view for sighted and assistive users alike', () => {
    const wrapper = mountBar({ modelValue: 'checked' })
    const pressed = chips(wrapper).map((c) => c.attributes('aria-pressed'))
    expect(pressed).toEqual(['false', 'false', 'true'])
    expect(chips(wrapper)[2].classes()).toContain('filter-chip--active')
  })

  it('reports a pick without changing the view itself', async () => {
    const wrapper = mountBar()
    await chips(wrapper)[1].trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['active']])
  })
})

describe('the filtered list', () => {
  it('shows everything by default', () => {
    expect(names(mountList())).toEqual(['Item a', 'Item b', 'Item c'])
  })

  it('narrows to what is still to buy, or to what is in the cart', () => {
    expect(names(mountList({ filter: 'active' }))).toEqual(['Item a', 'Item c'])
    expect(names(mountList({ filter: 'checked' }))).toEqual(['Item b'])
  })

  // The whole reason the filter lives in the render and not in the props the
  // buy bar reads.
  it('keeps the buy bar while the checked rows are hidden', () => {
    const wrapper = mountList({ filter: 'active' })
    expect(wrapper.find('.buy-bar').exists()).toBe(true)
    expect(wrapper.find('.buy-bar__label').text()).toContain('1 item')
  })

  it('does not offer a cart that is empty', () => {
    const wrapper = mountList({ items: [item('a', false)], filter: 'active' })
    expect(wrapper.find('.buy-bar').exists()).toBe(false)
  })

  it('drops the "to buy" heading when the cart is what is on screen', () => {
    expect(mountList({ filter: 'all' }).find('.list-meta').exists()).toBe(true)
    expect(mountList({ filter: 'checked' }).find('.list-meta').exists()).toBe(false)
  })

  // Distinct from the empty state: the list has rows, this view has none of them.
  it('explains an empty view without claiming the list is empty', () => {
    const nothingChecked = mountList({ items: [item('a', false)], filter: 'checked' })
    expect(nothingChecked.find('.filter-empty').text()).toBe('Nothing in the cart yet.')
    expect(nothingChecked.find('.empty-state').exists()).toBe(false)

    const allChecked = mountList({ items: [item('a', true)], filter: 'active' })
    expect(allChecked.find('.filter-empty').text()).toBe('Everything here is in the cart.')
  })

  it('says nothing about filters while the first load is still running', () => {
    const wrapper = mountList({ items: [], loading: true, filter: 'checked' })
    expect(wrapper.find('.filter-empty').exists()).toBe(false)
  })
})
