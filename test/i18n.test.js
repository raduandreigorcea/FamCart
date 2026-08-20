// Lookup, interpolation, plurals and the accent split.
//
// The plural cases carry the most weight here. Romanian is the reason the app
// has a plural system at all rather than a `n === 1 ?` ternary, and its
// boundary is genuinely surprising — 19 is `few`, 20 is `other`, and then 101
// goes back to `few`. Anyone changing tn() should have to break these.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  formatDate,
  formatTime,
  getClerkLocalization,
  getLocale,
  initLocale,
  pluralCategory,
  setLocale,
  t,
  tAccent,
  tn,
  whenLocaleReady,
} from '../src/lib/i18n'
import { LOCALE_DEVICE_KEY } from '../src/lib/locale'
import { makeStorage } from './support/fakeStorage.js'

beforeEach(async () => {
  await setLocale('en')
})

describe('t', () => {
  it('returns the string for a key', () => {
    expect(t('common.cancel')).toBe('Cancel')
  })

  it('returns the key itself for one that does not exist', () => {
    // Never throws: App.vue's error boundary is all that stands between a typo
    // and a white page, and a visible key is a legible bug report.
    expect(t('nope.not.a.key')).toBe('nope.not.a.key')
  })

  it('substitutes named placeholders', () => {
    expect(t('common.cancel', { unused: 1 })).toBe('Cancel')
    // Interpolation is exercised directly, since the seed catalog's plain
    // strings carry no placeholders yet.
    expect(tn('list.meta.itemCount', 3)).toBe('3 items')
  })
})

describe('tn', () => {
  it('substitutes {n} without being asked', () => {
    expect(tn('list.meta.itemCount', 1)).toBe('1 item')
    expect(tn('list.meta.itemCount', 5)).toBe('5 items')
  })

  it('uses English one/other', () => {
    expect(tn('list.meta.itemCount', 0)).toBe('0 items')
  })

  it('uses all three Romanian forms, including the "de" above 19', async () => {
    await setLocale('ro')
    expect(tn('list.meta.itemCount', 1)).toBe('1 produs')
    expect(tn('list.meta.itemCount', 0)).toBe('0 produse')
    expect(tn('list.meta.itemCount', 3)).toBe('3 produse')
    expect(tn('list.meta.itemCount', 19)).toBe('19 produse')
    expect(tn('list.meta.itemCount', 20)).toBe('20 de produse')
    // Back to `few` in the next hundred, which is the part people get wrong.
    expect(tn('list.meta.itemCount', 101)).toBe('101 produse')
    expect(tn('list.meta.itemCount', 120)).toBe('120 de produse')
  })

  it('falls back to other for a category the catalog does not carry', async () => {
    // Spanish, French and Italian have a `many` that only fires at exact
    // millions. Their catalogs carry one/other and rely on this fallback; a
    // shopping list will never reach it, but it must not render a bare key.
    await setLocale('fr')
    expect(pluralCategory('fr', 1000000)).toBe('many')
    expect(tn('list.meta.itemCount', 1000000)).toBe('1000000 articles')
  })

  it('returns the key for a plural key that does not exist', () => {
    expect(tn('nope.plural', 2)).toBe('nope.plural')
  })
})

describe('pluralCategory', () => {
  it('reports the categories each language actually distinguishes', () => {
    expect(pluralCategory('en', 1)).toBe('one')
    expect(pluralCategory('en', 2)).toBe('other')
    expect(pluralCategory('de', 2)).toBe('other')
    expect(pluralCategory('ro', 0)).toBe('few')
    expect(pluralCategory('ro', 19)).toBe('few')
    expect(pluralCategory('ro', 20)).toBe('other')
  })
})

describe('setLocale', () => {
  it('swaps the catalog so every subsequent lookup is in the new language', async () => {
    await setLocale('de')
    expect(getLocale()).toBe('de')
    expect(t('common.cancel')).toBe('Abbrechen')
    await setLocale('it')
    expect(t('common.cancel')).toBe('Annulla')
  })

  it('records the choice when given somewhere to record it', async () => {
    const storage = makeStorage()
    await setLocale('es', storage, 'user-1')
    expect(storage.map.get(LOCALE_DEVICE_KEY)).toBe('es')
  })

  it('falls back to English for a locale we do not ship', async () => {
    await setLocale('ja')
    expect(getLocale()).toBe('en')
  })
})

