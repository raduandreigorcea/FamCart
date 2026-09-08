// @vitest-environment happy-dom
//
// The nightly build has to announce itself. Production must not: the badge is
// only meaningful if its absence means something.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import AppNavBar from '../src/components/AppNavBar.vue'

const channel = vi.hoisted(() => ({ nightly: false }))

vi.mock('../src/lib/appChannel', async (importOriginal) => ({
  ...(await importOriginal()),
  // A getter, not a value: the component reads the binding on every render, so
  // one mocked module serves both cases.
  get IS_NIGHTLY() {
    return channel.nightly
  },
}))

vi.mock('@clerk/vue', () => ({
  useUser: () => ({ user: ref(null) }),
  useClerk: () => ref({ openUserProfile: vi.fn(), signOut: vi.fn() }),
  useAuth: () => ({ userId: ref(null), getToken: ref(async () => null) }),
}))

vi.mock('../src/supabase', () => ({
  useSupabase: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  }),
  getCatalogSupabase: () => null,
}))

vi.mock('../src/lib/errorReporting', () => ({
  captureException: vi.fn(),
  identifyUser: vi.fn(),
}))

const wrappers = []
function mountTopbar() {
  const w = mount(AppNavBar, { props: { householdName: 'Home' } })
  wrappers.push(w)
  return w
}

function mountBar() {
  const w = mount(AppNavBar, { props: { layout: 'bar', householdName: 'Home' } })
  wrappers.push(w)
  return w
}

beforeEach(() => {
  channel.nightly = false
})

afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
})

describe('AppNavBar channel badge', () => {
  it('shows nothing on a production build', () => {
    expect(mountTopbar().find('.channel-badge').exists()).toBe(false)
  })

  it('marks a nightly build in the header', () => {
    channel.nightly = true
    const badge = mountTopbar().find('.channel-badge')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('NIGHTLY')
  })

  // The header is desktop-only on the list screen, so on a phone the stamp would
  // have had nowhere to be. It takes the bar's spare slot until something else
  // claims it — the one place that is on screen whatever you are doing.
  describe('in the bottom bar', () => {
    it('leaves the spare slot empty on a production build', () => {
      const wrapper = mountBar()

      expect(wrapper.find('.nav-channel').exists()).toBe(false)
      expect(wrapper.find('.nav-slot--empty').text()).toBe('')
    })

    it('stamps the spare slot on a nightly build', () => {
      channel.nightly = true
      const badge = mountBar().find('.nav-slot--empty .nav-channel')

      expect(badge.exists()).toBe(true)
      expect(badge.text()).toBe('NIGHTLY')
    })
  })
})
