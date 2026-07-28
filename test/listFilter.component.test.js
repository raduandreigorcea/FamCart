// @vitest-environment happy-dom
//
// The list filter. Ticking a row leaves it in place, so a long list mixes what
// you still need with what is already in the cart; the button in the list
// header is the way back out of that.
//
// The load-bearing case is the buy bar. A filter hides rows, it does not remove
// them, so filtering to "To buy" must not take away the control that checks the
// hidden ones out — that would strand them with no way to reach the cart short
// of guessing which filter brings it back.
import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ListFilterMenu from '../src/components/ListFilterMenu.vue'
import ShoppingList from '../src/components/ShoppingList.vue'

const item = (id, checked) => ({
  id,
  name: `Item ${id}`,
  checked,
  quantity: 1,
  added_by: 'user-1',
})

const MIXED = [item('a', false), item('b', true), item('c', false)]

// Teleported to body, so the menu is not inside the wrapper's own tree — and so
// a wrapper left mounted would leave its menu in the document for the next test
// to find. Everything mounted here is torn down between cases.
const menuItems = () => [...document.querySelectorAll('.menu-item')]
const menuOpen = () => Boolean(document.querySelector('.popover-panel'))

const mounted = []
const realMatchMedia = window.matchMedia

// The component asks matchMedia which layout it is in, and happy-dom has no
// real viewport to answer from.
function setViewport(wide) {
  window.matchMedia = (query) => ({
    matches: wide && query.includes('min-width: 600px'),
    addEventListener() {},
    removeEventListener() {},
  })
}

afterEach(() => {
  while (mounted.length) mounted.pop().unmount()
  document.body.innerHTML = ''
  window.matchMedia = realMatchMedia
})

function mountMenu(props = {}) {
  const wrapper = mount(ListFilterMenu, {
    props: { items: MIXED, modelValue: 'all', ...props },
    attachTo: document.body,
  })
  mounted.push(wrapper)
  return wrapper
}

const mountList = (props = {}) =>
  mount(ShoppingList, { props: { items: MIXED, loading: false, ...props } })

const names = (wrapper) => wrapper.findAll('.item-name').map((n) => n.text())

describe('the filter button', () => {
  it('keeps the menu shut until asked', () => {
    const wrapper = mountMenu()
    expect(menuOpen()).toBe(false)
    expect(wrapper.find('.filter-btn').attributes('aria-expanded')).toBe('false')
  })

  it('opens the menu on press', async () => {
    const wrapper = mountMenu()
    await wrapper.find('.filter-btn').trigger('click')
    expect(menuOpen()).toBe(true)
    const text = (selector) =>
      menuItems().map((i) => i.querySelector(selector).textContent.trim())
    expect(text('.filter-option__label')).toEqual(['Everything', 'To buy', 'In cart'])
    expect(text('.filter-option__count')).toEqual(['3', '2', '1'])
  })

  // A filtered list that looks unfiltered is how items get declared missing.
  it('marks itself while it is hiding something', () => {
    expect(mountMenu({ modelValue: 'all' }).find('.filter-btn__dot').exists()).toBe(false)
    const filtered = mountMenu({ modelValue: 'checked' })
    expect(filtered.find('.filter-btn__dot').exists()).toBe(true)
    expect(filtered.find('.filter-btn').attributes('aria-label')).toContain('filtered')
  })

  it('reports a pick and closes, without changing the view itself', async () => {
    const wrapper = mountMenu()
    await wrapper.find('.filter-btn').trigger('click')
    await menuItems()[1].click()
    expect(wrapper.emitted('update:modelValue')).toEqual([['active']])
    expect(menuOpen()).toBe(false)
  })

  it('tells assistive tech which view is chosen', async () => {
    const wrapper = mountMenu({ modelValue: 'checked' })
    await wrapper.find('.filter-btn').trigger('click')
    expect(menuItems().map((i) => i.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'true',
    ])
  })

  it('hangs the popover off the button on a wide screen', async () => {
    setViewport(true)
    const wrapper = mountMenu()
    await wrapper.find('.filter-btn').trigger('click')
    expect(document.querySelector('.popover-panel').getAttribute('style')).toMatch(/top:.*right:/)
  })

  // On a phone the menu is a bottom sheet whose position the stylesheet owns.
  // An inline top/right measured from the button would beat that media query
  // and leave the sheet floating mid-screen.
  it('leaves the bottom sheet to the stylesheet on a phone', async () => {
    setViewport(false)
    const wrapper = mountMenu()
    await wrapper.find('.filter-btn').trigger('click')
    expect(document.querySelector('.popover-panel').getAttribute('style')).toBeNull()
  })

  it('counts from the list it filters', async () => {
    const wrapper = mountMenu({ items: [item('a', true), item('b', true)] })
    await wrapper.find('.filter-btn').trigger('click')
    expect([...document.querySelectorAll('.filter-option__count')].map((c) => c.textContent)).toEqual([
      '2',
      '0',
      '2',
    ])
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
    expect(mountList({ items: [item('a', false)], filter: 'active' }).find('.buy-bar').exists()).toBe(
      false,
    )
  })

  it('names whichever list is on screen', () => {
    const toBuy = mountList({ filter: 'all' })
    expect(toBuy.find('.list-meta__label').text()).toBe('To buy')
    expect(toBuy.find('.list-meta__count').text()).toBe('2 left')

    const cart = mountList({ filter: 'checked' })
    expect(cart.find('.list-meta__label').text()).toBe('In cart')
    expect(cart.find('.list-meta__count').text()).toBe('1 item')
  })

  // The header carries the filter button, so hiding it while the cart is on
  // screen — or once everything is ticked — would remove the only way back.
  it('keeps the header, and the button, in every filter state', () => {
    for (const filter of ['all', 'active', 'checked']) {
      expect(mountList({ filter }).find('.filter-btn').exists()).toBe(true)
    }
    const allTicked = mountList({ items: [item('a', true)], filter: 'all' })
    expect(allTicked.find('.filter-btn').exists()).toBe(true)
  })

  it('has no header to show before there is a list', () => {
    expect(mountList({ items: [], loading: true }).find('.list-meta').exists()).toBe(false)
    expect(mountList({ items: [], loading: false }).find('.list-meta').exists()).toBe(false)
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
    expect(
      mountList({ items: [], loading: true, filter: 'checked' }).find('.filter-empty').exists(),
    ).toBe(false)
  })
})
