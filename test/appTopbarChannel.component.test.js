// @vitest-environment happy-dom
//
// The nightly build has to announce itself. Production must not: the badge is
// only meaningful if its absence means something.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import AppTopbar from '../src/components/AppTopbar.vue'

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
  const w = mount(AppTopbar, { props: { householdName: 'Home' } })
  wrappers.push(w)
  return w
}

beforeEach(() => {
  channel.nightly = false
})

afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
})

describe('AppTopbar channel badge', () => {
  it('shows nothing on a production build', () => {
    expect(mountTopbar().find('.channel-badge').exists()).toBe(false)
  })

  it('marks a nightly build in the bar', () => {
    channel.nightly = true
    const badge = mountTopbar().find('.channel-badge')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('NIGHTLY')
  })
})
