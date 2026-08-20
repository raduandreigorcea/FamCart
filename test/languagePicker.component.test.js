// @vitest-environment happy-dom
//
// LanguagePicker's own contract: a tap only previews a language, and nothing
// is applied — no emit, no storage write, nothing on the rest of the screen —
// until Confirm is tapped too. That two-step exists so a misclick cannot
// strand someone in a language they cannot read: the wrong tile lighting up
// is reversible with one more tap, right up until Confirm.
//
// The Confirm button's own label is drawn from the CURRENT language via t(),
// never from the pending one — which is what keeps a misclick readable while
// the user is still deciding. That is asserted here directly rather than
// trusted, because it is easy to "simplify" into reading the wrong locale.
//
// Confirm is never disabled, including when nothing has been tapped. It used
// to disable on pending === current, which reads as "nothing to confirm" —
// except on the first-run step `current` is only the device's guess, not a
// choice anyone made, so anyone whose guess was already right (most people)
// found Confirm permanently unpressable with no way off the screen. That
// regression is pinned directly below.
//
// There is also no "Suggested" mark on any tile. A language is a subjective
// pick, not something this screen is positioned to recommend — the grid
// starts highlighted on `current` because that is where the boot resolver
// landed, not because it is being suggested.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import LanguagePicker from '../src/components/LanguagePicker.vue'
import { LOCALES, LOCALE_ENDONYMS } from '../src/lib/locale'
import { setLocale } from '../src/lib/i18n'

const wrappers = []
function picker(props) {
  const w = mount(LanguagePicker, { props })
  wrappers.push(w)
  return w
}

const tileFor = (w, locale) => w.findAll('.lang-tile')[LOCALES.indexOf(locale)]
const activeTile = (w) => w.find('.lang-tile--active')
const confirmBtn = (w) => w.find('.lang-confirm')

beforeEach(async () => {
  // Warm every chunk this file touches, then settle on English.
  await setLocale('ro')
  await setLocale('de')
  await setLocale('en')
})

afterEach(async () => {
  while (wrappers.length) wrappers.pop().unmount()
  await setLocale('en')
})

describe('rendering', () => {
  it('shows all six languages under their own name', () => {
    const w = picker({ current: 'en' })
    for (const locale of LOCALES) {
      expect(tileFor(w, locale).text()).toContain(LOCALE_ENDONYMS[locale])
    }
  })

  it('draws a real flag graphic, not emoji text', () => {
    // The regression this guards: Unicode regional-indicator flag emoji render
    // as literal letter pairs ("GB", "RO") on platforms without composed flag
    // glyphs, Windows among them. Each tile must carry inline SVG instead.
    const w = picker({ current: 'en' })
    for (const locale of LOCALES) {
      const flag = tileFor(w, locale).find('.lang-tile__flag')
      expect(flag.find('svg').exists()).toBe(true)
    }
  })

  it('highlights the current language on mount', () => {
    const w = picker({ current: 'de' })
    expect(activeTile(w).text()).toContain('Deutsch')
  })

  it('carries no "Suggested" mark on any tile', () => {
    const w = picker({ current: 'en' })
    expect(w.text()).not.toContain('Suggested')
  })
})

describe('tapping a tile', () => {
  it('previews the tap without emitting or applying anything', async () => {
    const w = picker({ current: 'en' })
    await tileFor(w, 'ro').trigger('click')

    expect(activeTile(w).text()).toContain('Română')
    expect(w.emitted('confirm')).toBeUndefined()
  })

  it('is reversible — tapping back to the original language is a normal, confirmable state', async () => {
    const w = picker({ current: 'en' })
    await tileFor(w, 'de').trigger('click')
    await tileFor(w, 'en').trigger('click')

    expect(activeTile(w).text()).toContain('English')
    expect(confirmBtn(w).attributes('disabled')).toBeUndefined()
  })
})

