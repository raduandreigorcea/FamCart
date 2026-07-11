// @vitest-environment happy-dom
//
// Component test for PurchaseHistoryModal: opening it fetches the family's
// purchase history and renders the rows grouped under day headers.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PurchaseHistoryModal from '../src/components/PurchaseHistoryModal.vue'
import { createFakeDb } from './support/fakeSupabase.js'

const mocks = vi.hoisted(() => ({ db: null }))

vi.mock('../src/supabase', () => ({
  useSupabase: () => mocks.db,
}))

function mountModal(props = {}) {
  mocks.db = createFakeDb()
  return { db: mocks.db, wrapper: mount(PurchaseHistoryModal, { props }) }
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PurchaseHistoryModal', () => {
  // Regression: the modal is lazy-mounted at the moment it opens, so it first
  // renders with open=true. It must still fetch (the watch is immediate); a
  // non-immediate watch skipped the first open, showing "No checkouts yet".
  it('fetches on first open even when mounted with open already true', async () => {
    mocks.db = createFakeDb()
    mocks.db.handlers['purchase_history.select'] = () => ({
      data: [
        { id: 'p1', name: 'Milk', quantity: 1, checkout_id: 'co-1', purchased_by: 'user-1', purchased_at: new Date().toISOString() },
      ],
      error: null,
    })

    const wrapper = mount(PurchaseHistoryModal, {
      props: { open: true, familyId: 'fam-1', currentUserId: 'user-1', memberProfiles: [] },
    })
    await flushPromises()

    expect(mocks.db.calls.some((c) => c.table === 'purchase_history' && c.op === 'select')).toBe(true)
    expect(wrapper.text()).toContain('Milk')
    expect(wrapper.text()).not.toContain('No checkouts yet')
  })

  it('groups a checkout under its buyer and renders its items when opened', async () => {
    const now = new Date().toISOString()
    const { db, wrapper } = mountModal({
      open: false,
      familyId: 'fam-1',
      currentUserId: 'user-1',
      memberProfiles: [{ user_id: 'user-2', display_name: 'Ana', image_url: null }],
    })
    db.handlers['purchase_history.select'] = () => ({
      data: [
        { id: 'p1', name: 'Milk', quantity: 2, checkout_id: 'co-1', purchased_by: 'user-2', purchased_at: now, added_by_name: 'Dad', added_by_image_url: null },
        { id: 'p2', name: 'Bread', quantity: 1, checkout_id: 'co-1', purchased_by: 'user-2', purchased_at: now, added_by_name: 'Mom', added_by_image_url: null },
      ],
      error: null,
    })

    await wrapper.setProps({ open: true })
    await flushPromises()

    // Queried the right family's history.
    const call = db.calls.find((c) => c.table === 'purchase_history' && c.op === 'select')
    expect(call.filters.family_id).toBe('fam-1')

    const text = wrapper.text()
    expect(text).toContain('Today')
    // Buyer header resolved from member profiles.
    expect(text).toContain('Ana')
    expect(text).toContain('Milk')
    expect(text).toContain('Bread')
    expect(text).toContain('x2')

    // Each item keeps the person who added it (adder avatar per row).
    const adders = wrapper.findAll('.history-adder')
    expect(adders).toHaveLength(2)
    expect(adders[0].attributes('title')).toBe('Added by Dad')

    // One checkout header for the shared checkout_id.
    expect(wrapper.findAll('.checkout')).toHaveLength(1)
  })

  it('labels the current user\'s own checkout as "You"', async () => {
    const { db, wrapper } = mountModal({
      open: false,
      familyId: 'fam-1',
      currentUserId: 'user-1',
      memberProfiles: [],
    })
    db.handlers['purchase_history.select'] = () => ({
      data: [
        { id: 'p1', name: 'Eggs', quantity: 1, checkout_id: 'co-9', purchased_by: 'user-1', purchased_at: new Date().toISOString() },
      ],
      error: null,
    })

    await wrapper.setProps({ open: true })
    await flushPromises()

    expect(wrapper.find('.checkout__buyer').text()).toBe('You')
  })

  it('shows an empty state when there is no history', async () => {
    const { db, wrapper } = mountModal({ open: false, familyId: 'fam-1', memberProfiles: [] })
    db.handlers['purchase_history.select'] = () => ({ data: [], error: null })

    await wrapper.setProps({ open: true })
    await flushPromises()

    expect(wrapper.text()).toContain('No checkouts yet')
  })

  it('shows an error message when the fetch fails', async () => {
    const { db, wrapper } = mountModal({ open: false, familyId: 'fam-1', memberProfiles: [] })
    db.handlers['purchase_history.select'] = () => ({ data: null, error: { message: 'boom' } })

    await wrapper.setProps({ open: true })
    await flushPromises()

    expect(wrapper.text()).toContain('Could not load history')
  })
})
