// The sync guard: six catalogs that have to stay the same shape as each other.
//
// `npm run typecheck` already catches a missing or misspelled key, because
// every translation is annotated against a Catalog type derived from English.
// This covers the three things a type cannot see:
//
//   1. A plural entry missing a form its language will actually ask for.
//      tn() falls back to `other`, so Romanian would quietly print
//      "20 produse" instead of "20 de produse" — correct-looking and wrong.
//   2. A translator dropping a {placeholder}, so a count or a name never
//      appears in that language.
//   3. An empty string, which types fine and renders as nothing.
import { describe, it, expect } from 'vitest'
import en from '../src/locales/en'
import ro from '../src/locales/ro'
import de from '../src/locales/de'
import es from '../src/locales/es'
import fr from '../src/locales/fr'
// Not `it`: that is Vitest's own, and importing the Italian catalog under its
// locale code shadows it — every `it(...)` in this file becomes a call into a
// message catalog. Costs one alias to avoid.
import italian from '../src/locales/it'
import { LOCALES } from '../src/lib/locale'
import { pluralCategory } from '../src/lib/i18n'

const catalogs = { en, ro, de, es, fr, it: italian }

// The counts a shopping list can realistically reach. Deliberately not
// `resolvedOptions().pluralCategories`, which lists `many` for es/fr/it — a
// form those languages only use at exact millions. Requiring it would mean
// writing translations no user will ever see; tn()'s `other` fallback covers
// the case, and test/i18n.test.js pins that it does.
const PROBE_COUNTS = [...Array(201).keys(), 500, 1000]

const placeholders = (value) => new Set([...String(value).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))

const isPlural = (value) => typeof value === 'object' && value !== null

describe('every locale in LOCALES has a catalog', () => {
  it('matches the list the language picker offers', () => {
    expect(Object.keys(catalogs).sort()).toEqual([...LOCALES].sort())
  })
})

describe.each(LOCALES.filter((l) => l !== 'en'))('%s', (locale) => {
  const catalog = catalogs[locale]

  it('carries exactly the keys English carries', () => {
    expect(Object.keys(catalog).sort()).toEqual(Object.keys(en).sort())
  })

  it('agrees with English on which keys are plural', () => {
    for (const key of Object.keys(en)) {
      expect(isPlural(catalog[key])).toBe(isPlural(en[key]))
    }
  })

  it('carries every plural form this language will ask for', () => {
    const needed = new Set(PROBE_COUNTS.map((n) => pluralCategory(locale, n)))
    for (const [key, value] of Object.entries(catalog)) {
      if (!isPlural(value)) continue
      for (const category of needed) {
        expect(
          value[category],
          `${locale} "${key}" is missing the "${category}" form`,
        ).toBeTruthy()
      }
    }
  })

  it('keeps every placeholder English uses', () => {
    for (const [key, value] of Object.entries(catalog)) {
      if (isPlural(value)) {
        for (const [category, form] of Object.entries(value)) {
          // {n} is supplied by tn() for every plural form, English or not.
          expect(placeholders(form), `${locale} "${key}".${category}`).toContain('n')
        }
        continue
      }
      expect(placeholders(value), `${locale} "${key}"`).toEqual(placeholders(en[key]))
    }
  })

  it('has no empty values', () => {
    for (const [key, value] of Object.entries(catalog)) {
      const forms = isPlural(value) ? Object.values(value) : [value]
      for (const form of forms) {
        expect(String(form).trim(), `${locale} "${key}"`).not.toBe('')
      }
    }
  })
})

describe('en', () => {
  it('carries every plural form English will ask for', () => {
    const needed = new Set(PROBE_COUNTS.map((n) => pluralCategory('en', n)))
    for (const [key, value] of Object.entries(en)) {
      if (!isPlural(value)) continue
      for (const category of needed) {
        expect(value[category], `en "${key}" is missing the "${category}" form`).toBeTruthy()
      }
    }
  })

  it('has no empty values', () => {
    for (const [key, value] of Object.entries(en)) {
      const forms = isPlural(value) ? Object.values(value) : [value]
      for (const form of forms) {
        expect(String(form).trim(), `en "${key}"`).not.toBe('')
      }
    }
  })
})
