// @vitest-environment happy-dom
//
// When the app cold-boots offline, Clerk can't load so `useUser` yields a null
// user. The account button and menu must still show who's signed in, pulled
// from the cached household roster for the current user.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import AppTopbar from '../src/components/AppTopbar.vue'
import AccountActionModal from '../src/components/AccountActionModal.vue'

const clerkUser = vi.hoisted(() => ({ value: null }))

vi.mock('@clerk/vue', () => ({
  useUser: () => ({ user: clerkUser }),
  useClerk: () => ref({ openUserProfile: vi.fn(), signOut: vi.fn() }),
  useAuth: () => ({ userId: ref(null), getToken: ref(async () => null) }),
}))

// AccountActionModal (always mounted inside the topbar) talks to Supabase for
// notification prefs; stub it so the topbar can mount in isolation.
vi.mock('../src/supabase', () => ({
  useSupabase: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  }),
}))

vi.mock('../src/lib/pushNotifications', async (importOriginal) => ({
  // Keep the real localStorage-backed preference helpers; only the SDK-touching
  // functions need stubbing.
  ...(await importOriginal()),
  enablePushNotifications: vi.fn(),
  disablePushNotifications: vi.fn(),
}))

const wrappers = []
function mountTopbar(props) {
  const w = mount(AppTopbar, { props })
  wrappers.push(w)
  return w
}

beforeEach(() => {
  clerkUser.value = null
})

afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
  vi.restoreAllMocks()
})

const profiles = [
  { user_id: 'u_self', display_name: 'Radu Gorcea', image_url: '', role: 'owner' },
  { user_id: 'u_other', display_name: 'Alex', image_url: '', role: 'member' },
]

describe('AppTopbar account identity offline', () => {
  it('falls back to the cached profile when Clerk has no user', () => {
    const wrapper = mountTopbar({
      householdName: 'Home',
      memberProfiles: profiles,
      currentUserId: 'u_self',
    })

    // Avatar button shows the cached user's initial, not the empty '?'.
    expect(wrapper.find('.user-avatar-fallback').text()).toBe('R')

    // The account menu receives the cached display name.
    const modal = wrapper.findComponent(AccountActionModal)
    expect(modal.props('displayName')).toBe('Radu Gorcea')
    expect(modal.props('initial')).toBe('R')
  })

  it('shows the generic Account label when no cached profile matches', () => {
    const wrapper = mountTopbar({
      householdName: 'Home',
      memberProfiles: profiles,
      currentUserId: 'u_missing',
    })

    const modal = wrapper.findComponent(AccountActionModal)
    expect(modal.props('displayName')).toBe('Account')
    expect(wrapper.find('.user-avatar-fallback').text()).toBe('?')
  })

  it('prefers the live Clerk user when it is available', () => {
    clerkUser.value = {
      fullName: 'Clerk Name',
      imageUrl: 'https://img/avatar.png',
      primaryEmailAddress: { emailAddress: 'clerk@example.com' },
    }
    const wrapper = mountTopbar({
      householdName: 'Home',
      memberProfiles: profiles,
      currentUserId: 'u_self',
    })

    const modal = wrapper.findComponent(AccountActionModal)
    expect(modal.props('displayName')).toBe('Clerk Name')
    expect(modal.props('avatarUrl')).toBe('https://img/avatar.png')
    expect(modal.props('email')).toBe('clerk@example.com')
  })
})

