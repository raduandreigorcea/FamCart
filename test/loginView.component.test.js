// @vitest-environment happy-dom
//
// Component tests for LoginView's error routing: every failure pops a modal —
// already-signed-in gets its own dialog with a go-home action, other sign-in
// failures get the shared ErrorModal — and a signed-in user sitting on the
// login page is redirected home.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import LoginView from '../src/views/LoginView.vue'
import ErrorModal from '../src/components/ErrorModal.vue'
import ConfirmModal from '../src/components/ConfirmModal.vue'

const mocks = vi.hoisted(() => ({
  create: async () => ({}),
  isSignedIn: null,
  routerReplace: () => {},
}))

vi.mock('@clerk/vue', async () => {
  const { ref } = await import('vue')
  return {
    useSignIn: () => ({
      signIn: ref({
        create: (...args) => mocks.create(...args),
        prepareFirstFactor: async () => {},
        attemptFirstFactor: async () => ({ status: 'complete' }),
        authenticateWithRedirect: async () => {},
      }),
      isLoaded: ref(true),
    }),
    useAuth: () => ({ isSignedIn: mocks.isSignedIn }),
  }
})

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: (...args) => mocks.routerReplace(...args) }),
}))

const mountedWrappers = []

function mountLogin() {
  const wrapper = mount(LoginView)
  mountedWrappers.push(wrapper)
  return wrapper
}

async function submitEmail(wrapper, email = 'radu@example.com') {
  await wrapper.find('input[type="email"]').setValue(email)
  await wrapper.find('form').trigger('submit')
  await flushPromises()
}

function clerkError(code, message) {
  return Object.assign(new Error(message), { errors: [{ code, message }] })
}

beforeEach(() => {
  mocks.isSignedIn = ref(false)
  mocks.routerReplace = vi.fn()
})

afterEach(() => {
  while (mountedWrappers.length) mountedWrappers.pop().unmount()
  vi.restoreAllMocks()
})

describe('LoginView error routing', () => {
  it('shows the already-signed-in dialog (not the error dialog) on session_exists', async () => {
    mocks.create = async () => {
      throw clerkError('session_exists', "You're currently in single session mode.")
    }
    const wrapper = mountLogin()
    await submitEmail(wrapper)

    // First ConfirmModal in the tree is the already-signed-in dialog.
    expect(wrapper.findComponent(ConfirmModal).props('open')).toBe(true)
    expect(wrapper.findComponent(ErrorModal).props('message')).toBe('')
  })

  it('pops the error dialog for other sign-in failures', async () => {
    mocks.create = async () => {
      throw clerkError('form_identifier_not_found', "Couldn't find your account.")
    }
    const wrapper = mountLogin()
    await submitEmail(wrapper)

    expect(wrapper.findComponent(ConfirmModal).props('open')).toBe(false)
    expect(wrapper.findComponent(ErrorModal).props('message')).toBe("Couldn't find your account.")
  })

  it('clears the error when the dialog is dismissed', async () => {
    mocks.create = async () => {
      throw clerkError('form_identifier_not_found', "Couldn't find your account.")
    }
    const wrapper = mountLogin()
    await submitEmail(wrapper)

    await wrapper.findComponent(ErrorModal).find('button').trigger('click')

    expect(wrapper.findComponent(ErrorModal).props('message')).toBe('')
  })

  it('redirects home when the user turns out to be signed in', async () => {
    const wrapper = mountLogin()
    expect(mocks.routerReplace).not.toHaveBeenCalled()

    mocks.isSignedIn.value = true
    await wrapper.vm.$nextTick()

    expect(mocks.routerReplace).toHaveBeenCalledWith('/')
  })

  it('redirects home immediately when already signed in at mount', async () => {
    mocks.isSignedIn.value = true
    mountLogin()
    await flushPromises()

    expect(mocks.routerReplace).toHaveBeenCalledWith('/')
  })
})
