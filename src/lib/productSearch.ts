// Product-catalog suggestion helpers.
//
// normalizeSearchText must mirror scripts/seed-products.mjs, which computes
// product_catalog.search_text the same way — both sides lowercase, strip
// diacritics, and collapse whitespace, so "apă" typed with or without accents
// matches the stored "apa plata 2l dorna".

export interface ProductSuggestion {
  name: string
  maker: string | null
}

export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// ilike treats %, _ and \ as pattern syntax; escape them so the user's literal
// input can never widen (or break) the match.
export function escapeIlikePattern(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}
