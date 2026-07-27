// @vitest-environment happy-dom
//
// Part of the product catalog is imported from Open Food Facts, whose data is
// licensed ODbL. Publishing an app built on it obliges us to credit them
// somewhere a user can actually reach.
//
// That makes the attribution a licence term rather than a design choice, and a
// licence term nobody tests is one a redesign quietly deletes. This is the test
// that fails when that happens.
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import FamilySettingsModal from '../src/components/FamilySettingsModal.vue'

vi.mock('@clerk/vue', async () => {
  const { ref } = await import('vue')
  return {
    useAuth: () => ({ userId: ref('user-1'), isLoaded: ref(true), getToken: ref(async () => 't') }),
    useUser: () => ({ user: ref({ fullName: 'Test User', imageUrl: null }) }),
  }
})

vi.mock('../src/supabase', () => ({ useSupabase: () => ({}) }))

function mountSettings(initialTab = 'about') {
  return mount(FamilySettingsModal, {
    shallow: true,
    props: {
      open: true,
      initialTab,
      familyId: 'fam-1',
      familyName: 'Fam',
      inviteCode: 'ABCDEFGH',
      ownerUserId: 'user-1',
      memberProfiles: [],
    },
  })
}

const attributionLinks = (wrapper) =>
  wrapper.findAll('a').filter((a) => /openfoodfacts|opendatacommons/.test(a.attributes('href') ?? ''))

describe('Open Food Facts attribution', () => {
  it('is rendered where a user can see it', () => {
    const text = mountSettings().text()
    expect(text).toContain('Open Food Facts')
    expect(text).toContain('ODbL')
  })

  it('links to the project and to the licence', () => {
    const hrefs = attributionLinks(mountSettings()).map((a) => a.attributes('href'))
    expect(hrefs).toContain('https://openfoodfacts.org')
    expect(hrefs).toContain('https://opendatacommons.org/licenses/odbl/1-0/')
  })

  it('opens those links safely', () => {
    // rel=noopener because target=_blank otherwise hands the opened page a
    // reference back to this one.
    for (const link of attributionLinks(mountSettings())) {
      expect(link.attributes('target')).toBe('_blank')
      expect(link.attributes('rel')).toContain('noopener')
    }
  })
})

describe('the About tab', () => {
  it('is reachable by every member, not just owners and moderators', () => {
    // Preferences is gated on the role; About is not, so a plain member can
    // still find out where the suggested products come from.
    const buttons = mountSettings('overview').findAll('.sidebar-tab-btn')
    expect(buttons.map((b) => b.text())).toContain('About')
  })

  it('names the app', () => {
    expect(mountSettings().text()).toContain('FamCart')
  })

  // The panel is rendered with v-if, so the credit only exists while the tab is
  // open. If it ever stops being reachable, the licence obligation goes unmet.
  it('is where the attribution lives, not the overview', () => {
    expect(attributionLinks(mountSettings('overview'))).toHaveLength(0)
    expect(attributionLinks(mountSettings('about')).length).toBeGreaterThan(0)
  })
})
