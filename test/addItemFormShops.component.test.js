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

// The visible mark is a logo now, so the assertion reads the accessible name
// rather than the rendered text -- which is also the thing that would break if
// the logo were shown with nothing to say what it is.
const shops = (wrapper) => wrapper.findAll('.shop-badge__name').map((s) => s.text())
const discs = (wrapper) => wrapper.findAll('.shop-badge')

describe('the shop a suggestion came from', () => {
  it('names every shop carrying it, on nightly', async () => {
    const wrapper = await mountForm(true)
    expect(shops(wrapper)).toEqual(['Auchan', 'Carrefour', 'Lidl'])
  })

  it('draws the marks that stay crisp as marks', async () => {
    const wrapper = await mountForm(true)
    // Auchan's bird and Carrefour's C are single bold shapes and survive being
    // 15 pixels wide. Brand colours, not the theme's: a recoloured Carrefour
    // blue is not Carrefour, so these are the one place in this app where a mark
    // is not tinted by currentColor.
    expect(wrapper.findAll('.shop-badge svg')).toHaveLength(2)
    expect(wrapper.html()).toContain('#D6180B')
    expect(wrapper.html()).toContain('#004E9F')
  })

  it('draws the one that does not as an initial instead', async () => {
    // Lidl's logo is a ring with "Lidl" inside it. Those letters are three or
    // four pixels tall here and no vector precision fixes shapes smaller than
    // the pixels available to draw them, so it read as smudged next to the other
    // two. Lidl publish no L-only mark, so this is an initial rather than their
    // design -- and it is still in their blue.
    const wrapper = await mountForm(true)
    const letters = wrapper.findAll('.shop-badge__letter').map((l) => l.text())
    expect(letters).toEqual(['L'])
    expect(wrapper.find('.shop-badge--mono').attributes('style')).toContain('#0050AA')
  })

  it('falls back to an initial for a shop whose logo nobody has drawn', async () => {
    // A fourth retailer is one line in a registry; its logo is a separate job.
    // An initial is legible in the meantime, where a missing asset is a blank
    // circle that looks like a bug.
    const wrapper = mount(AddItemForm, {
      props: {
        name: 'x',
        suggestions: [{ name: 'Ceva', maker: null, retailers: ['profi'] }],
        canAddCustom: false,
      },
    })
    await wrapper.find('input').trigger('focus')
    expect(wrapper.findAll('.shop-badge__letter').map((l) => l.text())).toEqual(['P'])
  })

  it('still says which shop it is for anything that cannot see the logo', async () => {
    const wrapper = await mountForm(true)
    expect(discs(wrapper)[0].attributes('title')).toBe('Auchan')
  })

  it('shows nothing at all on production', async () => {
    // The point of the whole gate. A shopper is not being told which of three
    // supermarkets our scraper happened to read.
    const wrapper = await mountForm(false)
    expect(shops(wrapper)).toEqual([])
    expect(discs(wrapper)).toHaveLength(0)
  })

  it('leaves a row with no shops alone rather than drawing an empty chip', async () => {
    // A product from the app database's own catalog has no `retailers` key.
    // Absent is meaningful here -- it says a household typed this in -- so it
    // has to render as nothing, not as a blank tag.
    const wrapper = await mountForm(true)
    const rows = wrapper.findAll('.suggestion-text')
    expect(rows[2].findAll('.shop-badge')).toHaveLength(0)
  })

  it('keeps the maker, which is a different fact from the shop', async () => {
    // Auchan sells products branded Auchan, so these two are routinely the same
    // word and must not render alike.
    const wrapper = await mountForm(true)
    const first = wrapper.findAll('.suggestion-text')[0]
    expect(first.find('.suggestion-maker').text()).toBe('Dorna')
    expect(first.findAll('.shop-badge__name').map((s) => s.text())).toEqual(['Auchan', 'Carrefour'])
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
    expect(shops(wrapper)).toEqual(['Auchan'])
    expect(wrapper.find('.suggestion-maker').exists()).toBe(false)
  })
})
