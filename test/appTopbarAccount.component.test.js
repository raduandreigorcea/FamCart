// @vitest-environment happy-dom
//
// When the app cold-boots offline, Clerk can't load so `useUser` yields a null
// user. The account button and menu must still show who's signed in, pulled
// from the cached family roster for the current user.
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
      familyName: 'Home',
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
      familyName: 'Home',
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
      familyName: 'Home',
      memberProfiles: profiles,
      currentUserId: 'u_self',
    })

    const modal = wrapper.findComponent(AccountActionModal)
    expect(modal.props('displayName')).toBe('Clerk Name')
    expect(modal.props('avatarUrl')).toBe('https://img/avatar.png')
    expect(modal.props('email')).toBe('clerk@example.com')
  })
})

describe('AppTopbar family switcher', () => {
  const families = [
    { id: 'fam-1', name: 'Home' },
    { id: 'fam-2', name: 'Parents' },
  ]

  it('lists the families, marks the active one, and emits a switch on click', async () => {
    const wrapper = mountTopbar({
      familyId: 'fam-1',
      familyName: 'Home',
      families,
      memberProfiles: profiles,
      currentUserId: 'u_self',
    })

    await wrapper.find('.family-switcher-btn').trigger('click')

    // The menu is teleported to <body>.
    const items = [...document.body.querySelectorAll('.family-switcher-item')]
    expect(items.map((i) => i.querySelector('.family-switcher-item-name').textContent.trim())).toEqual(['Home', 'Parents'])
    expect(document.body.querySelector('.family-switcher-item--active').textContent).toContain('Home')

    items.find((i) => i.textContent.includes('Parents')).click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('switch-family')?.[0]).toEqual(['fam-2'])
  })

  it('offers join/create under the cap and emits add-family', async () => {
    const wrapper = mountTopbar({
      familyId: 'fam-1',
      familyName: 'Home',
      families,
      memberProfiles: profiles,
      currentUserId: 'u_self',
    })

    await wrapper.find('.family-switcher-btn').trigger('click')
    const add = document.body.querySelector('.family-switcher-add')
    expect(add).toBeTruthy()
    add.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('add-family')).toBeTruthy()
  })

  it('hides join/create at the cap of three families', async () => {
    const three = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' },
    ]
    const wrapper = mountTopbar({
      familyId: 'a',
      familyName: 'A',
      families: three,
      memberProfiles: profiles,
      currentUserId: 'u_self',
    })

    await wrapper.find('.family-switcher-btn').trigger('click')
    expect(document.body.querySelector('.family-switcher-add')).toBeNull()
  })
})
