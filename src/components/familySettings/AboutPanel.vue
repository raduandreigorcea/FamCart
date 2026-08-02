<script setup lang="ts">
// Explains where the products offered in the add-item box come from, and
// carries the Open Food Facts credit. That credit is a licence term, not a
// courtesy: their data is ODbL, which obliges anyone publishing an app built on
// it to say so somewhere a user can reach.
// test/dataAttribution.component.test.js fails if it disappears.

// Replaced at build time with package.json's version, so bumping it there is
// the only step needed for this to show the new one.
const appVersion = __APP_VERSION__
</script>

<template>
  <div class="tab-panel tab-panel--overlay about-panel">
    <img src="/icons/pwa-192.png" alt="" class="about-logo" />
    <h4 class="about-name">FamCart</h4>
    <p class="about-version">v{{ appVersion }}</p>
    <p class="about-tagline">One shopping list, shared with your family.</p>

    <p class="about-credit">
      Product data from
      <a class="settings-note-link" href="https://openfoodfacts.org" target="_blank" rel="noopener noreferrer">Open Food Facts</a>,
      under
      <a class="settings-note-link" href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener noreferrer">ODbL 1.0</a>.
    </p>
  </div>
</template>

<style scoped>
/* About panel: centred, and mostly empty on purpose. */
.about-panel {
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 0;
}

/* The PWA icon, same asset the splash screen and topbar use. alt="" because
   the app name is written out immediately below it. */
.about-logo {
  width: 72px;
  height: 72px;
  border-radius: var(--radius-lg);
  object-fit: contain;
}

.about-name {
  margin: var(--space-4) 0 0;
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--ui-text-strong);
  letter-spacing: -0.01em;
}

.about-version {
  margin: 0.25rem 0 0;
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--ui-text-muted);
}

.about-tagline {
  margin: 0.6rem 0 0;
  font-size: var(--text-sm);
  color: var(--ui-text-muted);
}

/* Pinned to the bottom rather than sitting under the tagline, so the panel
   reads as a title card with a footnote instead of a wall of text. */
.about-credit {
  margin-top: auto;
  padding-top: var(--space-6);
  font-size: var(--text-xs);
  line-height: 1.6;
  color: var(--ui-text-muted);
  max-width: 30ch;
}

.settings-note-link {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.settings-note-link:hover,
.settings-note-link:focus-visible {
  color: var(--ui-text-strong);
}
</style>
