// @vitest-environment happy-dom
//
// The update dialog's four faces. One dialog rather than four components, so
// what each phase actually offers is worth pinning — particularly that a
// download in progress cannot be dismissed by a stray tap on the backdrop, and
// that the failure state still leaves a way to get the APK by hand.
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import UpdateAvailableModal from '../src/components/UpdateAvailableModal.vue'
import AppButton from '../src/components/AppButton.vue'

function mountModal(props = {}) {
  return mount(UpdateAvailableModal, {
    props: { open: true, version: '0.1.24', currentVersion: '0.1.23', ...props },
  })
}

function buttonLabels(wrapper) {
  return wrapper.findAllComponents(AppButton).map((button) => button.text())
}

describe('UpdateAvailableModal', () => {
  it('names both versions in the offer', () => {
    const wrapper = mountModal()
    expect(wrapper.text()).toContain('0.1.24')
    expect(wrapper.text()).toContain("You're on 0.1.23")
    expect(buttonLabels(wrapper)).toEqual(['Later', 'Update'])
  })

  it('emits install and later from the offer', async () => {
    const wrapper = mountModal()
    const [later, update] = wrapper.findAllComponents(AppButton)
    await update.trigger('click')
    await later.trigger('click')
    expect(wrapper.emitted('install')).toHaveLength(1)
    expect(wrapper.emitted('later')).toHaveLength(1)
  })

  it('explains the permission instead of reporting an error', async () => {
    const wrapper = mountModal({ phase: 'permission' })
    expect(wrapper.text()).toContain('Allow from this source')
    expect(buttonLabels(wrapper)).toEqual(['Not now', 'Open settings'])

    await wrapper.findAllComponents(AppButton)[1].trigger('click')
    expect(wrapper.emitted('open-settings')).toHaveLength(1)
  })

  it('shows a real percentage while downloading', () => {
    const wrapper = mountModal({ phase: 'downloading', progress: 0.42 })
    expect(wrapper.text()).toContain('42%')
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('42')
  })

  it('sweeps rather than claiming a number it does not have', () => {
    const wrapper = mountModal({ phase: 'downloading', progress: -1 })
    expect(wrapper.text()).not.toContain('%')
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBeUndefined()
    expect(wrapper.find('.update-dialog__fill--unknown').exists()).toBe(true)
  })

  it('ignores a tap on the backdrop entirely', async () => {
    // The one dismissal with no intent worth reading: a tap landing beside the
    // dialog is as likely to be a missed press as an answer, so it neither
    // closes nor declines.
    const wrapper = mountModal({ phase: 'available' })
    await wrapper.find('.app-modal-overlay').trigger('click')
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.emitted('later')).toBeUndefined()
  })

  it('declines on Escape, which is Android Back', async () => {
    // Back is the dialog's "no" button on a phone, and it arrives here as the
    // same close request Escape makes. Treating it as anything softer than the
    // Later button would ignore a deliberate answer.
    const wrapper = mountModal({ phase: 'available' })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('later')).toHaveLength(1)
  })

  it('does not decline on Escape mid-download', async () => {
    const wrapper = mountModal({ phase: 'downloading', progress: 0.1 })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('later')).toBeUndefined()
  })

  it('still declines from the Later button', async () => {
    const wrapper = mountModal({ phase: 'available' })
    await wrapper.findAllComponents(AppButton)[0].trigger('click')
    expect(wrapper.emitted('later')).toHaveLength(1)
  })

  it('leaves a way to the APK when the download fails', async () => {
    const wrapper = mountModal({ phase: 'error' })
    expect(buttonLabels(wrapper)).toEqual(['Open releases', 'Try again'])

    const [releases, retry] = wrapper.findAllComponents(AppButton)
    await releases.trigger('click')
    await retry.trigger('click')
    expect(wrapper.emitted('open-releases')).toHaveLength(1)
    expect(wrapper.emitted('install')).toHaveLength(1)
  })

  it('says the data is safe once Android has taken over', () => {
    const wrapper = mountModal({ phase: 'installing' })
    expect(wrapper.text()).toContain('stay exactly as they are')
    expect(buttonLabels(wrapper)).toEqual(['Close', 'Try again'])
  })

  it('can retry from the handover screen', async () => {
    // Reachable only when the resume listener failed to register, which is
    // exactly when Close on its own would leave no way forward.
    const wrapper = mountModal({ phase: 'installing' })
    await wrapper.findAllComponents(AppButton)[1].trigger('click')
    expect(wrapper.emitted('install')).toHaveLength(1)
  })
})
