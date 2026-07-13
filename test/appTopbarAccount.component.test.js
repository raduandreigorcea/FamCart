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
