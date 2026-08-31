// @vitest-environment happy-dom
//
// The three household settings that are edited locally and committed by their
// own Save button: the name, the emoji, and the per-member item limit.
//
// Two things here are worth pinning beyond "the write happened".
//
// The item limit is written through clampItemLimit, which means the panel is
// the last thing standing between a typed number and a column with a CHECK
// constraint on it. A number outside the bound does not fail politely: it comes
// back as a raw Postgres violation the user cannot act on. The clamp is what
// makes the input incapable of producing one.
//
// And the name has a length ceiling that is enforced in TWO places — this panel
// and 003_households_and_members.sql. The local half exists so the failure is a
// sentence rather than a constraint name, and it only does that job if it
// refuses to send.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PreferencesPanel from '../src/components/householdSettings/PreferencesPanel.vue'
import { createFakeDb } from './support/fakeSupabase.js'
import { HOUSEHOLD_NAME_MAX_LENGTH } from '../src/lib/limits'

const mocks = vi.hoisted(() => ({ db: null }))

vi.mock('../src/supabase', () => ({
  useSupabase: () => mocks.db,
  getCatalogSupabase: () => null,
}))

const wrappers = []

function mountPanel(props = {}) {
  const w = mount(PreferencesPanel, {
    props: {
      householdId: 'hh-1',
      householdName: 'Gorcea',
      householdItemLimit: 50,
      householdEmoji: '🏠',
      isOwner: true,
      ...props,
    },
  })
  wrappers.push(w)
  return w
}

const updates = () => mocks.db.calls.filter((c) => c.table === 'households' && c.op === 'update')

// The three Save buttons sit in document order: name, emoji, item limit. A
// moderator sees only the last of them.
const saveButtons = (wrapper) => wrapper.findAll('.panel-save-btn')

beforeEach(() => {
  mocks.db = createFakeDb()
  mocks.db.handlers['households.update'] = () => ({ data: null, error: null })
})

afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
  vi.restoreAllMocks()
})

describe('renaming the household', () => {
  it('trims and saves the new name', async () => {
    const wrapper = mountPanel()
    await wrapper.find('.panel-input').setValue('  Casa Noastra  ')
    await saveButtons(wrapper)[0].trigger('click')
    await flushPromises()

    expect(updates()).toHaveLength(1)
    expect(updates()[0].payload).toEqual({ name: 'Casa Noastra' })
    expect(updates()[0].filters).toEqual({ id: 'hh-1' })
    expect(wrapper.emitted('refresh-household')).toHaveLength(1)
  })

  it('refuses a name past the ceiling with a sentence, not a constraint', async () => {
    const wrapper = mountPanel()
    await wrapper.find('.panel-input').setValue('x'.repeat(HOUSEHOLD_NAME_MAX_LENGTH + 1))
    await saveButtons(wrapper)[0].trigger('click')
    await flushPromises()

    // Nothing sent: the database's own CHECK would have answered with a
    // violation nobody can read.
    expect(updates()).toHaveLength(0)
    const [message, title] = wrapper.emitted('error')[0]
    expect(message).toContain(String(HOUSEHOLD_NAME_MAX_LENGTH))
    expect(title).toBeTruthy()
  })

  it('sends nothing for a name that is only whitespace', async () => {
    const wrapper = mountPanel()
    await wrapper.find('.panel-input').setValue('   ')
    await saveButtons(wrapper)[0].trigger('click')
    await flushPromises()

    expect(updates()).toHaveLength(0)
  })

  it('surfaces a rejected rename instead of reporting success', async () => {
    mocks.db.handlers['households.update'] = () => ({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    })
    const wrapper = mountPanel()
    await wrapper.find('.panel-input').setValue('Casa Noastra')
    await saveButtons(wrapper)[0].trigger('click')
    await flushPromises()

    expect(wrapper.emitted('error')).toHaveLength(1)
    expect(wrapper.emitted('refresh-household')).toBeUndefined()
  })
})

describe('the household emoji', () => {
  it('saves the picked emoji', async () => {
    const wrapper = mountPanel({ householdEmoji: '' })
    await wrapper.findAll('.emoji-option')[2].trigger('click')
    const picked = wrapper.findAll('.emoji-option')[2].text()
    await saveButtons(wrapper)[1].trigger('click')
    await flushPromises()

    expect(updates()[0].payload).toEqual({ emoji: picked })
  })

  // Tapping the current selection clears it, and "no emoji" has to reach the
  // column as NULL rather than as an empty string.
  it('writes null when the selection is cleared', async () => {
    const wrapper = mountPanel({ householdEmoji: '' })
    const first = wrapper.findAll('.emoji-option')[0]
    await first.trigger('click')
    await first.trigger('click')
    await saveButtons(wrapper)[1].trigger('click')
    await flushPromises()

    expect(updates()[0].payload).toEqual({ emoji: null })
  })
})

// The control is a range input carrying its own min and max, so the browser
// has already constrained the value before the panel sees it. That makes
// clampItemLimit unreachable from here — the DOM cannot produce an
// out-of-range value to feed it — which is why the clamp is pinned in
// test/limits.test.js against the inputs that CAN be out of range (a database
// value, a stale cached snapshot) rather than pretended at through a slider.
describe('the per-member item limit', () => {
  it('writes the value the slider is on, scoped to the household', async () => {
    const wrapper = mountPanel()
    await wrapper.find('input[type="range"]').setValue('12')
    await saveButtons(wrapper).at(-1).trigger('click')
    await flushPromises()

    expect(updates()).toHaveLength(1)
    expect(updates()[0].payload).toEqual({ max_items_per_member: 12 })
    expect(updates()[0].filters).toEqual({ id: 'hh-1' })
    expect(wrapper.emitted('refresh-household')).toHaveLength(1)
  })

  // The slider seeds from the prop, so a household whose stored limit is out of
  // range must not have that value written straight back out.
  it('seeds from the stored limit rather than from a default', async () => {
    const wrapper = mountPanel({ householdItemLimit: 20 })
    await saveButtons(wrapper).at(-1).trigger('click')
    await flushPromises()

    expect(updates()[0].payload).toEqual({ max_items_per_member: 20 })
  })

  // The one setting a moderator may change, which is why it sits outside the
  // isOwner sections.
  it('is the only thing a moderator is offered', async () => {
    const wrapper = mountPanel({ isOwner: false })
    expect(saveButtons(wrapper)).toHaveLength(1)

    await saveButtons(wrapper)[0].trigger('click')
    await flushPromises()

    expect(updates()[0].payload).toHaveProperty('max_items_per_member')
  })

  it('surfaces a rejected save', async () => {
    mocks.db.handlers['households.update'] = () => ({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    })
    const wrapper = mountPanel()
    await saveButtons(wrapper).at(-1).trigger('click')
    await flushPromises()

    expect(wrapper.emitted('error')).toHaveLength(1)
    expect(wrapper.emitted('refresh-household')).toBeUndefined()
  })
})
