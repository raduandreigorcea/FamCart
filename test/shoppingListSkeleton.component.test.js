// @vitest-environment happy-dom
//
// The skeleton and the real list are two separate <ul>s stacked in normal flow.
// Nothing stopped them rendering at once, so during a family switch (which
// repopulates items while the switch is still marked in progress) the
// placeholders sat on top of the very rows they stand in for, and the rows
// jumped up as the skeletons unmounted. They are mutually exclusive now.
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ShoppingList from '../src/components/ShoppingList.vue'

const item = (id, name) => ({
  id,
  family_id: 'fam-1',
  name,
  quantity: 1,
  checked: false,
  added_by: 'user-1',
  created_at: '2026-01-01T00:00:00.000Z',
})

const mountList = (props) =>
  mount(ShoppingList, {
    props: { items: [], memberProfiles: new Map(), loading: false, showEmpty: false, ...props },
  })

describe('skeleton and real rows are never on screen together', () => {
  it('shows only skeletons while loading, even when items are already present', () => {
    const wrapper = mountList({ items: [item('a', 'Milk'), item('b', 'Bread')], loading: true })

    expect(wrapper.findAll('.skeleton-item').length).toBeGreaterThan(0)
    expect(wrapper.findAll('.item')).toHaveLength(0)
  })

  it('shows only the rows once loading ends', () => {
    const wrapper = mountList({ items: [item('a', 'Milk'), item('b', 'Bread')], loading: false })

    expect(wrapper.findAll('.skeleton-item')).toHaveLength(0)
    expect(wrapper.findAll('.item')).toHaveLength(2)
  })

  it('holds back the "to buy" header while loading, so it does not sit over placeholders', () => {
    expect(mountList({ items: [item('a', 'Milk')], loading: true }).find('.list-meta').exists()).toBe(false)
    expect(mountList({ items: [item('a', 'Milk')], loading: false }).find('.list-meta').exists()).toBe(true)
  })

  it('still shows skeletons on a genuinely empty first load', () => {
    const wrapper = mountList({ loading: true })

    expect(wrapper.findAll('.skeleton-item').length).toBeGreaterThan(0)
    expect(wrapper.findAll('.item')).toHaveLength(0)
  })
})
