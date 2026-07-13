// @vitest-environment happy-dom
//
// Component tests for the first-login notification prompt: a signed-in user
// with no saved notification preference is greeted once after the list loads;
// accepting opts them in through OneSignal, declining records "off", and a
// stored decision (either way) means no prompt at all.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import HomeView from '../src/views/HomeView.vue'
import NotificationPromptModal from '../src/components/NotificationPromptModal.vue'
import ErrorModal from '../src/components/ErrorModal.vue'
import { createFakeDb } from './support/fakeSupabase.js'
import { getNotificationPreference, setNotificationPreference } from '../src/lib/pushNotifications'
import { __setOnlineForTest } from '../src/lib/connectivity'

const mocks = vi.hoisted(() => ({
  db: null,
  routerReplace: () => {},
  enablePush: vi.fn(),
}))

vi.mock('../src/supabase', () => ({
  useSupabase: () => mocks.db,
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: (...args) => mocks.routerReplace(...args) }),
}))

vi.mock('../src/lib/familyRealtime', () => ({
  useFamilyRealtime: () => ({
    realtimeHealthy: { value: false },
    setupRealtimeSubscriptions: async () => {},
    cleanupRealtimeSubscriptions: () => {},
  }),
}))

vi.mock('@clerk/vue', async () => {
  const { ref } = await import('vue')
  return {
    useAuth: () => ({
      userId: ref('user-1'),
      isLoaded: ref(true),
      getToken: ref(async () => 'token'),
    }),
    useUser: () => ({
      user: ref({ fullName: 'Test User', imageUrl: null }),
    }),
  }
})

// Keep the real localStorage-backed preference helpers; force the environment
// gates open (supported browser, configured app id) and stub the SDK call.
vi.mock('../src/lib/pushNotifications', async (importOriginal) => ({
  ...(await importOriginal()),
  isPushSupported: () => true,
  getOneSignalAppId: () => 'app-test',
  enablePushNotifications: (...args) => mocks.enablePush(...args),
  disablePushNotifications: vi.fn(),
}))

function setDefaultHandlers(db) {
  db.handlers['family_members.select'] = (q) =>
    q.wantSingle === 'maybe'
      ? { data: { family_id: 'fam-1' }, error: null }
      : {
          data: [{ user_id: 'user-1', display_name: 'Test User', image_url: null, role: 'moderator' }],
          error: null,
        }
  db.handlers['families.select'] = () => ({
    data: { name: 'Fam', invite_code: 'ABCDEFGH', created_by: 'user-1', max_items_per_member: 50 },
    error: null,
  })
  db.handlers['shopping_list_items.select'] = () => ({ data: [], error: null })
}

const mountedWrappers = []

async function mountHome() {
  mocks.db = createFakeDb()
  mocks.routerReplace = vi.fn()
  setDefaultHandlers(mocks.db)
  const wrapper = mount(HomeView, { shallow: true })
  mountedWrappers.push(wrapper)
  await flushPromises()
  await flushPromises()
  return wrapper
}

function prompt(wrapper) {
  return wrapper.findComponent(NotificationPromptModal)
}

function notificationErrorMessage(wrapper) {
  const modal = wrapper
    .findAllComponents(ErrorModal)
    .find((m) => m.props('title') === 'Notifications')
  return modal ? modal.props('message') : ''
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  localStorage.clear()
  __setOnlineForTest(true)
  mocks.enablePush.mockReset()
  mocks.enablePush.mockResolvedValue('subscribed')
})

afterEach(() => {
  while (mountedWrappers.length) mountedWrappers.pop().unmount()
  __setOnlineForTest(true)
  vi.restoreAllMocks()
})

describe('first-login notification prompt', () => {
  it('greets a user with no saved preference once the list has loaded', async () => {
    const wrapper = await mountHome()
    expect(prompt(wrapper).props('open')).toBe(true)
    // Just showing the prompt records nothing — only an answer does.
    expect(getNotificationPreference(localStorage)).toBe(null)
  })

  it('stays silent when the user already decided', async () => {
    setNotificationPreference(localStorage, 'off')
    const wrapper = await mountHome()
    expect(prompt(wrapper).props('open')).toBe(false)

    localStorage.clear()
    setNotificationPreference(localStorage, 'on')
    const second = await mountHome()
    expect(prompt(second).props('open')).toBe(false)
  })

  it('accepting saves "on" and subscribes the signed-in user', async () => {
    const wrapper = await mountHome()
    prompt(wrapper).vm.$emit('accept')
    await flushPromises()

    expect(prompt(wrapper).props('open')).toBe(false)
    expect(getNotificationPreference(localStorage)).toBe('on')
    expect(mocks.enablePush).toHaveBeenCalledWith('user-1')
    expect(notificationErrorMessage(wrapper)).toBe('')
  })

  it('falls back to "off" with a hint when the browser denies permission', async () => {
    mocks.enablePush.mockResolvedValue('permission-denied')
    const wrapper = await mountHome()
    prompt(wrapper).vm.$emit('accept')
    await flushPromises()

    expect(getNotificationPreference(localStorage)).toBe('off')
    expect(notificationErrorMessage(wrapper)).toContain('blocked')
  })

  it('falls back to "off" with a retry hint when enabling fails', async () => {
    mocks.enablePush.mockResolvedValue('error')
    const wrapper = await mountHome()
    prompt(wrapper).vm.$emit('accept')
    await flushPromises()

    expect(getNotificationPreference(localStorage)).toBe('off')
    expect(notificationErrorMessage(wrapper)).toContain('Could not enable notifications')
  })

  it('declining saves "off" without touching the push SDK', async () => {
    const wrapper = await mountHome()
    prompt(wrapper).vm.$emit('decline')
    await flushPromises()

    expect(prompt(wrapper).props('open')).toBe(false)
    expect(getNotificationPreference(localStorage)).toBe('off')
    expect(mocks.enablePush).not.toHaveBeenCalled()
  })
})
