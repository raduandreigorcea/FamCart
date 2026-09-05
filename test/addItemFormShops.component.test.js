// @vitest-environment happy-dom
//
// Which shop a suggestion came from, shown on nightly only.
//
// It is a development aid rather than a feature: while the catalog is being
// filled, "did this come from a real shop or from something this household typed
// in?" is the one question you cannot answer by looking at the row. A production
// build must not render it at all, which is the half of this that needs a test --
// a debugging affordance that quietly ships is worse than one that never existed.
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AddItemForm from '../src/components/AddItemForm.vue'

const channel = vi.hoisted(() => ({ nightly: false }))

vi.mock('../src/lib/appChannel', async (importOriginal) => ({
  ...(await importOriginal()),
  // A getter, not a value: the component reads the binding on every render, so
  // one mocked module serves both cases.
  get IS_NIGHTLY() {
    return channel.nightly
  },
}))

// Two shops, one shop, and a row from the app database's own search_catalog --
// which returns no `retailers` at all, because those products came from a
// household rather than from a scrape.
const SUGGESTIONS = [
  { name: 'Apa plata Dorna 2L', maker: 'Dorna', retailers: ['auchan', 'carrefour'] },
  { name: 'Ciocolata', maker: 'Ritter SPORT', retailers: ['lidl'] },
  { name: 'Ceva scris de mana', maker: null },
]

async function mountForm(nightly) {
  channel.nightly = nightly
  const wrapper = mount(AddItemForm, {
    props: { name: 'apa', suggestions: SUGGESTIONS, canAddCustom: false },
  })
  await wrapper.find('input').trigger('focus')
  return wrapper
}

const shops = (wrapper) => wrapper.findAll('.suggestion-shop').map((s) => s.text())

describe('the shop a suggestion came from', () => {
  it('names every shop carrying it, on nightly', async () => {
    const wrapper = await mountForm(true)
    expect(shops(wrapper)).toEqual(['auchan', 'carrefour', 'lidl'])
  })

  it('shows nothing at all on production', async () => {
    // The point of the whole gate. A shopper is not being told which of three
    // supermarkets our scraper happened to read.
    const wrapper = await mountForm(false)
    expect(shops(wrapper)).toEqual([])
  })

  it('leaves a row with no shops alone rather than drawing an empty chip', async () => {
    // A product from the app database's own catalog has no `retailers` key.
    // Absent is meaningful here -- it says a household typed this in -- so it
    // has to render as nothing, not as a blank tag.
    const wrapper = await mountForm(true)
    const rows = wrapper.findAll('.suggestion-text')
    expect(rows[2].findAll('.suggestion-shop')).toHaveLength(0)
  })

  it('keeps the maker, which is a different fact from the shop', async () => {
    // Auchan sells products branded Auchan, so these two are routinely the same
    // word and must not render alike.
    const wrapper = await mountForm(true)
    const first = wrapper.findAll('.suggestion-text')[0]
    expect(first.find('.suggestion-maker').text()).toBe('Dorna')
    expect(first.findAll('.suggestion-shop').map((s) => s.text())).toEqual(['auchan', 'carrefour'])
  })

  it('still renders the sub-line for a row that has shops but no maker', async () => {
    channel.nightly = true
    const wrapper = mount(AddItemForm, {
      props: {
        name: 'x',
        suggestions: [{ name: 'Banane', maker: null, retailers: ['auchan'] }],
        canAddCustom: false,
      },
    })
    await wrapper.find('input').trigger('focus')
    expect(shops(wrapper)).toEqual(['auchan'])
    expect(wrapper.find('.suggestion-maker').exists()).toBe(false)
  })
})
