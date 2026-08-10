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

// The three tone marks come from the icon set now. Two of them used to be
// written inline as <svg> in the template, with a comment saying they had no
// asset of their own — info.svg did exist, unreferenced by anything, and is a
// near-identical silhouette to the exclamation it replaces.
describe('ConfirmModal tone icons', () => {
  const mountTone = (props) =>
    mount(ConfirmModal, { props: { open: true, title: 't', message: 'm', ...props } })

  const icon = (w) => w.find('.confirm-dialog__icon')

  it('draws every tone from an asset, never inline markup', () => {
    for (const tone of ['danger', 'warning', 'success']) {
      const wrapper = mountTone({ tone })
      // A span with the asset injected into it, not an <svg> authored in the
      // template: the icon element itself is never the svg.
      expect(icon(wrapper).element.tagName).toBe('SPAN')
      expect(icon(wrapper).find('svg').exists()).toBe(true)
    }
  })

  it('gives each tone its own mark', () => {
    const marks = ['danger', 'warning', 'success'].map(
      (tone) => mountTone({ tone }).find('.confirm-dialog__icon svg').attributes('class'),
    )

    expect(marks[0]).toContain('lucide-triangle-alert')
    expect(marks[1]).toContain('lucide-info')
    expect(marks[2]).toContain('lucide-check')
    expect(new Set(marks).size).toBe(3)
  })

  // resolvedTone falls back to warning, so the icon has to as well — otherwise a
  // dialog with no tone renders an empty disc.
  it('falls back to a mark when no tone is given', () => {
    expect(icon(mountTone({})).find('svg').attributes('class')).toContain('lucide-info')
    expect(icon(mountTone({ danger: true })).find('svg').attributes('class')).toContain(
      'lucide-triangle-alert',
    )
  })

  // The wrap behind it is already a 52px disc. The old success tick drew a
  // circle of its own inside it, which the danger triangle never did.
  it('leaves the ring to the wrap rather than drawing a second one', () => {
    const wrapper = mountTone({ tone: 'success' })
    expect(wrapper.find('.confirm-dialog__icon circle').exists()).toBe(false)
    expect(wrapper.find('.confirm-dialog__icon-wrap--success').exists()).toBe(true)
  })
})
