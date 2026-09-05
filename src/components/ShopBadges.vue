<script setup lang="ts">
import type { PropType } from 'vue'
import AppIcon from './AppIcon.vue'

// Which shops carry a product, as their logos. NIGHTLY ONLY -- the caller decides
// that; this renders whatever it is given.
//
// A DEVELOPMENT AID RATHER THAN A FEATURE. While the catalog is being filled,
// where a row came from is the one thing you cannot tell by looking at it: a
// product scraped from Auchan and one somebody in the household typed in render
// identically. A shopper never sees this.
//
// A LOGO RATHER THAN THE NAME, because the shop and the maker are frequently the
// same word -- Auchan sells products branded Auchan -- and "Auchan Auchan" reads
// as a rendering bug. A mark next to text cannot be misread as more text.
//
// Extracted from AddItemForm when the same discs were wanted on the list rows.
// The two callers size them differently through their own scoped CSS, which is
// the convention every other icon here already follows.

const props = defineProps({
  shops: { type: Array as PropType<string[]>, default: () => [] },
})

// The logos live in src/assets/brands/ and go through AppIcon like every other
// icon, so they are inlined at build time -- no request per row, under 4 KB for
// the set, and they work offline.
//
// A shop with no logo file renders an empty disc rather than a broken image:
// AppIcon yields '' for a name it does not have. That is the right failure for a
// fourth retailer added to the registry before somebody draws its mark.
const NAMES: Record<string, string> = {
  auchan: 'Auchan',
  carrefour: 'Carrefour',
  lidl: 'Lidl',
}

function label(slug: string): string {
  return NAMES[slug] ?? slug
}

// Shops drawn as an initial rather than as their mark, with the brand colour
// behind it.
//
// NOT A STYLE CHOICE -- it is what a mark with fine internal detail costs at
// twenty pixels. Lidl's logo is a roundel: a ring with "Lidl" written inside it.
// Those four letters are three or four pixels tall here, and no amount of
// vector precision helps, because the shapes are smaller than the pixels
// available to draw them. It read as smudged next to Auchan's bird and
// Carrefour's C, which are single bold shapes and stay crisp.
//
// Lidl publish no L-only mark, so this is an initial rather than their logo --
// the same thing an avatar does with a name. That is also why it is drawn in
// their blue and not passed off as their design.
//
// This doubles as the fallback for a retailer whose logo nobody has drawn yet:
// an initial on a coloured disc is always legible, where a missing asset is an
// empty circle.
const MONOGRAM: Record<string, { letter: string; colour: string }> = {
  lidl: { letter: 'L', colour: '#0050AA' },
}

function monogram(slug: string): { letter: string; colour: string } | null {
  if (MONOGRAM[slug]) return MONOGRAM[slug]
  // Unknown shop, no asset: an initial beats an empty disc.
  if (!KNOWN_LOGOS.has(slug)) {
    return { letter: (slug[0] ?? '?').toUpperCase(), colour: 'var(--text-secondary)' }
  }
  return null
}

const KNOWN_LOGOS = new Set(['auchan', 'carrefour'])
</script>

<template>
  <span
    v-for="shop in props.shops"
    :key="shop"
    class="shop-badge"
    :class="{ 'shop-badge--mono': monogram(shop) }"
    :style="monogram(shop) ? { background: monogram(shop)!.colour } : undefined"
    :title="label(shop)"
  >
    <span v-if="monogram(shop)" class="shop-badge__letter" aria-hidden="true">{{
      monogram(shop)!.letter
    }}</span>
    <AppIcon v-else :name="`brands/${shop}`" />
    <!-- A logo says nothing on its own. Same visually-hidden pattern the list
         and the suggestions already use for their own announcements. -->
    <span class="shop-badge__name">{{ label(shop) }}</span>
  </span>
</template>

<style scoped>
/* A disc carrying the shop's mark, which reads as a different KIND of thing from
   the maker beside it -- the point being that the two are often the same word
   and must not look like one repeated.

   Shrink-proof: this sits on rows whose name already truncates, and a mark
   squashed into an ellipse is worse than no mark. */
.shop-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 50%;
  border: var(--border-width-thin) solid var(--border-light);
  background: var(--bg-surface);
  /* Lidl's mark is a filled square reaching the edge of its own viewBox, so
     without this it pokes out of the circle it is sitting in. */
  overflow: hidden;
}

/* Inset, so a square logo reads as a logo inside a disc rather than as a square
   fighting the border. The glyphs keep their own brand colours instead of taking
   currentColor -- the one place in this app where a mark is not tinted by the
   theme, because a recoloured Carrefour blue is not Carrefour. */
.shop-badge :deep(svg) {
  width: 0.95rem;
  height: 0.95rem;
  display: block;
}

/* An initial on the brand's own colour. The rim goes, because the disc is now
   the coloured thing rather than a container for one. */
.shop-badge--mono {
  border-color: transparent;
  color: #fff;
}

.shop-badge__letter {
  font-size: 0.78rem;
  font-weight: var(--weight-bold);
  line-height: 1;
  /* The cap sits slightly high in most faces; nudging it down centres the letter
     in the circle rather than in its own line box. */
  transform: translateY(0.02em);
}

.shop-badge__name {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
