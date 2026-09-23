// @vitest-environment happy-dom
//
// The list's order and its cart. Ticked rows leave the rows to buy for an "In
// cart" section that folds away; "By aisle" groups what is left the way a shop
// is walked. The load-bearing cases: a ticked row is never mixed back in with
// what is still to find, and folding the cart hides only the cart.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ListSortMenu from '../src/components/ListSortMenu.vue'
import ShoppingList from '../src/components/ShoppingList.vue'

const item = (id, name, checked = false) => ({ id, name, checked, quantity: 1, added_by: 'user-1' })
const ITEMS = [item('a', 'Lapte'), item('b', 'Mere', true), item('c', 'Paine')]

const mounted = []
const menuItems = () => [...document.querySelectorAll('.menu-item')]
const names = (wrapper) => wrapper.findAll('.item-name').map((n) => n.text())

beforeEach(() => localStorage.clear())
afterEach(() => {
  while (mounted.length) mounted.pop().unmount()
  document.body.innerHTML = ''
})

function mountList(props = {}) {
  const wrapper = mount(ShoppingList, { props: { items: ITEMS, loading: false, ...props } })
  mounted.push(wrapper)
  return wrapper
}

describe('the list sections', () => {
  it('puts ticked rows in the cart, after everything still to buy', () => {
    const wrapper = mountList()
    expect(names(wrapper)).toEqual(['Lapte', 'Paine', 'Mere'])
    expect(wrapper.find('.cart-toggle').text()).toContain('1')
  })

  it('folds the cart away to its heading and remembers it', async () => {
    const wrapper = mountList()
    await wrapper.find('.cart-toggle').trigger('click')
    expect(names(wrapper)).toEqual(['Lapte', 'Paine'])
    expect(wrapper.find('.cart-toggle').attributes('aria-expanded')).toBe('false')
    expect(names(mountList())).toEqual(['Lapte', 'Paine'])
  })

  it('groups rows to buy under aisle headings when sorted by aisle', () => {
    const wrapper = mountList({ sort: 'aisle' })
    const headings = wrapper.findAll('.list-heading:not(.list-heading--cart)').map((h) => h.text())
    expect(headings).toEqual(['Bakery', 'Dairy & eggs'])
    expect(names(wrapper)).toEqual(['Paine', 'Lapte', 'Mere'])
  })
})

describe('the sort menu', () => {
  it('offers the two orders and reports the pick', async () => {
    const wrapper = mount(ListSortMenu, {
      props: { items: ITEMS, modelValue: 'added' },
      attachTo: document.body,
    })
    mounted.push(wrapper)
    await wrapper.find('.filter-btn').trigger('click')
    expect(menuItems().map((i) => i.querySelector('.filter-option__label').textContent.trim()))
      .toEqual(['As added', 'By aisle'])
    await menuItems()[1].click()
    expect(wrapper.emitted('update:modelValue').at(-1)).toEqual(['aisle'])
  })

  it('carries no filtering mark for an order, which hides nothing', () => {
    const wrapper = mount(ListSortMenu, { props: { items: ITEMS, modelValue: 'aisle' } })
    mounted.push(wrapper)
    expect(wrapper.find('.filter-btn__dot').exists()).toBe(false)
  })
})
