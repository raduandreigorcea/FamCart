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

// Marks that are ALREADY a disc, and so should fill this one rather than sit
// inside it.
//
// Lidl's is a roundel: a circle with the wordmark in it. Inset like a glyph it
// became a faint ring with unreadable letters at this size -- there was a
// printed square border around it too, 0.2 of 24 units, which is a third of a
// pixel here and rendered as nothing but stopped the round mark from filling a
// round space. The border is gone from the asset and the mark now goes
// edge to edge, so the disc IS the logo.
//
// Auchan's bird and Carrefour's C are glyphs with no background of their own and
// keep the inset, or they would touch the rim.
const FULL_BLEED = new Set(['lidl'])
</script>

<template>
  <span
    v-for="shop in props.shops"
    :key="shop"
    class="shop-badge"
    :class="{ 'shop-badge--bleed': FULL_BLEED.has(shop) }"
    :title="label(shop)"
  >
    <AppIcon :name="`brands/${shop}`" />
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

/* A mark that is its own disc fills this one, and the border would double its
   outline, so it goes. */
.shop-badge--bleed {
  border-color: transparent;
}

.shop-badge--bleed :deep(svg) {
  width: 100%;
  height: 100%;
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
