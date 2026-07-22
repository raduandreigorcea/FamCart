// @vitest-environment happy-dom
//
// The one-time first-run tour and its "seen" flag. Covers the flag helpers and
// the three-step walk-through: advancing, the final step's close, and Skip.
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import OnboardingTour from '../src/components/OnboardingTour.vue'
import { hasSeenTour, markTourSeen } from '../src/lib/onboarding'

describe('onboarding tour flag', () => {
  it('starts unseen and flips once marked', () => {
    localStorage.clear()
    expect(hasSeenTour(localStorage)).toBe(false)
    markTourSeen(localStorage)
    expect(hasSeenTour(localStorage)).toBe(true)
  })
})

describe('OnboardingTour', () => {
  it('renders nothing while closed', () => {
    const wrapper = mount(OnboardingTour, { props: { open: false } })
    expect(wrapper.find('.tour-card').exists()).toBe(false)
  })

  it('walks the three steps and closes on the last', async () => {
    const wrapper = mount(OnboardingTour, { props: { open: true, inviteCode: 'ABCDEFGH' } })
    // First step, no Back yet.
    expect(wrapper.find('.tour-back').exists()).toBe(false)
    expect(wrapper.find('.tour-next').text()).toBe('Next')

    await wrapper.find('.tour-next').trigger('click') // → swipe
    await wrapper.find('.tour-next').trigger('click') // → invite (last)
    expect(wrapper.find('.tour-next').text()).toBe('Start shopping')
    // The invite step surfaces the family's code.
    expect(wrapper.text()).toContain('ABCDEFGH')

    await wrapper.find('.tour-next').trigger('click') // finish
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('can be skipped from any step', async () => {
    const wrapper = mount(OnboardingTour, { props: { open: true } })
    await wrapper.find('.tour-skip').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
