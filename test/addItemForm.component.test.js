// @vitest-environment happy-dom
//
// The suggestions dropdown: what it shows, and that picking never races the
// input's blur (the options use mousedown, not click, for exactly that reason).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AddItemForm from '../src/components/AddItemForm.vue'

const PRODUCTS = [
  { name: 'Apa Plata 2L', maker: 'Dorna' },
  { name: 'Banane 1kg', maker: null },
]

// What the phone search screen opens on before anything is typed.
const RECENTS = [
  { name: 'Paine Alba', maker: 'Vel Pitar' },
  { name: 'Oua M 10 buc', maker: null },
]

async function mountForm(props = {}) {
  const wrapper = mount(AddItemForm, {
    props: {
      name: 'apa',
      quantity: 1,
      suggestions: [],
      suggestionsLoading: false,
      canAddCustom: false,
      ...props,
    },
  })
  // The dropdown only exists while the input has focus.
  await wrapper.find('input').trigger('focus')
  return wrapper
}

const hatch = (wrapper) => wrapper.find('.suggestion--custom')

describe('AddItemForm suggestions', () => {
  it('stays closed when there is nothing to offer', async () => {
    const wrapper = await mountForm()
    expect(wrapper.find('.suggestions-wrap').exists()).toBe(false)
  })

  it('stays closed while the input is not focused', () => {
    const wrapper = mount(AddItemForm, {
      props: { name: 'apa', quantity: 1, suggestions: PRODUCTS, canAddCustom: true },
    })
    expect(wrapper.find('.suggestions-wrap').exists()).toBe(false)
  })

  it('lists the matches with their makers', async () => {
    const wrapper = await mountForm({ suggestions: PRODUCTS })
    const names = wrapper.findAll('.suggestion-name').map((n) => n.text())
    expect(names).toEqual(['Apa Plata 2L', 'Banane 1kg'])
    expect(wrapper.findAll('.suggestion-maker').map((m) => m.text())).toEqual(['Dorna'])
  })

  it('reports the picked product rather than filling the input', async () => {
    const wrapper = await mountForm({ suggestions: PRODUCTS })
    await wrapper.findAll('.suggestion')[0].trigger('mousedown')

    expect(wrapper.emitted('select')[0][0]).toEqual(PRODUCTS[0])
    // Picking must not touch the input's value — the parent adds it outright.
    expect(wrapper.emitted('update:name')).toBeUndefined()
  })

  it('opens for the escape hatch alone when nothing matched', async () => {
    const wrapper = await mountForm({ suggestions: [], canAddCustom: true })

    expect(wrapper.find('.suggestions-wrap').exists()).toBe(true)
    expect(wrapper.findAll('.suggestion')).toHaveLength(1)
    expect(hatch(wrapper).text()).toContain("Can't find it?")
  })

  it('offers the escape hatch below the matches when there are some', async () => {
    const wrapper = await mountForm({ suggestions: PRODUCTS, canAddCustom: true })

    const rows = wrapper.findAll('.suggestion')
    expect(rows).toHaveLength(3)
    // Last, so it never displaces a real product.
    expect(rows[2].classes()).toContain('suggestion--custom')
  })

  it('hides the escape hatch when the parent says the query is too short', async () => {
    const wrapper = await mountForm({ suggestions: PRODUCTS, canAddCustom: false })
    expect(hatch(wrapper).exists()).toBe(false)
  })

  it('asks the parent to open the custom-product modal', async () => {
    const wrapper = await mountForm({ suggestions: [], canAddCustom: true })
    await hatch(wrapper).trigger('mousedown')
    expect(wrapper.emitted('add-custom')).toHaveLength(1)
  })

  // While a search is running the dropdown must not answer the question it is
  // still asking: no stale matches, and above all no "Can't find it?".
  describe('while a search is running', () => {
    it('opens with skeleton rows before any match has arrived', async () => {
      const wrapper = await mountForm({ suggestions: [], suggestionsLoading: true })

      expect(wrapper.find('.suggestions-wrap').exists()).toBe(true)
      expect(wrapper.findAll('.suggestion-skeleton').length).toBeGreaterThan(0)
    })

    it('does not offer the escape hatch mid-search', async () => {
      const wrapper = await mountForm({ suggestions: [], suggestionsLoading: true, canAddCustom: true })
      expect(hatch(wrapper).exists()).toBe(false)
    })

    it('hides the previous query matches rather than passing them off as this one', async () => {
      const wrapper = await mountForm({ suggestions: PRODUCTS, suggestionsLoading: true, canAddCustom: true })

      expect(wrapper.findAll('.suggestion')).toHaveLength(0)
      expect(wrapper.findAll('.suggestion-skeleton').length).toBeGreaterThan(0)
    })

    it('marks the list busy for screen readers', async () => {
      const wrapper = await mountForm({ suggestions: [], suggestionsLoading: true })
      expect(wrapper.find('.suggestions').attributes('aria-busy')).toBe('true')
    })

    it('swaps the skeletons for the real rows once the search settles', async () => {
      const wrapper = await mountForm({ suggestions: [], suggestionsLoading: true, canAddCustom: true })
      await wrapper.setProps({ suggestions: PRODUCTS, suggestionsLoading: false })

      expect(wrapper.findAll('.suggestion-skeleton')).toHaveLength(0)
      expect(wrapper.findAll('.suggestion-name').map((n) => n.text())).toEqual([
        'Apa Plata 2L',
        'Banane 1kg',
        "Can't find it?",
      ])
      expect(wrapper.find('.suggestions').attributes('aria-busy')).toBe('false')
    })
  })

  // Every control in the add row swallows mousedown to hold focus in the input.
  // preventDefault there suppresses the focus move and nothing else, so the
  // button stays an ordinary submit button and the browser submits on click.
  // happy-dom does not implement implicit form submission, so this pins the two
  // halves it can see; the click path itself is browser spec.
  it('leaves the add button submitting the form', async () => {
    const wrapper = await mountForm()

    expect(wrapper.find('.add-btn').attributes('type')).toBe('submit')

    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('submit')).toHaveLength(1)
  })

  // The button at the end of the row does two jobs, because with nothing typed
  // there is nothing to add and it would otherwise sit there disabled — which is
  // the state it is in every time the form comes back after an add.
  describe('the button at the end of the row', () => {
    const scanIcon = (wrapper) => wrapper.find('.scan-icon')

    it('offers the scan when the field is empty', async () => {
      const wrapper = await mountForm({ name: '', canScan: true })

      expect(scanIcon(wrapper).exists()).toBe(true)
      expect(wrapper.find('.add-btn').attributes('aria-label')).toBe('Scan a barcode')
      // Live, unlike the add button it replaces. That is the whole point.
      expect(wrapper.find('.add-btn').attributes('disabled')).toBeUndefined()
      // And never a submit button, or Enter in the field would open the camera.
      expect(wrapper.find('.add-btn').attributes('type')).toBe('button')
    })

    it('hands the button back to Add as soon as there is something to add', async () => {
      const wrapper = await mountForm({ name: '', canScan: true })

      await wrapper.setProps({ name: 'apa' })

      expect(scanIcon(wrapper).exists()).toBe(false)
      expect(wrapper.find('.add-btn').attributes('type')).toBe('submit')
      expect(wrapper.find('.add-btn').attributes('aria-label')).toBe('Add')
    })

    it('treats a field holding only spaces as empty', async () => {
      const wrapper = await mountForm({ name: '   ', canScan: true })

      expect(scanIcon(wrapper).exists()).toBe(true)
    })

    it('stays the plain add button on a device that cannot scan', async () => {
      // A control that would fail is worse than no control: the browser is never
      // offered a camera it does not have.
      const wrapper = await mountForm({ name: '', canScan: false })

      expect(scanIcon(wrapper).exists()).toBe(false)
      expect(wrapper.find('.add-btn').attributes('type')).toBe('submit')
      expect(wrapper.find('.add-btn').attributes('disabled')).toBeDefined()
    })

    it('asks for the scanner and never submits the form', async () => {
      const wrapper = await mountForm({ name: '', canScan: true })

      await wrapper.find('.add-btn').trigger('click')

      expect(wrapper.emitted('scan')).toHaveLength(1)
      expect(wrapper.emitted('submit')).toBeUndefined()
    })

    it('does not ask for the scanner when it is the add button', async () => {
      const wrapper = await mountForm({ name: 'apa', canScan: true })

      await wrapper.find('.add-btn').trigger('click')

      expect(wrapper.emitted('scan')).toBeUndefined()
    })

    it('shows the spinner over both jobs while an add is in flight', async () => {
      const wrapper = await mountForm({ name: '', canScan: true, adding: true })

      expect(wrapper.find('.spinner').exists()).toBe(true)
      expect(scanIcon(wrapper).exists()).toBe(false)
    })
  })

  it('keeps focus in the input when a row is pressed, so blur cannot beat it', async () => {
    const wrapper = await mountForm({ suggestions: PRODUCTS, canAddCustom: true })

    for (const row of wrapper.findAll('.suggestion')) {
      const event = new Event('mousedown', { bubbles: true, cancelable: true })
      row.element.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }
  })

  // On a phone the form lifts to the top of the screen so the dropdown gets the
  // whole screen rather than the slot between the topbar and the keyboard.
  // Above 600px none of this happens, which every test above relies on.
  describe('on a phone', () => {
    let realMatchMedia

    const stubViewport = (isPhone) => {
      window.matchMedia = (query) => ({
        matches: isPhone && query.includes('599.98px'),
        media: query,
        addEventListener() {},
        removeEventListener() {},
      })
    }

    beforeEach(() => {
      realMatchMedia = window.matchMedia
      stubViewport(true)
    })

    afterEach(() => {
      window.matchMedia = realMatchMedia
    })

    it('lifts the form and covers the list when the input takes focus', async () => {
      const wrapper = await mountForm({ suggestions: PRODUCTS })

      expect(wrapper.find('.add-form').classes()).toContain('add-form--expanded')
      expect(wrapper.find('.add-cover').exists()).toBe(true)
      expect(wrapper.emitted('update:expanded').at(-1)).toEqual([true])
    })

    it('sizes the screen to the viewport rather than capping the list', async () => {
      const wrapper = await mountForm({ suggestions: PRODUCTS })
      await flushPromises()

      // The screen is measured; the list simply fills what is left of it, so
      // nothing caps the rows themselves any more.
      expect(wrapper.find('.add-form').attributes('style')).toMatch(/height:\s*\d+px/)
      expect(wrapper.find('.suggestions').attributes('style')).toBeUndefined()
    })

    it('offers a way out that the keyboard cannot cover', async () => {
      const wrapper = await mountForm({ suggestions: PRODUCTS })
      const back = wrapper.find('.back-btn')
      expect(back.exists()).toBe(true)

      // Same contract as the option rows: pressing it must not move focus first.
      const event = new Event('mousedown', { bubbles: true, cancelable: true })
      back.element.dispatchEvent(event)
      await flushPromises()

      expect(event.defaultPrevented).toBe(true)
      expect(wrapper.find('.add-form').classes()).not.toContain('add-form--expanded')
    })

    // Enter on a focused back button sends click, never mousedown.
    it('also closes from the keyboard', async () => {
      const wrapper = await mountForm({ suggestions: PRODUCTS })
      await wrapper.find('.back-btn').trigger('click')

      expect(wrapper.find('.add-form').classes()).not.toContain('add-form--expanded')
    })

    // A leave transition here would keep the button mounted past the moment the
    // band loses its padding, and it would then take ordinary layout above the
    // field and shove the field — just landed — back down for the length of the
    // fade. It has to be gone the instant the screen is.
    it('takes the way out with it, leaving nothing above the field', async () => {
      const wrapper = await mountForm({ suggestions: PRODUCTS })
      expect(wrapper.find('.back-btn').exists()).toBe(true)

      await wrapper.find('input').trigger('blur')
      await flushPromises()

      expect(wrapper.find('.add-form').classes()).not.toContain('add-form--expanded')
      expect(wrapper.find('.add-head__bar').exists()).toBe(false)
    })

    // The row used to open with a stepper in front of the field, asking how many
    // before anything had said of what — and it could never be corrected once the
    // item existed. Quantity belongs to the row on the list now.
    it('offers no quantity control at all', async () => {
      const wrapper = await mountForm({ suggestions: PRODUCTS })

      expect(wrapper.find('.qty-picker').exists()).toBe(false)
      expect(wrapper.findAll('.qty-btn')).toHaveLength(0)
    })

    it('stays open while the add button is pressed', async () => {
      const wrapper = await mountForm({ suggestions: PRODUCTS })

      // The press must not move focus off the input, or the blur would put the
      // whole screen away mid-flow.
      const event = new Event('mousedown', { bubbles: true, cancelable: true })
      wrapper.find('.add-btn').element.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)

      expect(wrapper.find('.add-form').classes()).toContain('add-form--expanded')
    })

    it('stays open when the add button is pressed', async () => {
      const wrapper = await mountForm({ suggestions: PRODUCTS })

      const event = new Event('mousedown', { bubbles: true, cancelable: true })
      wrapper.find('.add-btn').element.dispatchEvent(event)

      expect(event.defaultPrevented).toBe(true)
      expect(wrapper.find('.add-form').classes()).toContain('add-form--expanded')
    })

    // The list is behind the screen, so the tap has no other visible result.
    describe('confirming an add', () => {
      const added = (wrapper) =>
        wrapper.findAll('.suggestion').filter((row) => row.classes().includes('suggestion--added'))

      // The confirmation used to be a band above the results restating the
      // product. It said the same thing twice and said it away from the thing.
      it('marks the row that was tapped, with no band above the list', async () => {
        const wrapper = await mountForm({ suggestions: PRODUCTS })
        await wrapper.setProps({ lastAdded: { name: 'Banane 1kg', maker: null } })

        expect(wrapper.find('.added-row').exists()).toBe(false)
        expect(added(wrapper)).toHaveLength(1)
        expect(added(wrapper)[0].text()).toContain('Banane 1kg')
      })

      // Two makers' versions of the same product are two rows, and only the one
      // that was added is on the list.
      it('marks by product and maker, not by name alone', async () => {
        const wrapper = await mountForm({
          suggestions: [
            { name: 'Lapte 1L', maker: 'Napolact' },
            { name: 'Lapte 1L', maker: 'Zuzu' },
          ],
        })
        await wrapper.setProps({ lastAdded: { name: 'Lapte 1L', maker: 'Zuzu' } })

        expect(added(wrapper)).toHaveLength(1)
        expect(added(wrapper)[0].text()).toContain('Zuzu')
      })

      it('keeps marking every product added from one search', async () => {
        const wrapper = await mountForm({ suggestions: PRODUCTS })
        await wrapper.setProps({ lastAdded: { name: 'Banane 1kg', maker: null } })
        await wrapper.setProps({ lastAdded: { name: 'Apa Plata 2L', maker: 'Dorna' } })

        // Not just the latest: the results double as a record of what this
        // search has already contributed.
        expect(added(wrapper)).toHaveLength(2)
      })

      // The tick is decoration; the state has to reach the accessible name too.
      it('says so in the option, not only in colour', async () => {
        const wrapper = await mountForm({ suggestions: PRODUCTS })
        await wrapper.setProps({ lastAdded: { name: 'Banane 1kg', maker: null } })

        expect(added(wrapper)[0].text()).toContain('on your list')
      })

      it('announces it to a screen reader', async () => {
        const wrapper = await mountForm({ suggestions: PRODUCTS })
        const region = wrapper.find('p.added-announce')

        // The live region has to pre-exist the news for it to be announced.
        expect(region.exists()).toBe(true)
        expect(region.attributes('aria-live')).toBe('polite')

        await wrapper.setProps({ lastAdded: { name: 'Banane 1kg', maker: null } })
        expect(wrapper.find('p.added-announce').text()).toBe('Banane 1kg added to your list')
      })

      // The parent clears lastAdded only when the add did not land after all, so
      // the mark has to come off with it — otherwise a failed add leaves a
      // product ticked as on a list it never reached.
      const lit = (wrapper) =>
        wrapper
          .findAll('.suggestion')
          .filter((row) =>
            row.classes().some((c) => c === 'suggestion--lit-a' || c === 'suggestion--lit-b'),
          )

      const litClass = (wrapper) =>
        lit(wrapper)[0].classes().find((c) => c.startsWith('suggestion--lit-'))

      it('flashes the row that was tapped, and only that row', async () => {
        const wrapper = await mountForm({ suggestions: PRODUCTS })
        await wrapper.setProps({ lastAdded: { name: 'Banane 1kg', maker: null } })

        expect(lit(wrapper)).toHaveLength(1)
        expect(lit(wrapper)[0].text()).toContain('Banane 1kg')
      })

      // Adding three of something is three taps on one row, and each one has to
      // be visible. The row is already wearing the flash class by the second tap,
      // so re-applying it would change nothing in the DOM and the animation would
      // never restart — hence two rules that differ only in name.
      it('flashes again on every further tap of the same row', async () => {
        const wrapper = await mountForm({ suggestions: PRODUCTS })

        await wrapper.setProps({ lastAdded: { name: 'Banane 1kg', maker: null } })
        const first = litClass(wrapper)

        // A fresh object each time, exactly as reportAdded sends it.
        await wrapper.setProps({ lastAdded: { name: 'Banane 1kg', maker: null } })
        const second = litClass(wrapper)

        expect(second).not.toBe(first)
        expect(lit(wrapper)).toHaveLength(1)

        await wrapper.setProps({ lastAdded: { name: 'Banane 1kg', maker: null } })
        expect(litClass(wrapper)).toBe(first)
      })

      // Tapping a row again adds another of that product. The flash says a tap
      // landed; the counter says how many, thrown off the spot that was pressed.
      const tapRow = (wrapper, index) =>
        wrapper.findAll('.suggestion')[index].trigger('mousedown', {
          clientX: 120,
          clientY: 200,
        })

      it('says nothing on the first tap, where one is just one', async () => {
        const wrapper = await mountForm({ suggestions: PRODUCTS })
        await tapRow(wrapper, 0)

        expect(wrapper.findAll('.pop')).toHaveLength(0)
        expect(wrapper.emitted('select')).toHaveLength(1)
      })

      it('counts each further tap of the same row', async () => {
        const wrapper = await mountForm({ suggestions: PRODUCTS })
        await tapRow(wrapper, 0)
        await tapRow(wrapper, 0)
        expect(wrapper.findAll('.pop').map((p) => p.text())).toEqual(['x2'])

        await tapRow(wrapper, 0)
        expect(wrapper.findAll('.pop').map((p) => p.text())).toEqual(['x2', 'x3'])
      })

      // Each one lands somewhere of its own: three in the same place would read
      // as one badge being replaced, which is what the count exists to disprove.
      it('throws them in scattered directions', async () => {
        const wrapper = await mountForm({ suggestions: PRODUCTS })
        for (let i = 0; i < 6; i++) await tapRow(wrapper, 0)

        const drifts = wrapper.findAll('.pop').map((p) => p.attributes('style'))
        expect(drifts).toHaveLength(5)
        expect(new Set(drifts).size).toBeGreaterThan(1)
      })

      it('counts each product separately', async () => {
        const wrapper = await mountForm({ suggestions: PRODUCTS })
        await tapRow(wrapper, 0)
        await tapRow(wrapper, 0)
        await tapRow(wrapper, 1)

        // The second row is still on its first tap.
        expect(wrapper.findAll('.pop').map((p) => p.text())).toEqual(['x2'])
      })

      // Decorative: the count is already in the row's tick and the announcement.
      it('keeps the counters out of the reader and out of the way', async () => {
        const wrapper = await mountForm({ suggestions: PRODUCTS })
        await tapRow(wrapper, 0)
        await tapRow(wrapper, 0)

        expect(wrapper.find('.pop-layer').attributes('aria-hidden')).toBe('true')
      })

      it('takes the mark back when the add turns out to have failed', async () => {
        const wrapper = await mountForm({ suggestions: PRODUCTS })
        await wrapper.setProps({ lastAdded: { name: 'Banane 1kg', maker: null } })
        expect(added(wrapper)).toHaveLength(1)

        await wrapper.setProps({ lastAdded: null })
        expect(added(wrapper)).toHaveLength(0)
      })

      it('takes back only the one that failed', async () => {
        const wrapper = await mountForm({ suggestions: PRODUCTS })
        await wrapper.setProps({ lastAdded: { name: 'Banane 1kg', maker: null } })
        await wrapper.setProps({ lastAdded: { name: 'Apa Plata 2L', maker: 'Dorna' } })
        await wrapper.setProps({ lastAdded: null })

        expect(added(wrapper)).toHaveLength(1)
        expect(added(wrapper)[0].text()).toContain('Banane 1kg')
      })

      // The band was phone-only: on a wider screen the list is in plain sight
      // below the dropdown, so a notice about it was redundant. A mark on the
      // row is not a notice — it is the row's own state, and it is worth just as
      // much here.
      it('marks the row on a wider screen too, where the band never showed', async () => {
        stubViewport(false)
        const wrapper = await mountForm({ suggestions: PRODUCTS })
        await wrapper.setProps({ lastAdded: { name: 'Banane 1kg', maker: null } })

        expect(wrapper.find('.added-row').exists()).toBe(false)
        expect(added(wrapper)).toHaveLength(1)
      })
    })

    it('opens on what the household buys before anything is typed', async () => {
      const wrapper = await mountForm({ name: '', suggestions: [], recents: RECENTS })

      expect(wrapper.find('.suggestions-label').text()).toBe('Buy again')
      expect(wrapper.findAll('.suggestion-name').map((n) => n.text())).toEqual([
        'Paine Alba',
        'Oua M 10 buc',
      ])
    })

    it('drops the usuals the moment there is a query to answer', async () => {
      const wrapper = await mountForm({ name: 'apa', suggestions: PRODUCTS, recents: RECENTS })

      expect(wrapper.find('.suggestions-label').exists()).toBe(false)
      expect(wrapper.findAll('.suggestion-name').map((n) => n.text())).toEqual([
        'Apa Plata 2L',
        'Banane 1kg',
      ])
    })

    it('tells a household with no history what to do with the empty screen', async () => {
      const wrapper = await mountForm({ name: '', suggestions: [], recents: [] })

      expect(wrapper.find('.suggestions-hint').text()).toBe('Type a product name to search.')
      expect(wrapper.find('.suggestions-label').exists()).toBe(false)
    })

    it('never shows the usuals on a wider screen, which has no room for them', async () => {
      stubViewport(false)
      const wrapper = await mountForm({ name: '', suggestions: [], recents: RECENTS })

      expect(wrapper.find('.suggestions-wrap').exists()).toBe(false)
    })

    it('holds the gap the form leaves behind, so the list below cannot jump', async () => {
      const wrapper = await mountForm({ suggestions: PRODUCTS })
      expect(wrapper.find('.add-slot').attributes('style')).toMatch(/height:/)

      await wrapper.find('input').trigger('blur')
      expect(wrapper.find('.add-slot').attributes('style')).toBeUndefined()
    })

    it('puts the form back when the input is blurred', async () => {
      const wrapper = await mountForm({ suggestions: PRODUCTS })
      await wrapper.find('input').trigger('blur')

      expect(wrapper.find('.add-form').classes()).not.toContain('add-form--expanded')
      expect(wrapper.emitted('update:expanded').at(-1)).toEqual([false])
    })

    it('puts the form back on Escape', async () => {
      const wrapper = await mountForm({ suggestions: PRODUCTS })
      await wrapper.find('input').trigger('keydown.esc')

      expect(wrapper.find('.add-form').classes()).not.toContain('add-form--expanded')
      expect(wrapper.find('.suggestions-wrap').exists()).toBe(false)
    })

    // Same contract as the option rows: the cover must close search without
    // the tap itself moving focus first.
    it('closes when the cover is pressed, without stealing focus', async () => {
      const wrapper = await mountForm({ suggestions: PRODUCTS })

      const event = new Event('mousedown', { bubbles: true, cancelable: true })
      wrapper.find('.add-cover').element.dispatchEvent(event)
      await flushPromises()

      expect(event.defaultPrevented).toBe(true)
      expect(wrapper.find('.add-form').classes()).not.toContain('add-form--expanded')
    })

    it('leaves a wider screen entirely alone', async () => {
      stubViewport(false)
      const wrapper = await mountForm({ suggestions: PRODUCTS })

      expect(wrapper.find('.add-form').classes()).not.toContain('add-form--expanded')
      expect(wrapper.find('.add-cover').exists()).toBe(false)
      expect(wrapper.find('.suggestions').attributes('style')).toBeUndefined()
    })
  })
})
