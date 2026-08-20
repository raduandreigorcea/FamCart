// @vitest-environment happy-dom
//
// The language step is the first thing a brand-new account sees, and every rule
// about when it appears is a boolean that reads the same whether it is right or
// wrong. Three of them regress silently: asking again on the second household
// (the user already answered), asking again after somebody deliberately chose
// English (a real answer that looks like an unset key), and never asking at all
// because the seed ran before Clerk supplied a user id.
//
// The fourth thing pinned here is that choosing re-renders the screen underneath
// without a reload. That is what the shallowRef catalog swap in lib/i18n buys,
// and nothing else in the app depends on it yet.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import HouseholdSetupView from '../src/views/HouseholdSetupView.vue'
import LanguagePicker from '../src/components/LanguagePicker.vue'
import { createFakeDb } from './support/fakeSupabase.js'
import { LOCALE_DEVICE_KEY, LOCALE_PREFIX } from '../src/lib/locale'
import { userScopedKey } from '../src/lib/perUserStorage'
import { setLocale } from '../src/lib/i18n'

const mocks = vi.hoisted(() => ({
  db: null,
  userId: 'user-1',
  query: {},
}))

vi.mock('../src/supabase', () => ({
  useSupabase: () => mocks.db,
  getCatalogSupabase: () => mocks.catalogDb ?? null,
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  useRoute: () => ({ query: mocks.query }),
}))

vi.mock('@clerk/vue', async () => {
  const { ref, computed } = await import('vue')
  return {
    useAuth: () => ({
      userId: computed(() => mocks.userId),
      isLoaded: ref(true),
      isSignedIn: ref(true),
      getToken: ref(async () => 'token'),
    }),
    useUser: () => ({ user: ref({ fullName: 'Test User', imageUrl: null }) }),
  }
})

const scopedKey = (userId) => userScopedKey(LOCALE_PREFIX, userId)

const wrappers = []
function mountSetup() {
  // Shallow, except for AppCard. A stubbed component renders none of its slot,
  // and every branch of this view — language, welcome, picker, both forms —
  // lives inside AppCard's default slot, so a plain shallow mount renders an
  // empty card and finds nothing.
  const w = mount(HouseholdSetupView, {
    shallow: true,
    global: { stubs: { AppCard: false } },
  })
  wrappers.push(w)
  return w
}

const picker = (w) => w.findComponent(LanguagePicker)

beforeEach(async () => {
  mocks.db = createFakeDb()
  mocks.db.handlers['households.select'] = () => ({ data: null, error: null })
  mocks.userId = 'user-1'
  mocks.query = {}
  localStorage.clear()
  // Warm the Romanian chunk, then settle on English.
  //
  // setLocale performs a real dynamic import, and one flushPromises() does not
  // reliably cover the FIRST one. Without this the tests are order-dependent in
  // a way that hides: whichever ran first paid for the load and failed, and
  // every later one passed off the module-level catalog cache.
  //
  // Settling on English second also matters on its own — the catalog is module
  // state that survives between files, so each test starts from a known
  // language rather than whichever one the last file left behind.
  await setLocale('ro')
  await setLocale('en')
})

afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
})

describe('the first-run language step', () => {
  it('is the first thing an account with no stored choice sees', async () => {
    const w = mountSetup()
    await flushPromises()
    expect(picker(w).exists()).toBe(true)
  })

  it('does not appear for an account that has already chosen', async () => {
    localStorage.setItem(scopedKey('user-1'), 'ro')
    const w = mountSetup()
    await flushPromises()
    expect(picker(w).exists()).toBe(false)
  })

  it('treats a stored English as a real answer and does not ask again', async () => {
    // The trap: 'en' is both the default and a legitimate explicit choice, so
    // the gate has to be "is the key set", never "is the locale not English".
    localStorage.setItem(scopedKey('user-1'), 'en')
    const w = mountSetup()
    await flushPromises()
    expect(picker(w).exists()).toBe(false)
  })

  it('ignores another account’s choice', async () => {
    localStorage.setItem(scopedKey('someone-else'), 'de')
    const w = mountSetup()
    await flushPromises()
    expect(picker(w).exists()).toBe(true)
  })

  it('is skipped entirely when adding a second household', async () => {
    // ?add=1 comes from the account dialog. Whoever gets there answered this
    // question the first time round.
    mocks.query = { add: '1' }
    const w = mountSetup()
    await flushPromises()
    expect(picker(w).exists()).toBe(false)
  })

  it('stays hidden until Clerk supplies a user id', async () => {
    // Deciding on a null id would read hasUserLocale('') === false and ask
    // everybody, every launch. Withholding is the same posture ownershipChecked
    // takes for the create option.
    mocks.userId = null
    const w = mountSetup()
    await flushPromises()
    expect(picker(w).exists()).toBe(false)
  })
})

describe('choosing a language', () => {
  // LanguagePicker is auto-stubbed under shallow mount, so this drives its
  // 'confirm' event directly rather than clicking a tile then a button — the
  // preview-before-apply logic that makes that safe belongs to LanguagePicker
  // and is pinned in test/languagePicker.component.test.js. What this file
  // owns is that HouseholdSetupView listens for 'confirm', not the earlier
  // 'select', and does the right thing once it fires.
  it('records it under both the account and the device', async () => {
    const w = mountSetup()
    await flushPromises()

    await picker(w).vm.$emit('confirm', 'ro')
    await flushPromises()

    expect(localStorage.getItem(scopedKey('user-1'))).toBe('ro')
    expect(localStorage.getItem(LOCALE_DEVICE_KEY)).toBe('ro')
  })

  it('reveals the rest of setup, already in the chosen language', async () => {
    const w = mountSetup()
    await flushPromises()

    await picker(w).vm.$emit('confirm', 'ro')
    await flushPromises()

    expect(picker(w).exists()).toBe(false)
    // The welcome hero behind it re-rendered from the swapped catalog rather
    // than waiting for a reload.
    expect(w.text()).toContain('gospodăria')
  })

  it('passes the boot-resolved locale as current', async () => {
    // happy-dom reports en-US, so this is the honest starting point: the
    // grid highlights it, and Confirm can commit it with no tap at all. There
    // is no separate "suggested" prop — a language is a subjective pick, not
    // a recommendation this screen is positioned to make.
    const w = mountSetup()
    await flushPromises()
    expect(picker(w).props('current')).toBe('en')
  })
})