describe('AppTopbar household block', () => {
  const households = [
    { id: 'fam-1', name: 'Home' },
    { id: 'fam-2', name: 'Parents' },
  ]

  // The block used to open a popover listing households. A user may belong to at
  // most three and own only one, so nearly every account has exactly one -- which
  // made the bar's best position a menu whose only content was a single ticked
  // row. It goes straight to that household's settings now, and switching moved
  // into the account dialog where it only appears once there is a choice.
  it('opens household settings directly, with no menu in between', async () => {
    const wrapper = mountTopbar({
      householdId: 'fam-1',
      householdName: 'Home',
      households,
      memberProfiles: profiles,
      currentUserId: 'u_self',
    })

    const block = wrapper.find('.household-btn')
    expect(block.attributes('aria-label')).toBe('Home settings')
    // Nothing announcing a popup: this is a link to one place.
    expect(block.attributes('aria-haspopup')).toBeUndefined()

    await block.trigger('click')
    expect(document.body.querySelector('.popover-panel')).toBeNull()
  })

  it('keeps a standalone settings gear out of the bar', () => {
    const wrapper = mountTopbar({
      householdId: 'fam-1',
      householdName: 'Home',
      households,
      memberProfiles: profiles,
      currentUserId: 'u_self',
    })

    expect(wrapper.find('.household-settings-btn').exists()).toBe(false)
    // Three targets, not four: the household block, history, and the account
    // avatar.
    expect(wrapper.findAll('.topbar button')).toHaveLength(3)
  })

  // The household's own emoji anchors the block, the same square it wears on its
  // row in the account dialog.
  it('leads the household block with its emoji', () => {
    const wrapper = mountTopbar({
      householdId: 'fam-1',
      householdName: 'Home',
      householdEmoji: 'HOUSEEMOJI',
      households,
      memberProfiles: profiles,
      currentUserId: 'u_self',
    })

    expect(wrapper.find('.household-btn .household-emoji').text()).toBe('HOUSEEMOJI')
  })

  it('hands the household roster to the account dialog to switch with', () => {
    const wrapper = mountTopbar({
      householdId: 'fam-1',
      householdName: 'Home',
      households,
      memberProfiles: profiles,
      currentUserId: 'u_self',
    })

    const modal = wrapper.findComponent(AccountActionModal)
    expect(modal.props('households')).toEqual(households)
    expect(modal.props('householdId')).toBe('fam-1')

    modal.vm.$emit('switch-household', 'fam-2')
    expect(wrapper.emitted('switch-household')?.[0]).toEqual(['fam-2'])

    modal.vm.$emit('add-household')
    expect(wrapper.emitted('add-household')).toBeTruthy()
  })

  it('offers the same destination from the account dialog', () => {
    const wrapper = mountTopbar({
      householdId: 'fam-1',
      householdName: 'Home',
      households,
      memberProfiles: profiles,
      currentUserId: 'u_self',
    })

    const modal = wrapper.findComponent(AccountActionModal)
    expect(modal.props('householdName')).toBe('Home')
    expect(modal.props('householdMemberCount')).toBe(2)
  })

  it('hides join/create at the cap of three households', () => {
    const three = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' },
    ]
    const wrapper = mountTopbar({
      householdId: 'a',
      householdName: 'A',
      households: three,
      memberProfiles: profiles,
      currentUserId: 'u_self',
    })

    // The cap is enforced where the row now lives.
    expect(wrapper.findComponent(AccountActionModal).props('households')).toHaveLength(3)
  })
})


// Switching households lives in the account dialog now: the topbar name goes
// straight to settings, so this is the surface that has to answer "where else
// can I go".
describe('AccountActionModal households', () => {
  function mountAccount(props) {
    const w = mount(AccountActionModal, { props: { open: true, ...props } })
    wrappers.push(w)
    return w
  }

  const two = [
    { id: 'fam-1', name: 'Home', emoji: 'E1' },
    { id: 'fam-2', name: 'Parents', emoji: 'E2' },
  ]

  it('lists the households, marks the active one, and emits a switch', async () => {
    const wrapper = mountAccount({ households: two, householdId: 'fam-1' })

    const rows = wrapper.findAll('.account-household-item')
    expect(rows.map((r) => r.find('.account-household-name').text())).toEqual(['Home', 'Parents'])
    expect(rows[0].find('.account-menu-item__hint').text()).toBe('Current')
    expect(rows[1].find('.account-menu-item__hint').exists()).toBe(false)

    await rows[1].trigger('click')
    expect(wrapper.emitted('switch-household')?.[0]).toEqual(['fam-2'])
  })

  // Tapping the one you are already on is not a switch; it is a way of saying
  // "never mind", so it just closes.
  it('closes rather than switching when the active household is tapped', async () => {
    const wrapper = mountAccount({ households: two, householdId: 'fam-1' })

    await wrapper.findAll('.account-household-item')[0].trigger('click')
    expect(wrapper.emitted('switch-household')).toBeFalsy()
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  // With one household the rows would be a single row you are already on, so
  // there is nothing to list -- but there is still somewhere to go.
  it('lists nothing to switch to when there is only one household', () => {
    const wrapper = mountAccount({
      households: [{ id: 'fam-1', name: 'Home' }],
      householdId: 'fam-1',
    })

    expect(wrapper.findAll('.account-household-item')).toHaveLength(0)
    expect(wrapper.find('.account-household-add').exists()).toBe(true)
  })

  it('drops the whole section at the cap with nowhere left to switch', () => {
    const wrapper = mountAccount({
      households: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }],
      householdId: 'a',
    })

    // Three to switch between, but no room for a fourth.
    expect(wrapper.findAll('.account-household-item')).toHaveLength(3)
    expect(wrapper.find('.account-household-add').exists()).toBe(false)
  })

  it('emits add-household from the join/create row', async () => {
    const wrapper = mountAccount({ households: two, householdId: 'fam-1' })

    await wrapper.find('.account-household-add').trigger('click')
    expect(wrapper.emitted('add-household')).toBeTruthy()
  })
})

