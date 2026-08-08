// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// The module keeps a one-shot "already reloading" flag, so every case imports it
// fresh. import.meta.env.DEV is stubbed per case: the dev path unregisters and
// stops, the production path registers and watches for a new worker taking over.

let listeners
let registration
let reload

function makeRegistration(scriptURL = 'https://app.test/sw.js') {
  return {
    active: { scriptURL },
    update: vi.fn().mockResolvedValue(undefined),
    unregister: vi.fn().mockResolvedValue(true),
  }
}

function installServiceWorkerStub({ controller = null, registrations = [] } = {}) {
  listeners = new Map()
  registration = makeRegistration()

  const container = {
    controller,
    register: vi.fn().mockResolvedValue(registration),
    getRegistrations: vi.fn().mockResolvedValue(registrations),
    addEventListener: vi.fn((event, handler) => listeners.set(event, handler)),
  }

  Object.defineProperty(navigator, 'serviceWorker', {
    value: container,
    configurable: true,
    writable: true,
  })
  return container
}

async function start({ dev }) {
  vi.stubEnv('DEV', dev)
  vi.resetModules()
  const { startAppUpdates } = await import('../src/lib/appUpdate')
  startAppUpdates()
  await vi.waitFor(() => {}) // let the registration/unregistration promises settle
}

beforeEach(() => {
  reload = vi.fn()
  Object.defineProperty(window, 'location', {
    value: { ...window.location, reload },
    configurable: true,
    writable: true,
  })
  Object.defineProperty(document, 'readyState', {
    value: 'complete',
    configurable: true,
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  delete navigator.serviceWorker
})

describe('appUpdate', () => {
  it('reloads when a new worker takes over a page an older one was serving', async () => {
    installServiceWorkerStub({ controller: { scriptURL: 'https://app.test/sw.js' } })
    await start({ dev: false })

    listeners.get('controllerchange')()

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads only once, however many controller changes arrive', async () => {
    installServiceWorkerStub({ controller: { scriptURL: 'https://app.test/sw.js' } })
    await start({ dev: false })

    listeners.get('controllerchange')()
    listeners.get('controllerchange')()

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not reload when a first install claims an uncontrolled page', async () => {
    installServiceWorkerStub({ controller: null })
    await start({ dev: false })

    listeners.get('controllerchange')()

    expect(reload).not.toHaveBeenCalled()
  })

  it('checks for a new build whenever the app returns to the foreground', async () => {
    installServiceWorkerStub({ controller: null })
    await start({ dev: false })

    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(registration.update).not.toHaveBeenCalled()

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(registration.update).toHaveBeenCalledTimes(1)
  })

  it('in dev, unregisters a worker left behind by a build on the same origin', async () => {
    const stale = makeRegistration('http://192.168.1.5:5173/sw.js')
    const container = installServiceWorkerStub({ registrations: [stale] })

    await start({ dev: true })

    expect(stale.unregister).toHaveBeenCalledTimes(1)
    expect(container.register).not.toHaveBeenCalled()
  })

  it("in dev, leaves OneSignal's own worker alone", async () => {
    const push = makeRegistration('http://192.168.1.5:5173/onesignal/OneSignalSDKWorker.js')
    installServiceWorkerStub({ registrations: [push] })

    await start({ dev: true })

    expect(push.unregister).not.toHaveBeenCalled()
  })
})
