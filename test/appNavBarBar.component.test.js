// @vitest-environment happy-dom
//
// The bottom action bar: the list screen's shell on a phone.
//
// Its own file rather than a block in appNavBarAccount, because that one mounts
// the same component in its other shell — layout="header", which is what
// HouseholdSetupView renders and what comes back at the desktop column. Keeping
// the two apart is what stops a `.topbar` assertion from quietly passing
// against a bar, or the reverse.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import AppNavBar from '../src/components/AppNavBar.vue'

vi.mock('@clerk/vue', () => ({
  useUser: () => ({ user: ref(null) }),
  useClerk: () => ref({ openUserProfile: vi.fn(), signOut: vi.fn() }),
  useAuth: () => ({ userId: ref(null), getToken: ref(async () => null) }),
}))

// AccountActionModal is always mounted inside the bar and asks Supabase for
// notification preferences; stub it so the bar can mount on its own.
vi.mock('../src/supabase', () => ({
  useSupabase: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  }),
  getCatalogSupabase: () => null,
}))

const wrappers = []
function mountBar(props = {}) {
  const w = mount(AppNavBar, {
    props: { layout: 'bar', householdName: 'Gorcea', currentUserId: 'u_self', ...props },
  })
  wrappers.push(w)
  return w
}

afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
})

describe('AppNavBar as the bottom bar', () => {
  it('draws five cells, four of which are buttons', () => {
    const wrapper = mountBar()

    // Five slots, because the fifth is what the fourth is spaced against. Only
    // four of them do anything yet.
    expect(wrapper.findAll('.nav-slot')).toHaveLength(5)
    expect(wrapper.findAll('.navbar button')).toHaveLength(4)
    // A gap rather than a disabled control: a disabled button promises that
    // something is coming, and nothing is, yet.
    expect(wrapper.find('.nav-slot--empty').element.tagName).toBe('SPAN')
    expect(wrapper.find('.nav-slot--empty').attributes('aria-hidden')).toBe('true')
  })

  // Not a generic house icon. The emoji is the one the owner picked, already on
  // the household's row inside the settings dialog, so the thing you press and
  // the row you land on are the same object — and it is what answers "which
  // household" for somebody who belongs to more than one.
  it('marks the household slot with that household own emoji', () => {
    const wrapper = mountBar({ householdEmoji: '🏡' })

    expect(wrapper.find('.nav-slot__mark--emoji').text()).toBe('🏡')
  })

  it('falls back to the default emoji rather than an empty square', () => {
    const wrapper = mountBar({ householdEmoji: '' })

    expect(wrapper.find('.nav-slot__mark--emoji').text()).not.toBe('')
  })

  // The centre button owns nothing: the search is AddItemForm's and its open
  // state is HomeView's, so pressing this only says it was pressed.
  it('reports the add press rather than opening anything itself', async () => {
    const wrapper = mountBar()

    await wrapper.find('.nav-slot--add').trigger('click')

    expect(wrapper.emitted('add')).toHaveLength(1)
  })

  // The visible label is only the verb, because it has to fit under a 44px disc
  // in six languages. The full sentence has to reach a screen reader anyway.
  it('names the add button more fully than it labels it', () => {
    const add = mountBar().find('.nav-slot--add')

    expect(add.text()).toBe('Add')
    expect(add.attributes('aria-label')).toBe('Add an item')
  })

  // There is one route behind all of this, so no slot is ever the current page.
  // aria-current would be pointing at the page you are already on.
  it('marks nothing as current, because it is an action bar', () => {
    const wrapper = mountBar()

    expect(wrapper.find('[aria-current]').exists()).toBe(false)
    expect(wrapper.find('nav').attributes('aria-label')).toBe('Main actions')
    for (const button of wrapper.findAll('.navbar button')) {
      if (button.classes().includes('nav-slot--add')) continue
      expect(button.attributes('aria-haspopup')).toBe('dialog')
    }
  })

  it('opens the household settings from the first slot', async () => {
    const wrapper = mountBar()
    const household = wrapper.findAll('.navbar button')[0]

    expect(household.attributes('aria-expanded')).toBe('false')
    await household.trigger('click')

    expect(household.attributes('aria-expanded')).toBe('true')
  })

  it('opens the account dialog from the last slot', async () => {
    const wrapper = mountBar()
    const you = wrapper.findAll('.navbar button')[3]

    await you.trigger('click')

    expect(you.attributes('aria-expanded')).toBe('true')
  })

  // The header shell and the bar are mutually exclusive by media query, but both
  // are in the DOM: one component, one set of dialogs. What must not happen is
  // the bar appearing on the setup screen, which has no household for three of
  // its five slots to be about.
  it('draws no bar in the header layout', () => {
    const wrapper = mount(AppNavBar, { props: { layout: 'header' } })
    wrappers.push(wrapper)

    expect(wrapper.find('.navbar').exists()).toBe(false)
    expect(wrapper.find('.topbar').exists()).toBe(true)
  })

  it('keeps the header alongside the bar, for the desktop column', () => {
    const wrapper = mountBar()

    expect(wrapper.find('.topbar').classes()).toContain('topbar--desktop-only')
  })
})
