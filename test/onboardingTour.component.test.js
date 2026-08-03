// @vitest-environment happy-dom
//
// The one-time first-run tour and its "seen" flag. Covers the flag helpers and
// the four-step walk-through: advancing, the final step's close, and Skip.
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

  it('walks the four steps and closes on the last', async () => {
    const wrapper = mount(OnboardingTour, { props: { open: true, inviteCode: 'ABCDEFGH' } })
    // First step, no Back yet. Back is the shared BackButton, hence .back-btn.
    expect(wrapper.find('.back-btn').exists()).toBe(false)
    expect(wrapper.find('.tour-next').text()).toBe('Next')

    await wrapper.find('.tour-next').trigger('click') // → swipe
    await wrapper.find('.tour-next').trigger('click') // → check out
    await wrapper.find('.tour-next').trigger('click') // → invite (last)
    expect(wrapper.find('.tour-next').text()).toBe('Start shopping')
    // The invite step surfaces the family's code.
    expect(wrapper.text()).toContain('ABCDEFGH')

    await wrapper.find('.tour-next').trigger('click') // finish
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  // Checking a row does not buy it: buy_items only runs when the bar is slid.
  // The tour taught swipe-to-check and then stopped, so a user could tick the
  // whole list and never learn how to finish. This pins that beat in place.
  it('teaches the checkout slide, which the swipe step leaves unfinished', async () => {
    const wrapper = mount(OnboardingTour, { props: { open: true } })
    await wrapper.find('.tour-next').trigger('click') // → swipe
    await wrapper.find('.tour-next').trigger('click') // → check out

    expect(wrapper.text()).toContain('Slide to check out')
    expect(wrapper.find('.art-bar__thumb').exists()).toBe(true)
  })

  // Each step opens with an illustration of the thing it teaches, so a decorative
  // emoji above the title was saying nothing the picture had not already said.
  it('carries no decorative emoji above the title', async () => {
    const wrapper = mount(OnboardingTour, { props: { open: true } })
    expect(wrapper.find('.tour-emoji').exists()).toBe(false)
  })

  it('steps back with the shared BackButton', async () => {
    const wrapper = mount(OnboardingTour, { props: { open: true } })
    await wrapper.find('.tour-next').trigger('click') // → swipe

    const back = wrapper.find('.back-btn')
    expect(back.exists()).toBe(true)
    await back.trigger('click')

    // Returned to the first step, so Back is gone again.
    expect(wrapper.find('.back-btn').exists()).toBe(false)
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('can be skipped from any step', async () => {
    const wrapper = mount(OnboardingTour, { props: { open: true } })
    await wrapper.find('.tour-skip').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
