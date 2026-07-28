import { describe, it, expect } from 'vitest'
import { getProductEmoji } from '../src/lib/productEmoji'

describe('getProductEmoji', () => {
  it('maps known products to their emoji', () => {
    expect(getProductEmoji('milk')).toBe('🥛')
    expect(getProductEmoji('apple')).toBe('🍎')
    expect(getProductEmoji('grapes')).toBe('🍇')
    expect(getProductEmoji('coconut')).toBe('🥥')
  })

  it('is case-insensitive', () => {
    expect(getProductEmoji('MILK')).toBe('🥛')
    expect(getProductEmoji('Grapes')).toBe('🍇')
  })

  it('ignores diacritics', () => {
    // normalizeText strips combining marks, so "Bánana" resolves to "banana".
    expect(getProductEmoji('Bánana')).toBe('🍌')
    expect(getProductEmoji('Apă Plată 2L')).toBe('💧')
  })

  it('matches a keyword anywhere in the name', () => {
    expect(getProductEmoji('whole milk')).toBe('🥛')
    expect(getProductEmoji('Lapte 3.5% 1L')).toBe('🥛')
  })

  it('falls back to the default bag emoji when nothing matches', () => {
    expect(getProductEmoji('asdfqwer')).toBe('🛍️')
    expect(getProductEmoji('')).toBe('🛍️')
  })
})

// Keywords match whole words only. Every case here really did fire before, and
// a short keyword hiding inside a longer word is the failure mode that returns
// the moment someone adds a three-letter keyword without thinking.
describe('whole-word matching', () => {
  it('does not let "mar" (apple) match inside a longer word', () => {
    expect(getProductEmoji('Margarina 250g', 'Rama')).toBe('🧈')
    expect(getProductEmoji('Marar Legatura')).toBe('🌿')
    expect(getProductEmoji('Marmelada')).not.toBe('🍎')
  })

  it('does not let "apa" (water) match inside "ceapa" (onion)', () => {
    expect(getProductEmoji('Ceapa Galbena 1kg')).toBe('🧅')
  })

  it('does not let "vin" (wine) match inside "vinete" (aubergine)', () => {
    expect(getProductEmoji('Vinete 1kg')).toBe('🥒')
  })

  it('still matches a whole word at either end of the name', () => {
    expect(getProductEmoji('Mere Golden 1kg')).toBe('🍎')
    expect(getProductEmoji('Suc de Mere')).toBe('🍎')
  })
})

// The maker is part of the haystack, which is a feature — and was a liability
// while matching was substring-based.
describe('the maker', () => {
  it('does not poison the match with a brand that contains a keyword', () => {
    // "Margaritar" contains "mar", "Rio Mare" contains "mar", "Bunica"
    // contains "bun" — all three used to decide the emoji.
    expect(getProductEmoji('Zahar Alb 1kg', 'Margaritar')).toBe('🍬')
    expect(getProductEmoji('Ton in Ulei 185g', 'Rio Mare')).toBe('🐟')
    expect(getProductEmoji('Ulei de Floarea Soarelui 1L', 'Bunica')).toBe('🌻')
  })

  it('gives the same emoji to the same product whatever the brand', () => {
    expect(getProductEmoji('Ton in Ulei 185g', 'Rio Mare')).toBe(
      getProductEmoji('Ton in Suc Propriu 185g', 'Calvo'),
    )
  })

  it('still uses the maker when it is the only signal', () => {
    // Hazelnut spread is chocolate, and only "Nutella" says so.
    expect(getProductEmoji('Crema de Alune 400g', 'Nutella')).toBe('🍫')
  })
})

// The longest matching keyword wins, so a rule can be made more specific without
// caring where it sits in the list.
describe('specificity', () => {
  it('prefers the longer keyword over the shorter one it contains', () => {
    expect(getProductEmoji('Apa Plata 2L', 'Dorna')).toBe('💧')
    expect(getProductEmoji('Apa de Gura 500ml', 'Listerine')).toBe('🪥')
  })

  it('separates plain sugar from vanilla sugar', () => {
    expect(getProductEmoji('Zahar Alb 1kg')).toBe('🍬')
    expect(getProductEmoji('Zahar Vanilat 8g', 'Dr. Oetker')).toBe('🧁')
  })

  it('separates the oils', () => {
    expect(getProductEmoji('Ulei de Masline Extravirgin 500ml', 'Monini')).toBe('🫒')
    expect(getProductEmoji('Ulei de Floarea Soarelui 1L')).toBe('🌻')
  })

  it('reads peanut butter as peanut rather than butter', () => {
    expect(getProductEmoji('Unt 80% 200g', 'President')).toBe('🧈')
    expect(getProductEmoji('Unt de Arahide 350g')).toBe('🥜')
  })

  it('separates a fish tin in oil from the oil itself', () => {
    expect(getProductEmoji('Ton in Ulei 185g')).toBe('🐟')
  })

  it('resolves an equal-length tie by rule order', () => {
    // "chipsuri" and "smantana" are both eight letters; the product is chips.
    expect(getProductEmoji('Chipsuri cu Smantana si Verdeturi 140g', "Lay's")).toBe('🥔')
    // "inghetata" and "ciocolata" are both nine; the product is ice cream.
    expect(getProductEmoji('Inghetata cu Ciocolata 900ml', 'Betty Ice')).toBe('🍦')
  })
})