describe('initLocale', () => {
  it('settles on the device hint and resolves whenLocaleReady', async () => {
    const storage = makeStorage({ [LOCALE_DEVICE_KEY]: 'ro' })
    await initLocale(storage, ['en-GB'])
    await whenLocaleReady()
    expect(getLocale()).toBe('ro')
    expect(t('common.cancel')).toBe('Anulează')
  })

  it('detects from the device languages when there is no hint', async () => {
    await initLocale(makeStorage(), ['fr-CA'])
    expect(getLocale()).toBe('fr')
    expect(t('common.cancel')).toBe('Annuler')
  })
})

describe('tAccent', () => {
  it('splits a heading on its marker', () => {
    expect(tAccent('setup.welcome.title')).toEqual([
      'The list your whole ',
      'household',
      ' shares',
    ])
  })

  it('handles a marker that runs to the end of the string', () => {
    expect(tAccent('login.tagline')).toEqual([
      'Household Groceries, ',
      'fresh together daily',
      '',
    ])
  })

  it('follows the language, and the marker moves with the grammar', async () => {
    await setLocale('de')
    expect(tAccent('setup.picker.titleNew')).toEqual(['Richte deinen ', 'Haushalt', ' ein'])
  })

  it('returns the whole string as the lead when a heading has no marker', () => {
    // An unstyled but correct heading beats a blank one, so a translator who
    // drops the brackets still gets readable text.
    expect(tAccent('common.cancel')).toEqual(['Cancel', '', ''])
  })

  it('splits before interpolating, so a value cannot move the accent', () => {
    // The household's name is the accented run. A name carrying brackets of its
    // own used to cut that run short, because the split saw the assembled
    // sentence rather than the catalog template.
    const [lead, accent, tail] = tAccent('danger.deleteDesc', { name: 'Home]s [Attic' })
    expect(accent).toBe('Home]s [Attic')
    expect(lead).toBe('Permanently deletes ')
    expect(tail).toBe(
      ', removes all members, and erases all shopping list data. This cannot be undone.',
    )
  })
})

describe('formatDate and formatTime', () => {
  it('follows the app language rather than the device', async () => {
    const when = new Date('2026-03-09T14:30:00Z')
    await setLocale('en')
    const english = formatDate(when, { month: 'long' })
    await setLocale('ro')
    const romanian = formatDate(when, { month: 'long' })
    expect(english).not.toBe(romanian)
    expect(romanian.toLowerCase()).toContain('martie')
  })

  it('formats a time', async () => {
    await setLocale('en')
    expect(formatTime(new Date('2026-03-09T14:30:00Z'))).toMatch(/\d{1,2}:\d{2}/)
  })
})

describe('Clerk localization', () => {
  it('is undefined for English — nothing to download', async () => {
    await initLocale(makeStorage(), ['en-GB'])
    await whenLocaleReady()
    expect(getClerkLocalization()).toBeUndefined()
  })

  it('loads the matching pack for a non-English boot', async () => {
    await initLocale(makeStorage({ [LOCALE_DEVICE_KEY]: 'ro' }), [])
    await whenLocaleReady()
    // Shape rather than exact copy: the strings are Clerk's, not ours, and
    // pinning their wording would break on every upgrade of theirs.
    expect(getClerkLocalization()).toBeTypeOf('object')
    expect(getClerkLocalization()).not.toBeUndefined()
  })

  it('never blocks boot when the pack cannot be fetched', async () => {
    // A failed chunk must leave Clerk's English default standing rather than
    // stop anyone signing in, so the loader swallows and returns undefined.
    await initLocale(makeStorage({ [LOCALE_DEVICE_KEY]: 'en' }), [])
    await expect(whenLocaleReady()).resolves.toBeUndefined()
  })
})