describe('Confirm', () => {
  it('is never disabled, even when nothing has been tapped', () => {
    // The regression this guards: the setup screen's `current` is only the
    // device's guess, not a confirmed choice. Disabling Confirm on
    // pending === current meant anyone whose guess was already right — most
    // people, most of the time — could never leave the language step.
    const w = picker({ current: 'en' })
    expect(confirmBtn(w).attributes('disabled')).toBeUndefined()
  })

  it('confirms the already-highlighted language with no tap at all', async () => {
    const w = picker({ current: 'en' })
    await confirmBtn(w).trigger('click')
    expect(w.emitted('confirm')).toEqual([['en']])
  })

  it('stays labelled in the CURRENT language while a different one is only previewed', async () => {
    // The property that makes a misclick safe: the one button that gets you
    // out reads in a language you can still read, for as long as you have not
    // pressed it.
    await setLocale('en')
    const w = picker({ current: 'en' })
    await tileFor(w, 'ro').trigger('click')
    expect(confirmBtn(w).text()).toBe('Confirm')
  })

  it('emits confirm with the previewed language, once, only when tapped', async () => {
    const w = picker({ current: 'en' })
    await tileFor(w, 'de').trigger('click')
    await confirmBtn(w).trigger('click')

    expect(w.emitted('confirm')).toEqual([['de']])
  })
})

describe('the open prop', () => {
  it('resets an abandoned preview when the sheet reopens', async () => {
    const w = picker({ current: 'en', open: false })
    await tileFor(w, 'de').trigger('click')
    expect(activeTile(w).text()).toContain('Deutsch')

    await w.setProps({ open: true })
    expect(activeTile(w).text()).toContain('English')
  })

  it('does nothing on its own absence — a picker with no open prop still starts at current', () => {
    const w = picker({ current: 'fr' })
    expect(activeTile(w).text()).toContain('Français')
  })
})

describe('the current prop changing externally', () => {
  it('follows an application made somewhere else', async () => {
    const w = picker({ current: 'en' })
    await w.setProps({ current: 'it' })
    expect(activeTile(w).text()).toContain('Italiano')
  })
})

// The App Settings shape: a segmented control matching Appearance and
// Notifications, applying on tap. No preview, no Confirm — the control stays
// on screen there, so a wrong tap is undone by tapping the right one, whereas
// the tiles variant is used on a screen that disappears once you choose.
describe('the compact variant', () => {
  const compact = (current) => picker({ current, variant: 'compact' })
  const optionFor = (w, locale) => w.findAll('.lang-seg__btn')[LOCALES.indexOf(locale)]

  it('renders a segmented control rather than tiles, with no Confirm', () => {
    const w = compact('en')
    expect(w.find('.lang-seg').exists()).toBe(true)
    expect(w.findAll('.lang-seg__btn')).toHaveLength(LOCALES.length)
    expect(w.find('.lang-grid').exists()).toBe(false)
    expect(w.find('.lang-confirm').exists()).toBe(false)
  })

  it('still names every language and draws every flag', () => {
    const w = compact('en')
    for (const locale of LOCALES) {
      const option = optionFor(w, locale)
      expect(option.text()).toContain(LOCALE_ENDONYMS[locale])
      expect(option.find('.lang-seg__flag svg').exists()).toBe(true)
    }
  })

  it('marks the current language selected', () => {
    const w = compact('fr')
    expect(w.find('.lang-seg__btn--active').text()).toContain('Français')
  })

  it('emits confirm immediately on tap, with no preview step', async () => {
    const w = compact('en')
    await optionFor(w, 'de').trigger('click')
    expect(w.emitted('confirm')).toEqual([['de']])
  })

  it('tracks `current` rather than any internal pending state', async () => {
    // The parent owns the applied language; this variant only reflects it.
    // Tapping does not move the highlight on its own — the parent applying
    // the change and passing it back down is what does.
    const w = compact('en')
    await optionFor(w, 'de').trigger('click')
    expect(w.find('.lang-seg__btn--active').text()).toContain('English')

    await w.setProps({ current: 'de' })
    expect(w.find('.lang-seg__btn--active').text()).toContain('Deutsch')
  })
})
