// @vitest-environment happy-dom
//
// What startErrorReporting actually hands Sentry, and who it says we are.
//
// Separate from errorReporting.test.js because this file has to mock the SDK
// itself. Those tests deliberately take the no-DSN path so the real @sentry/vue
// is never pulled in; these need the opposite, and a module-level mock is not
// something one file can hold both sides of.
//
// The two facts pinned here both came out of reading the production issue
// stream and finding it lying:
//
//   - every issue was tagged environment:production, including three raised
//     against a Vite dev server on the LAN, because init() never passed an
//     environment and Sentry defaults to production when you don't;
//   - every issue read "Users: 0", because nothing ever called setUser, so the
//     one question worth asking of a crash (did this hit one person or all of
//     them) had no answer.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// vi.hoisted, not bare consts: vi.mock factories are hoisted above the imports,
// so anything they close over has to be hoisted with them or it is still in its
// temporal dead zone when the factory runs.
const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  setUser: vi.fn(),
  offline: false,
}))

vi.mock('@sentry/vue', () => ({
  init: mocks.init,
  captureException: vi.fn(),
  captureFeedback: vi.fn(),
  setUser: mocks.setUser,
  // Destructured by startErrorReporting for the delivery hook. Missing here,
  // the read throws into the SDK load's silent .catch() and every test below
  // fails as if init was never called.
  getClient: () => ({ on: () => {} }),
  browserTracingIntegration: () => ({ name: 'BrowserTracing' }),
}))

// The SDK load is deferred to idle in the real thing (see lib/idle). Run it
// straight through here, so these tests do not sit on a 2 second timer.
vi.mock('../src/lib/idle', () => ({ whenIdle: (run) => run() }))

vi.mock('../src/lib/connectivity', () => ({
  isCurrentlyOffline: () => mocks.offline,
}))

// The module holds `loading` and `capture` at module scope, so a second
// startErrorReporting in the same module instance is a no-op that returns the
// first call's promise. Every test gets its own copy.
async function freshModule() {
  vi.resetModules()
  return import('../src/lib/errorReporting')
}

beforeEach(() => {
  mocks.init.mockClear()
  mocks.setUser.mockClear()
  mocks.offline = false
  // Any syntactically plausible DSN will do; it is never dialled, because init
  // is mocked. Without one the module takes the no-DSN path and never loads.
  vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.ingest.de.sentry.io/1')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('startErrorReporting', () => {
  it('names the environment, so a dev-server error cannot claim to be production', async () => {
    const { startErrorReporting } = await freshModule()

    await startErrorReporting({}, {})

    expect(mocks.init).toHaveBeenCalledTimes(1)
    // MODE is 'production' for a build, 'development' under `npm run dev` and
    // 'test' right here. Asserting against it rather than a literal is the
    // point: the value has to track the build, not a string someone typed once.
    expect(mocks.init.mock.calls[0][0].environment).toBe(import.meta.env.MODE)
  })

  it('installs a beforeSend that drops the Clerk load failure when offline', async () => {
    const { startErrorReporting } = await freshModule()
    await startErrorReporting({}, {})

    const { beforeSend } = mocks.init.mock.calls[0][0]
    const event = {
      exception: { values: [{ type: 'e', value: 'Clerk: Failed to load Clerk UI' }] },
    }

    mocks.offline = true
    expect(beforeSend(event)).toBeNull()

    mocks.offline = false
    expect(beforeSend(event)).toBe(event)
  })
})

describe('identifyUser', () => {
  it('applies an identity taken before the SDK had finished loading', async () => {
    const { identifyUser, startErrorReporting } = await freshModule()

    // The real order on a cold start: Clerk resolves who is signed in well
    // before the idle-deferred SDK is ready to be told.
    identifyUser('user_3FTxzNXJclvEzv9SSd2FHfyakHa')
    await startErrorReporting({}, {})

    expect(mocks.setUser).toHaveBeenCalledWith({ id: 'user_3FTxzNXJclvEzv9SSd2FHfyakHa' })
  })

  it('passes a later identity straight through', async () => {
    const { identifyUser, startErrorReporting } = await freshModule()
    await startErrorReporting({}, {})

    identifyUser('user_abc')

    expect(mocks.setUser).toHaveBeenLastCalledWith({ id: 'user_abc' })
  })

  it('clears the identity when nobody is signed in', async () => {
    const { identifyUser, startErrorReporting } = await freshModule()
    await startErrorReporting({}, {})

    identifyUser(null)

    expect(mocks.setUser).toHaveBeenLastCalledWith(null)
  })
})
