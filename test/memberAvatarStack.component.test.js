// @vitest-environment happy-dom
//
// The stack's one rule worth pinning: it never collapses to a "+1", because
// hiding a face to show a "+1" bubble in its place saves no room at all. It
// renders up to maxVisible + 1 members in full, and only past that does it show
// maxVisible faces and roll the rest into "+n".
//
// This replaces test/avatarStack.test.js, which asserted the same rule against a
// copy of it written in the test file. The rule lives in the component, so it is
// tested here.
import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import MemberAvatarStack from '../src/components/MemberAvatarStack.vue'

const wrappers = []

function mountStack(memberCount, props = {}) {
  const members = Array.from({ length: memberCount }, (_, i) => ({
    user_id: `u_${i}`,
    display_name: `Member ${i}`,
    image_url: '',
  }))
  const w = mount(MemberAvatarStack, { props: { members, ...props } })
  wrappers.push(w)
  return w
}

const shapeOf = (wrapper) => {
  const badge = wrapper.find('.member-avatar--more')
  return {
    avatars: wrapper.findAll('.member-avatar:not(.member-avatar--more)').length,
    badge: badge.exists() ? Number(badge.text().replace('+', '')) : 0,
  }
}

afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
})

describe('MemberAvatarStack', () => {
  it('shows every member up to one over the cap, then collapses', () => {
    // Default maxVisible is 4, so five faces still all render.
    expect(shapeOf(mountStack(4))).toEqual({ avatars: 4, badge: 0 })
    expect(shapeOf(mountStack(5))).toEqual({ avatars: 5, badge: 0 })
    expect(shapeOf(mountStack(6))).toEqual({ avatars: 4, badge: 2 })
    expect(shapeOf(mountStack(7))).toEqual({ avatars: 4, badge: 3 })
  })

  it('never renders a "+1", at any member count', () => {
    for (let members = 1; members <= 9; members++) {
      expect(shapeOf(mountStack(members)).badge).not.toBe(1)
    }
  })

  it('renders nothing when the household has no members and is not loading', () => {
    const wrapper = mountStack(0)
    expect(wrapper.find('.member-stack').exists()).toBe(false)
  })

  it('shows placeholder circles while the roster loads', () => {
    const wrapper = mountStack(0, { loading: true })
    expect(wrapper.findAll('.member-avatar').length).toBe(3)
  })

  it('falls back to the first letter of the name when a member has no photo', () => {
    const wrapper = mountStack(1)
    expect(wrapper.find('.member-avatar--fallback').text()).toBe('M')
  })
})