describe('coverage of the seeded catalog', () => {
  it('resolves the categories that used to fall through to the bag', () => {
    expect(getProductEmoji('Cozonac cu Nuca 400g', 'Boromir')).toBe('🍰')
    expect(getProductEmoji('Chifle 6 buc')).toBe('🍞')
    expect(getProductEmoji('Mici Traditionali 440g', 'Cris-Tim')).toBe('🍢')
    expect(getProductEmoji('Kaizer Afumat 200g', 'Fox')).toBe('🥓')
    expect(getProductEmoji('Ketchup Dulce 500g', 'Tomi')).toBe('🍅')
    expect(getProductEmoji('Inghetata de Vanilie 1L', 'Betty Ice')).toBe('🍦')
    expect(getProductEmoji('Baterii AA 4 buc', 'Duracell')).toBe('🔋')
    expect(getProductEmoji('Becuri LED E27 3 buc', 'Philips')).toBe('💡')
    expect(getProductEmoji('Chibrituri 3 cutii')).toBe('🔥')
    expect(getProductEmoji('Absorbante 10 buc', 'Always')).toBe('🌸')
    expect(getProductEmoji('Batiste de Hartie 10 pachete', 'Zewa')).toBe('🤧')
    expect(getProductEmoji('Cornflakes 500g', 'Nestle')).toBe('🥣')
  })

  it('does not read plums as olives', () => {
    expect(getProductEmoji('Prune 1kg')).toBe('🍑')
    expect(getProductEmoji('Masline Verzi 200g')).toBe('🫒')
  })

  it('keeps fruit juice fruity but does not call iced tea a fruit', () => {
    expect(getProductEmoji('Suc de Portocale 1L', 'Cappy')).toBe('🍊')
    expect(getProductEmoji('Ice Tea Piersici 1.5L', 'Lipton')).toBe('🥤')
  })
})

// Gaps the importer's coverage report found in real Open Food Facts products,
// which the curated 256 never happened to contain.
describe('coverage of imported products', () => {
  it('knows the products the first import surfaced', () => {
    expect(getProductEmoji('Tofu Natur 200g', 'SanoVita')).toBe('🫘')
    expect(getProductEmoji('Originals: Skyr 100g', 'Schogetten')).toBe('🥛')
    // Neither says "ceai" or "tea", so the existing keywords could not reach them.
    expect(getProductEmoji('Earl Grey 100g', 'Twinings')).toBe('🍵')
    expect(getProductEmoji('Tea Lady Grey 100g', 'Twinings')).toBe('🍵')
  })

  it('does not let the new keywords steal unrelated products', () => {
    expect(getProductEmoji('Ceafa de Porc 1kg')).toBe('🥩')
    expect(getProductEmoji('Grey Goose 700ml')).toBe('🛍️')
  })
})

// Gaps the first Open Food Facts import surfaced: 202 of 3,329 imported
// products fell through to the shopping bag, and these were the words that
// covered the most shelf.
describe('keywords added from the import coverage report', () => {
  it('recognises the words the imported catalog brought in', () => {
    expect(getProductEmoji('Oreo Original 154g')).toBe('🍪')
    expect(getProductEmoji('Crackers cu Susan 100g')).toBe('🍪')
    expect(getProductEmoji('Spaghete No. 5 500g')).toBe('🍝')
    expect(getProductEmoji('Hummus Clasic 200g')).toBe('🫘')
    expect(getProductEmoji('Cuscus Integral 500g')).toBe('🍚')
    expect(getProductEmoji('Pateu de Ficat 200g')).toBe('🥫')
    expect(getProductEmoji('Vin Alb Feteasca Regala 750ml')).toBe('🍷')
    expect(getProductEmoji('Cafea Lungo 10 buc')).toBe('☕')
    expect(getProductEmoji('Actimel Natural 100ml')).toBe('🥛')
    expect(getProductEmoji('Vitamin D3 5000 Iu')).toBe('💊')
  })

  // Longest-keyword-wins means a broad new word can outrank a precise old one.
  // The report suggested 'protein', which is longer than 'iaurt' and would have
  // turned every protein yogurt into a pill. It was left out for that reason.
  it('does not let the new keywords outrank a more precise one', () => {
    expect(getProductEmoji('Iaurt Proteic 400g')).toBe('🥛')
    expect(getProductEmoji('Branza Philadelphia 175g')).toBe('🧀')
    expect(getProductEmoji('Suc de Portocale 1L')).toBe('🍊')
  })
})

describe('memoization', () => {
  it('returns a stable answer for a repeated product', () => {
    const first = getProductEmoji('Apa Plata 2L', 'Dorna')
    const second = getProductEmoji('Apa Plata 2L', 'Dorna')
    expect(second).toBe(first)
  })

  it('does not confuse two products that differ only by maker', () => {
    expect(getProductEmoji('Crema de Alune 400g', 'Nutella')).toBe('🍫')
    expect(getProductEmoji('Crema de Maini 100ml', 'Nivea')).toBe('🧴')
  })
})
