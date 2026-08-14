// @vitest-environment happy-dom
//
// The form's argument is that it asks two questions instead of showing one big
// textarea: where, and what. These pin that shape — that a bug cannot be sent
// without a place, that an idea is never asked for one, and that a send which
// went nowhere says so instead of thanking the person.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ReportIssueModal from '../src/components/ReportIssueModal.vue'

const send = vi.hoisted(() => vi.fn())
vi.mock('../src/lib/issueReport', async (importOriginal) => ({
  ...(await importOriginal()),
  submitReport: send,
}))

const wrappers = []
function mountReport(props) {
  const w = mount(ReportIssueModal, { props: { open: true, userId: 'u1', ...props } })
  wrappers.push(w)
  return w
}

const places = (w) => w.findAll('.report-place')
const kinds = (w) => w.findAll('.report-segmented__btn')
const sendBtn = (w) => w.findAll('.report-actions button')[1]

async function fillBug(wrapper, text = 'ticked milk and it came back after a reload') {
  await places(wrapper)[0].trigger('click')
  await wrapper.find('.report-textarea').setValue(text)
}

beforeEach(() => {
  send.mockReset().mockResolvedValue(true)
})

afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
})

describe('asking where', () => {
  it('offers the app\'s own places to pick from, not a blank field', () => {
    const wrapper = mountReport()

    expect(places(wrapper).length).toBeGreaterThan(3)
    expect(wrapper.text()).toContain('Shopping list')
    expect(wrapper.text()).toContain('Barcode scanner')
  })

  // The section stays put when the kind changes: mounting and unmounting it
  // resized the whole dialog under the finger. It stays optional for feedback,
  // so that stability costs no extra tap.
  //
  // The label used to reword itself between the two kinds as well. It does not
  // any more -- one question that is true of both is one less thing moving --
  // so what is pinned here is that nothing shifts, not which words are used.
  it('keeps the question in place for feedback, unchanged and optional', async () => {
    const wrapper = mountReport()
    const before = places(wrapper).length
    const label = wrapper.find('#report-where-label').text()

    await kinds(wrapper)[1].trigger('click')

    expect(places(wrapper)).toHaveLength(before)
    expect(wrapper.find('#report-where-label').text()).toContain('Where in the app?')
    expect(label).toContain('Where in the app?')
    expect(wrapper.find('.report-optional').exists()).toBe(true)
  })

  it('lets feedback send without a place, unlike a bug', async () => {
    const wrapper = mountReport()
    await kinds(wrapper)[1].trigger('click')
    await wrapper.find('.report-textarea').setValue('removing someone is hard to find')

    expect(sendBtn(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('lets a picked place be unpicked', async () => {
    const wrapper = mountReport()

    await places(wrapper)[0].trigger('click')
    expect(places(wrapper)[0].attributes('aria-pressed')).toBe('true')

    await places(wrapper)[0].trigger('click')
    expect(places(wrapper)[0].attributes('aria-pressed')).toBe('false')
  })

  // The question never left the screen, so neither should the answer.
  it('carries the picked place across a change of kind', async () => {
    const wrapper = mountReport()

    await places(wrapper)[0].trigger('click')
    await kinds(wrapper)[1].trigger('click')

    expect(places(wrapper)[0].attributes('aria-pressed')).toBe('true')
  })
})

describe('sending', () => {
  it('holds the send until a bug has both a place and a description', async () => {
    const wrapper = mountReport()
    expect(sendBtn(wrapper).attributes('disabled')).toBeDefined()

    await wrapper.find('.report-textarea').setValue('ticked milk and it came back')
    // Described, but still nowhere.
    expect(sendBtn(wrapper).attributes('disabled')).toBeDefined()

    await places(wrapper)[0].trigger('click')
    expect(sendBtn(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('sends the place and the diagnostics the app read for itself', async () => {
    const wrapper = mountReport({ householdId: 'h1' })
    await fillBug(wrapper)
    await sendBtn(wrapper).trigger('click')

    const report = send.mock.calls[0][0]
    expect(report.kind).toBe('bug')
    expect(report.surface).toBe('list')
    expect(report.diagnostics.householdId).toBe('h1')
    expect(report.diagnostics.version).toBeTruthy()
  })

  // Closing on success would leave someone staring at the screen behind, with
  // no evidence the press did anything.
  it('replaces the form with confirmation rather than closing', async () => {
    const wrapper = mountReport()
    await fillBug(wrapper)
    await sendBtn(wrapper).trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Report sent')
    expect(wrapper.find('.report-textarea').exists()).toBe(false)
    expect(wrapper.emitted('close')).toBeFalsy()
  })

  // The one thing a report form must never get wrong.
  it('says nothing was sent when nothing was, and keeps the text', async () => {
    send.mockResolvedValue(false)
    const wrapper = mountReport()
    await fillBug(wrapper, 'scanner froze on the third item')
    await sendBtn(wrapper).trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.report-failed').exists()).toBe(true)
    expect(wrapper.text()).toContain('Nothing was sent')
    expect(wrapper.find('.report-textarea').element.value).toBe('scanner froze on the third item')
  })
})

describe('what it tells you it is sending', () => {
  // Nothing travels that the reporter was not shown first.
  it('lists the attached facts in plain words', () => {
    const wrapper = mountReport({ householdId: 'h1' })

    const attached = wrapper.find('.report-attached').text()
    expect(attached).toContain('FamCart')
    // Ids are named, never printed.
    expect(attached).not.toContain('h1')
  })
})

describe('reopening', () => {
  it('comes back blank after a report was sent', async () => {
    const wrapper = mountReport()
    await fillBug(wrapper)
    await sendBtn(wrapper).trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Report sent')

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })

    expect(wrapper.find('.report-textarea').element.value).toBe('')
    expect(places(wrapper).every((p) => p.attributes('aria-pressed') === 'false')).toBe(true)
  })
})
