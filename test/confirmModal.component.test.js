// @vitest-environment happy-dom
//
// ConfirmModal is mounted several times over on one screen — HomeView alone has
// the shared ErrorModal and a limit-reached ConfirmModal, and more than one can
// be open at once. The title id used to be a hardcoded string, so every copy
// carried the same one and aria-labelledby resolved to whichever was first in
// the DOM: a screen reader could announce one dialog under another's title.
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ConfirmModal from '../src/components/ConfirmModal.vue'

const open = (title) =>
  mount(ConfirmModal, { props: { open: true, title, message: 'body' } })

const labelledBy = (w) => w.find('[role="alertdialog"]').attributes('aria-labelledby')

// Both dialogs have to live in ONE app instance to mean anything: useId counts
// per app, so mounting two components separately restarts the counter and would
// report a collision that cannot happen on a real screen. This parent is the
// shape HomeView actually renders.
const TwoDialogs = {
  components: { ConfirmModal },
  template: `
    <div>
      <ConfirmModal open title="First" message="body" />
      <ConfirmModal open title="Second" message="body" />
    </div>
  `,
}

describe('ConfirmModal labelling', () => {
  it('points aria-labelledby at its own title element', () => {
    const wrapper = open('Delete household')

    const id = labelledBy(wrapper)
    expect(id).toBeTruthy()
    expect(wrapper.find(`#${id}`).text()).toBe('Delete household')
  })

  it('gives every instance a distinct id, so two open dialogs stay distinguishable', () => {
    const wrapper = mount(TwoDialogs)
    const [first, second] = wrapper.findAllComponents(ConfirmModal)

    expect(labelledBy(first)).not.toBe(labelledBy(second))
    // Each still resolves to its own heading rather than the other's.
    expect(first.find(`#${labelledBy(first)}`).text()).toBe('First')
    expect(second.find(`#${labelledBy(second)}`).text()).toBe('Second')
  })
})
