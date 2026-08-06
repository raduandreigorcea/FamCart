// @vitest-environment happy-dom
//
// The first open of a lazily-mounted dialog had no animation; every open after
// it did.
//
// The heavy dialogs (settings, purchase history) are code-split, so the topbar
// renders them under a `v-if="everOpened"` that flips true in the same tick as
// `open`. On the first open that means the component mounts with `open`
// ALREADY true, so the overlay exists on the Transition's very first render —
// and Vue does not run an enter transition on initial render unless asked.
// Every later open toggles `open` on a component that is already mounted, which
// is the ordinary case and always worked.
//
// `appear` on the Transition is what covers the first render. These pin it,
// because the symptom is a missing animation: nothing throws, nothing fails,
// it just quietly looks cheap.
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AppModal from '../src/components/AppModal.vue'

// Vue Test Utils stubs Transition by default, which would render the overlay
// with no transition classes at all and make every assertion here vacuous.
const withRealTransitions = { global: { stubs: { transition: false } } }

const open = (props) => mount(AppModal, { props, ...withRealTransitions })
const overlayClasses = (w) => w.find('.app-modal-overlay').classes()

describe('a dialog that mounts already open', () => {
  it('still runs its enter transition', () => {
    // Exactly how AppTopbar mounts HouseholdSettingsModal the first time.
    const wrapper = open({ open: true, transition: 'modal-fade' })

    expect(overlayClasses(wrapper)).toContain('modal-fade-enter-active')
    expect(overlayClasses(wrapper)).toContain('modal-fade-enter-from')
  })

  it('uses the transition name it was given, not a default', () => {
    const wrapper = open({ open: true, transition: 'confirm-fade' })
    expect(overlayClasses(wrapper)).toContain('confirm-fade-enter-active')
  })

  it('falls back to the shared dialog transition when none is named', () => {
    const wrapper = open({ open: true })
    expect(overlayClasses(wrapper)).toContain('app-modal-fade-enter-active')
  })
})

describe('a dialog that is already mounted when it opens', () => {
  it('runs its enter transition too', async () => {
    // AccountActionModal's case: mounted with the topbar, opened later. This
    // always worked; it is here so a fix for the case above cannot break it.
    const wrapper = open({ open: false, transition: 'modal-fade' })
    expect(wrapper.find('.app-modal-overlay').exists()).toBe(false)

    await wrapper.setProps({ open: true })

    expect(overlayClasses(wrapper)).toContain('modal-fade-enter-active')
  })

  it('renders nothing at all while closed', () => {
    const wrapper = open({ open: false, transition: 'modal-fade' })
    expect(wrapper.find('.app-modal-overlay').exists()).toBe(false)
  })
})
