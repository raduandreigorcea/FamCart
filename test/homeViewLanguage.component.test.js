// @vitest-environment happy-dom
//
// Which language the app comes up in, once Clerk has said who is using it.
//
// The choice is stored under two keys and only one of them can be read at boot.
// main.ts runs initLocale before Clerk has resolved, so it has no account to
// scope by and can only consult the DEVICE key — which is device-wide and holds
// whatever the last person to choose on this browser picked. The scoped key is
// the truth, and HomeView is the first point at which there is an id to read it
// with.
//
// These exist because that second half was written and never called. The
// function was correct, the storage contract was correct, and the language was
// still wrong on any device with two accounts: the scoped key was written on
// every choice and read by nothing. A unit test on the function could not have
// caught that, which is why the assertion here goes through the view.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import HomeView from '../src/views/HomeView.vue'
import { createFakeDb } from './support/fakeSupabase.js'
import { getLocale, initLocale, setLocale, whenLocaleReady } from '../src/lib/i18n'
import { LOCALE_DEVICE_KEY, LOCALE_PREFIX } from '../src/lib/locale'
import { userScopedKey } from '../src/lib/perUserStorage'
import { markTourSeen } from '../src/lib/onboarding'
import { __setOnlineForTest } from '../src/lib/connectivity'

const mocks = vi.hoisted(() => ({ db: null, routerReplace: () => {}, userId: null, isLoaded: null }))

vi.mock('../src/supabase', () => ({
  useSupabase: () => mocks.db,
  getCatalogSupabase: () => null,
}))
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: (...a) => mocks.routerReplace(...a), push: () => {} }),
}))
vi.mock('../src/lib/householdRealtime', () => ({
  useHouseholdRealtime: () => ({
    realtimeHealthy: { value: false },
    setupRealtimeSubscriptions: async () => {},
    cleanupRealtimeSubscriptions: () => {},
  }),
}))

// Clerk starts unresolved, as it does on a real cold load; each test resolves it.
vi.mock('@clerk/vue', async () => {
  const { ref } = await import('vue')
  mocks.userId = ref(null)
  mocks.isLoaded = ref(false)
  return {
    useAuth: () => ({ userId: mocks.userId, isLoaded: mocks.isLoaded, getToken: ref(async () => 't') }),
    useUser: () => ({ user: ref(null) }),
  }
})

const scoped = (userId) => userScopedKey(LOCALE_PREFIX, userId)

const wrappers = []

// Mount and let the first boot pass settle, which is what a real cold load
// does: HomeView runs its init once on mount with Clerk still unresolved, and
// that pass has to finish before the one Clerk triggers can start. Setting the
// Clerk refs in the same tick as the mount instead leaves the second run shut
// out by the first one's in-progress guard, which is a shape only a test can
// produce — Clerk resolving is a network round trip away.
async function mountHome() {
  const w = mount(HomeView, { shallow: true })
  wrappers.push(w)
  await flushPromises()
  return w
}

// Clerk resolving is what starts the sequence this file is about.
async function signIn(userId) {
  mocks.userId.value = userId
  mocks.isLoaded.value = true
  await flushPromises()
}

beforeEach(async () => {
  localStorage.clear()
  markTourSeen(localStorage)
  mocks.db = createFakeDb()
  mocks.routerReplace = vi.fn()
  mocks.userId.value = null
  mocks.isLoaded.value = false
  __setOnlineForTest(true)
  await setLocale('en')
})

afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
  __setOnlineForTest(true)
  vi.restoreAllMocks()
})

describe('the language a signed-in account boots into', () => {
  it("switches to the account's own choice, not the device's last one", async () => {
    // Two accounts have chosen on this browser. B went last, so B's language is
    // what the device key holds and what a cold boot can see.
    localStorage.setItem(scoped('user-a'), 'ro')
    localStorage.setItem(scoped('user-b'), 'de')
    localStorage.setItem(LOCALE_DEVICE_KEY, 'de')

    await initLocale(localStorage, ['en-GB'])
    await whenLocaleReady()
    expect(getLocale()).toBe('de')

    await mountHome()
    await signIn('user-a')

    // A's own choice wins over the device hint the app booted into. Awaited
    // rather than asserted outright: the swap pulls a language chunk, so it
    // lands a tick or two after the sign-in rather than during it.
    await vi.waitFor(() => expect(getLocale()).toBe('ro'))

    // The device hint now describes what is actually on screen, so A's next
    // cold boot starts in Romanian instead of swapping again.
    expect(localStorage.getItem(LOCALE_DEVICE_KEY)).toBe('ro')
    // B's choice is untouched, waiting for B.
    expect(localStorage.getItem(scoped('user-b'))).toBe('de')
  })

  it('leaves the language alone when it is already the account’s', async () => {
    localStorage.setItem(scoped('user-a'), 'it')
    localStorage.setItem(LOCALE_DEVICE_KEY, 'it')

    await initLocale(localStorage, ['en-GB'])
    await whenLocaleReady()

    await mountHome()
    await signIn('user-a')

    expect(getLocale()).toBe('it')
  })

  // Anyone who used the app before the language step existed. Adopting what
  // they are already reading beats ambushing a returning user with a question.
  it('files the current language under an account that has never chosen', async () => {
    localStorage.setItem(LOCALE_DEVICE_KEY, 'fr')

    await initLocale(localStorage, ['en-GB'])
    await whenLocaleReady()

    await mountHome()
    await signIn('user-new')

    await vi.waitFor(() => expect(localStorage.getItem(scoped('user-new'))).toBe('fr'))
    // Adopted, not changed: they carry on reading what they were reading.
    expect(getLocale()).toBe('fr')
  })
})