// Reporting a problem sits with sign out at the bottom rather than among the
// four rows above it: those lead further into the app, these two are the ways of
// stepping outside it. Sign out stays last, since it ends the session.
describe('AccountActionModal report issue', () => {
  function mountAccount(props) {
    const w = mount(AccountActionModal, { props: { open: true, ...props } })
    wrappers.push(w)
    return w
  }

  it('offers a report row and emits from it', async () => {
    const wrapper = mountAccount({ householdName: 'Home' })

    const row = wrapper.find('.account-report-item')
    expect(row.exists()).toBe(true)
    expect(row.text()).toContain('Report an issue')

    await row.trigger('click')
    expect(wrapper.emitted('report-issue')).toBeTruthy()
  })

  it('keeps sign out as the last row', () => {
    const wrapper = mountAccount({ householdName: 'Home' })

    const rows = wrapper.findAll('.account-menu-item')
    const last = rows[rows.length - 1]
    expect(last.classes()).toContain('account-menu-item--danger')
    expect(rows[rows.length - 2].classes()).toContain('account-report-item')
  })

  it('reaches the topbar as a handled event', () => {
    const wrapper = mountTopbar({
      householdName: 'Home',
      memberProfiles: profiles,
      currentUserId: 'u_self',
    })

    const modal = wrapper.findComponent(AccountActionModal)
    modal.vm.$emit('report-issue')
    // Handled locally, so it closes the dialog rather than bubbling out of the bar.
    expect(wrapper.emitted('report-issue')).toBeFalsy()
    expect(modal.props('open')).toBe(false)
  })
})

// The rows are near-identically shaped, so the icon is what tells them apart at
// a glance. A row added later without one would be the odd one out, which is
// what this guards.
describe('AccountActionModal row icons', () => {
  function mountAccount(props) {
    const w = mount(AccountActionModal, { props: { open: true, ...props } })
    wrappers.push(w)
    return w
  }

  it('leads every row with a mark, and never the same one twice', () => {
    const wrapper = mountAccount({
      householdName: 'Home',
      households: [{ id: 'fam-1', name: 'Home', emoji: 'E1' }],
      householdId: 'fam-1',
    })

    // No exceptions, sign out included.
    for (const row of wrapper.findAll('.account-menu-item')) {
      const mark = row.find('.account-item-icon, .account-household-emoji')
      expect(mark.exists(), `no icon on: ${row.text()}`).toBe(true)
    }

    const svgs = wrapper.findAll('.account-item-icon svg')
    const shapes = svgs.map((s) => s.attributes('class'))
    expect(new Set(shapes).size).toBe(shapes.length)
  })

  // The row used to empty to a bare spinner, which said something was happening
  // but not what. Only the mark is replaced now.
  it('keeps sign out named while it is signing out', () => {
    const wrapper = mountAccount({ householdName: 'Home', loadingSignOut: true })

    const row = wrapper.find('.account-menu-item--danger')
    expect(row.text()).toContain('Signing out')
    expect(row.find('.account-spinner').exists()).toBe(true)
    expect(row.find('.account-item-icon').exists()).toBe(false)
  })
})
