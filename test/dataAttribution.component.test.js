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

function mountSettings() {
  return mount(FamilySettingsModal, {
    shallow: true,
    props: {
      open: true,
      familyId: 'fam-1',
      familyName: 'Fam',
      inviteCode: 'ABCDEFGH',
      ownerUserId: 'user-1',
      memberProfiles: [],
    },
  })
}

describe('Open Food Facts attribution', () => {
  it('is rendered where a user can see it', () => {
    const text = mountSettings().text()
    expect(text).toContain('Open Food Facts')
    expect(text).toContain('ODbL')
  })

  it('links to the project and to the licence', () => {
    const hrefs = mountSettings()
      .findAll('.attribution-note a')
      .map((a) => a.attributes('href'))

    expect(hrefs).toContain('https://openfoodfacts.org')
    expect(hrefs).toContain('https://opendatacommons.org/licenses/odbl/1-0/')
  })

  it('opens those links safely', () => {
    // rel=noopener because target=_blank otherwise hands the opened page a
    // reference back to this one.
    for (const link of mountSettings().findAll('.attribution-note a')) {
      expect(link.attributes('target')).toBe('_blank')
      expect(link.attributes('rel')).toContain('noopener')
    }
  })
})
