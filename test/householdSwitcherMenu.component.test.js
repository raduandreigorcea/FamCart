// @vitest-environment happy-dom
//
// The household switcher: which household's list you are looking at.
//
// These assertions largely moved here from appNavBarAccount, where they covered
// the same rows while they lived in the account dialog. The behaviour is the
// contract, not the address, so it kept its tests when it moved.
import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import HouseholdSwitcherMenu from '../src/components/HouseholdSwitcherMenu.vue'

const wrappers = []

// PopoverMenu teleports to <body>, so the rows are not inside the wrapper's own
// element. attachTo puts the whole thing in the document and `document` is what
// the queries below read.
function mountMenu(props = {}) {
  const w = mount(HouseholdSwitcherMenu, {
    props: { modelValue: true, ...props },
    attachTo: document.body,
  })
  wrappers.push(w)
  return w
}

const rows = () => [...document.querySelectorAll('.switcher-item')]
const names = () => rows().map((r) => r.querySelector('.switcher-name').textContent.trim())
const addRow = () => document.querySelector('.switcher-add')

const two = [
  { id: 'fam-1', name: 'Home', emoji: 'E1' },
  { id: 'fam-2', name: 'Parents', emoji: 'E2' },
]

afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
  document.body.innerHTML = ''
})

describe('HouseholdSwitcherMenu', () => {
  it('lists every household, marks the active one, and emits a switch', async () => {
    const wrapper = mountMenu({ households: two, householdId: 'fam-1' })

    expect(names()).toEqual(['Home', 'Parents'])
    expect(rows()[0].getAttribute('aria-checked')).toBe('true')
    expect(rows()[1].getAttribute('aria-checked')).toBe('false')
    expect(rows()[0].querySelector('.switcher-item__hint').textContent.trim()).toBe('Current')

    rows()[1].click()
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('switch-household')?.[0]).toEqual(['fam-2'])
  })

  // Not an error and not a switch: somebody confirming where they are. The menu
  // closes and the parent is never asked to refetch a household it is already on.
  it('closes without switching when the active household is picked', async () => {
    const wrapper = mountMenu({ households: two, householdId: 'fam-1' })

    rows()[0].click()
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('switch-household')).toBeFalsy()
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
  })

  // The case most accounts are in. There is nothing to switch to, and the menu
  // is still worth opening: this is the only door to a second household.
  it('still offers joining when there is only one household', () => {
    mountMenu({ households: [{ id: 'fam-1', name: 'Home' }], householdId: 'fam-1' })

    expect(names()).toEqual(['Home'])
    expect(addRow()).not.toBeNull()
  })

  it('drops the join row at the cap of three', () => {
    mountMenu({
      households: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      householdId: 'a',
    })

    expect(rows()).toHaveLength(3)
    // Nowhere left to go: the row would open a screen that can only refuse.
    expect(addRow()).toBeNull()
  })

  it('emits add-household from the join row and closes', async () => {
    const wrapper = mountMenu({ households: two, householdId: 'fam-1' })

    addRow().click()
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('add-household')).toBeTruthy()
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
  })

  // A household wears its own emoji where the app's other menu rows wear an
  // icon: it identifies one particular household rather than naming a kind of
  // destination.
  it('marks each row with that household own emoji', () => {
    mountMenu({ households: two, householdId: 'fam-1' })

    expect(rows().map((r) => r.querySelector('.switcher-emoji').textContent.trim())).toEqual([
      'E1',
      'E2',
    ])
  })

  it('falls back to a default emoji and name', () => {
    mountMenu({ households: [{ id: 'fam-1', name: '' }], householdId: 'fam-1' })

    expect(rows()[0].querySelector('.switcher-emoji').textContent.trim()).not.toBe('')
    expect(names()).toEqual(['Household'])
  })

  // A role="menu" exposes only its menuitems, so anything in here without a
  // role is not one of this menu's children and can be left out of what a
  // screen reader announces. The join row is the one that had no role, and it
  // is the only thing in here most accounts will ever press.
  //
  // The switch rows are menuitemradio and the join row is not, deliberately:
  // the rows answer "which household", and this one leaves to go and make one.
  it('gives every row in the menu a role, and the right one', () => {
    mountMenu({ households: two, householdId: 'fam-1' })

    expect(rows().map((r) => r.getAttribute('role'))).toEqual([
      'menuitemradio',
      'menuitemradio',
    ])
    expect(addRow().getAttribute('role')).toBe('menuitem')

    // The line above the join row draws a division a screen reader could not
    // otherwise hear, and it uses the shell's shared divider rather than a
    // copy of it.
    const divider = document.querySelector('.menu-divider')
    expect(divider).not.toBeNull()
    expect(divider.getAttribute('role')).toBe('separator')
    expect(document.querySelector('.switcher-divider')).toBeNull()
  })

  // On a phone this is a full-width sheet over the bottom bar: the surface you
  // would tap to dismiss is the list you are trying to look at, and the thing
  // under your thumb is the bar the sheet is covering. Escape and Android Back
  // still work; this is the route that is actually visible.
  it('offers a way out of the sheet', async () => {
    const wrapper = mountMenu({ households: two, householdId: 'fam-1' })

    const closeBtn = document.querySelector('.popover-header__close')
    expect(closeBtn).not.toBeNull()
    // In the header, which sits outside the role="menu" — so it is an ordinary
    // button rather than a child a menu is not allowed to have.
    expect(closeBtn.closest('[role="menu"]')).toBeNull()

    closeBtn.click()
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
    // Closing is not choosing: nothing was switched on the way out.
    expect(wrapper.emitted('switch-household')).toBeFalsy()
  })
})
