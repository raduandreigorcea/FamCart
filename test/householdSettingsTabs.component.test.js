// @vitest-environment happy-dom
//
// The settings dialog is four tab panels behind one sidebar. Two things about
// that are easy to break and invisible when they are:
//
//   • The sidebar was five plain <button>s with an `active` class — a screen
//     reader got five unlabelled controls and no indication which view was
//     showing. It is a real tablist now, and these pin that.
//   • Which tabs exist depends on the viewer's role, and the panels are
//     rendered with v-if, so a routing mistake silently shows the wrong thing
//     or nothing at all.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import HouseholdSettingsModal from '../src/components/HouseholdSettingsModal.vue'

const currentUserId = vi.hoisted(() => ({ value: 'u_owner' }))

vi.mock('@clerk/vue', () => ({ useAuth: () => ({ userId: currentUserId }) }))
vi.mock('../src/supabase', () => ({ useSupabase: () => ({}) }))

const wrappers = []

function mountSettings(props = {}) {
  const w = mount(HouseholdSettingsModal, {
    props: {
      open: true,
      householdId: 'fam_1',
      householdName: 'Gorcea',
      inviteCode: 'ABCD2345',
      ownerUserId: 'u_owner',
      memberProfiles: [
        { user_id: 'u_owner', display_name: 'Radu', role: 'moderator' },
        { user_id: 'u_plain', display_name: 'Alex', role: 'member' },
      ],
      ...props,
    },
  })
  wrappers.push(w)
  return w
}

const tabs = (w) => w.findAll('[role="tab"]')
const tabLabels = (w) => tabs(w).map((t) => t.text().replace(/\d+$/, ''))
const current = (w) => tabs(w).find((t) => t.attributes('aria-selected') === 'true')

afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
  currentUserId.value = 'u_owner'
})

describe('the settings sidebar is a real tablist', () => {
  it('marks up the nav and its buttons as tabs', () => {
    const wrapper = mountSettings()
    expect(wrapper.find('[role="tablist"]').exists()).toBe(true)
    expect(tabs(wrapper).length).toBeGreaterThan(0)
  })

  it('says which tab is current, and only one', () => {
    const wrapper = mountSettings()
    const selected = tabs(wrapper).filter((t) => t.attributes('aria-selected') === 'true')
    expect(selected).toHaveLength(1)
    expect(selected[0].text()).toContain('Overview')
  })

  it('moves the selection when another tab is chosen', async () => {
    const wrapper = mountSettings()
    await tabs(wrapper).find((t) => t.text().includes('Members')).trigger('click')
    expect(current(wrapper).text()).toContain('Members')
  })

  it('points each tab at the panel it controls, and the panel back at it', async () => {
    const wrapper = mountSettings()
    await tabs(wrapper).find((t) => t.text().includes('Danger Zone')).trigger('click')

    const tab = current(wrapper)
    const panelId = tab.attributes('aria-controls')
    const panel = wrapper.find(`#${panelId}`)

    expect(panel.exists()).toBe(true)
    expect(panel.attributes('role')).toBe('tabpanel')
    expect(panel.attributes('aria-labelledby')).toBe(tab.attributes('id'))
  })

  it('keeps only the current tab in the tab order', async () => {
    // Roving tabindex: Tab reaches the tablist once, not once per tab.
    const wrapper = mountSettings()
    const reachable = tabs(wrapper).filter((t) => t.attributes('tabindex') === '0')
    expect(reachable).toHaveLength(1)
    expect(reachable[0].attributes('aria-selected')).toBe('true')
  })
})

describe('which tabs a viewer gets', () => {
  // Every tab here changes something about THIS household. About used to sit at
  // the end and changed nothing; it describes the app, so it moved to
  // AppSettingsModal (see test/dataAttribution.component.test.js).
  it('gives an owner every household tab, and nothing about the app', () => {
    const labels = tabLabels(mountSettings())
    expect(labels).toEqual(['Overview', 'Preferences', 'Members', 'Danger Zone'])
  })

  it('withholds Preferences from a plain member', () => {
    currentUserId.value = 'u_plain'
    const labels = tabLabels(mountSettings())
    expect(labels).not.toContain('Preferences')
    // But never the ones that are theirs: leaving lives in Danger Zone.
    expect(labels).toContain('Danger Zone')
  })

  it('falls back to Overview when the current tab stops existing', async () => {
    const wrapper = mountSettings({ initialTab: 'household' })
    expect(current(wrapper).text()).toContain('Preferences')

    // Demoted while the panel is open: the tab goes, and the content area must
    // not be left blank with nothing marked current.
    await wrapper.setProps({
      ownerUserId: 'someone_else',
      memberProfiles: [{ user_id: 'u_owner', display_name: 'Radu', role: 'member' }],
    })
    await nextTick()

    expect(tabLabels(wrapper)).not.toContain('Preferences')
    expect(current(wrapper).text()).toContain('Overview')
  })
})

describe('panel routing', () => {
  it('keeps Overview mounted under the other tabs, but inert', async () => {
    // It is the tallest panel, so it is what holds the modal's height open.
    const wrapper = mountSettings()
    await tabs(wrapper).find((t) => t.text().includes('Danger Zone')).trigger('click')

    const overview = wrapper.find('#settings-panel-overview')
    expect(overview.exists()).toBe(true)
    expect(overview.classes()).toContain('tab-panel--ghost')
    expect(overview.attributes('aria-hidden')).toBe('true')
  })

  it('renders exactly one non-ghost panel at a time', async () => {
    const wrapper = mountSettings()
    for (const label of ['Members', 'Danger Zone', 'Preferences']) {
      await tabs(wrapper).find((t) => t.text().includes(label)).trigger('click')
      const live = wrapper
        .findAll('[role="tabpanel"]')
        .filter((p) => !p.classes().includes('tab-panel--ghost'))
      expect(live).toHaveLength(1)
      expect(live[0].attributes('id')).toBe(current(wrapper).attributes('aria-controls'))
    }
  })
})
