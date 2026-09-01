// @vitest-environment happy-dom
//
// Promoting, demoting and removing a member: the writes that change who can do
// what inside a household, and the one that ends somebody's access to it.
//
// lib/memberRoles owns the RULES and has its own tests. What is untested is the
// panel's half — that the affordance it draws and the write it then sends agree
// with each other. They can disagree in both directions, and the dangerous
// direction is silent: a write issued for an action the UI never offered is not
// visible on screen at all, and the only thing left refusing it is RLS.
//
// The role guard is checked here rather than only in memberRoles because
// setMemberRole carries its OWN `if (!props.isOwner) return`. Two copies of one
// rule is exactly the arrangement where one of them quietly stops matching.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import MembersPanel from '../src/components/householdSettings/MembersPanel.vue'
import { createFakeDb } from './support/fakeSupabase.js'

const mocks = vi.hoisted(() => ({ db: null, userId: null }))

vi.mock('../src/supabase', () => ({
  useSupabase: () => mocks.db,
  getCatalogSupabase: () => null,
}))

vi.mock('@clerk/vue', async () => {
  const { ref } = await import('vue')
  mocks.userId = ref('u_owner')
  return { useAuth: () => ({ userId: mocks.userId }) }
})

const OWNER = { user_id: 'u_owner', display_name: 'Radu', role: 'moderator' }
const MOD = { user_id: 'u_mod', display_name: 'Alex', role: 'moderator' }
const PLAIN = { user_id: 'u_plain', display_name: 'Ioana', role: 'member' }

const wrappers = []

function mountPanel({ answer = true, ...props } = {}) {
  const confirm = vi.fn(async () => answer)
  const w = mount(MembersPanel, {
    props: {
      householdId: 'hh-1',
      ownerUserId: 'u_owner',
      isOwner: true,
      isOwnerOrModerator: true,
      memberProfiles: [OWNER, MOD, PLAIN],
      confirm,
      ...props,
    },
  })
  wrappers.push(w)
  return { wrapper: w, confirm }
}

// Open one member's action menu. The rows are sorted for display, so a row is
// found by the id on its trigger's own wrapper rather than by position.
async function openMenuFor(wrapper, userId) {
  const rows = wrapper.findAll('.member-custom-item')
  for (const row of rows) {
    if (!row.text().includes(nameOf(userId))) continue
    const trigger = row.find('.member-actions-trigger')
    if (!trigger.exists()) return null
    await trigger.trigger('click')
    return row
  }
  return null
}

function nameOf(userId) {
  return [OWNER, MOD, PLAIN].find((m) => m.user_id === userId).display_name
}

const writes = (table, op) => mocks.db.calls.filter((c) => c.table === table && c.op === op)

beforeEach(() => {
  mocks.db = createFakeDb()
  mocks.userId.value = 'u_owner'
})

afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
  vi.restoreAllMocks()
})

describe('changing a member’s role', () => {
  it('promotes to moderator, scoped to the household and the member', async () => {
    mocks.db.handlers['household_members.update'] = () => ({ data: null, error: null })
    const { wrapper } = mountPanel()

    const row = await openMenuFor(wrapper, 'u_plain')
    await row.find('.member-action-item').trigger('click')
    await flushPromises()

    const updates = writes('household_members', 'update')
    expect(updates).toHaveLength(1)
    expect(updates[0].payload).toEqual({ role: 'moderator' })
    // Both filters: without the user_id one this rewrites the whole roster.
    expect(updates[0].filters).toEqual({ household_id: 'hh-1', user_id: 'u_plain' })
    expect(wrapper.emitted('refresh-household')).toHaveLength(1)
  })

  it('demotes a moderator back to member', async () => {
    mocks.db.handlers['household_members.update'] = () => ({ data: null, error: null })
    const { wrapper } = mountPanel()

    const row = await openMenuFor(wrapper, 'u_mod')
    await row.find('.member-action-item').trigger('click')
    await flushPromises()

    const updates = writes('household_members', 'update')
    expect(updates[0].payload).toEqual({ role: 'member' })
    expect(updates[0].filters.user_id).toBe('u_mod')
  })

  it('surfaces a rejected role change instead of reporting success', async () => {
    mocks.db.handlers['household_members.update'] = () => ({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    })
    const { wrapper } = mountPanel()

    const row = await openMenuFor(wrapper, 'u_plain')
    await row.find('.member-action-item').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('error')).toHaveLength(1)
    expect(wrapper.emitted('refresh-household')).toBeUndefined()
  })

  // A moderator may remove members but may not change ranks, so the promote and
  // demote rows are not drawn for them.
  it('offers a moderator removal but not promotion or demotion', async () => {
    mocks.userId.value = 'u_mod'
    const { wrapper } = mountPanel({ isOwner: false, isOwnerOrModerator: true })

    const row = await openMenuFor(wrapper, 'u_plain')
    const actions = row.findAll('.member-action-item')
    expect(actions).toHaveLength(1)
    expect(actions[0].classes()).toContain('member-action-item--danger')
  })
})

describe('removing a member', () => {
  it('deletes the one membership row after the confirm', async () => {
    mocks.db.handlers['household_members.delete'] = () => ({ data: null, error: null })
    const { wrapper, confirm } = mountPanel()

    const row = await openMenuFor(wrapper, 'u_plain')
    await row.find('.member-action-item--danger').trigger('click')
    await flushPromises()

    expect(confirm).toHaveBeenCalled()
    const deletes = writes('household_members', 'delete')
    expect(deletes).toHaveLength(1)
    expect(deletes[0].filters).toEqual({ household_id: 'hh-1', user_id: 'u_plain' })
    expect(wrapper.emitted('refresh-household')).toHaveLength(1)
  })

  it('writes nothing when the confirm is declined', async () => {
    const { wrapper } = mountPanel({ answer: false })

    const row = await openMenuFor(wrapper, 'u_plain')
    await row.find('.member-action-item--danger').trigger('click')
    await flushPromises()

    expect(writes('household_members', 'delete')).toHaveLength(0)
    expect(wrapper.emitted('refresh-household')).toBeUndefined()
  })

  it('surfaces a rejected removal', async () => {
    mocks.db.handlers['household_members.delete'] = () => ({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    })
    const { wrapper } = mountPanel()

    const row = await openMenuFor(wrapper, 'u_plain')
    await row.find('.member-action-item--danger').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('error')).toHaveLength(1)
    expect(wrapper.emitted('refresh-household')).toBeUndefined()
  })
})

// Who gets an actions button at all. These are the cases where drawing one
// would offer an action the database is going to refuse.
describe('who can be acted on', () => {
  it('never offers actions against the owner', async () => {
    const { wrapper } = mountPanel()
    const ownerRow = wrapper
      .findAll('.member-custom-item')
      .find((r) => r.text().includes('Radu'))
    expect(ownerRow.find('.member-actions-trigger').exists()).toBe(false)
  })

  it('never offers actions against yourself', async () => {
    mocks.userId.value = 'u_mod'
    const { wrapper } = mountPanel({ isOwner: false, isOwnerOrModerator: true })
    const ownRow = wrapper
      .findAll('.member-custom-item')
      .find((r) => r.text().includes('Alex'))
    expect(ownRow.find('.member-actions-trigger').exists()).toBe(false)
  })

  it('offers a plain member no actions at all', async () => {
    mocks.userId.value = 'u_plain'
    const { wrapper } = mountPanel({ isOwner: false, isOwnerOrModerator: false })
    expect(wrapper.findAll('.member-actions-trigger')).toHaveLength(0)
  })
})
