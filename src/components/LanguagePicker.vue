<script setup lang="ts">
import { ref, watch } from 'vue'
import { LOCALES, LOCALE_ENDONYMS, t, type Locale } from '../lib/i18n'
import AppButton from './AppButton.vue'
import AppIcon from './AppIcon.vue'

// The six languages, in one component because two screens offer them — and in
// two shapes, because those two screens are asking different questions.
//
//   'tiles'   — the first-run step. A big, unhurried grid, and a Confirm
//               button, because this is a decision the user is being stopped
//               to make and the screen vanishes once they make it.
//   'compact' — App Settings. A segmented control the same size and shape as
//               Appearance and Notifications directly above it, applying on
//               tap the way both of those do.
//
// Each language is listed under its OWN name. "Romanian" is no help to someone
// looking for "Română", and this is the one control in the app guaranteed to
// be read by a person who may not have the language it is currently in.
//
// Real flag artwork, not the Unicode flag emoji. The emoji rendered as literal
// two-letter codes ("GB", "RO") on Windows: composing a regional-indicator
// pair into a flag glyph is a font feature Windows does not reliably supply,
// so it fell back to the codepoints' names. Inline SVG has no such dependency
// and stays in the offline-precached bundle like every other icon in
// src/assets, which a network-fetched flag image would not. Simplified
// artwork, not an official reproduction — decorative beside the endonym that
// does the actual identifying, which is why each flag is aria-hidden.
// The file each language's flag lives under, which is not simply the locale:
// English is drawn as the Union Flag, so `en` maps to `gb`.
const FLAGS: Record<Locale, string> = {
  en: 'flags/gb',
  ro: 'flags/ro',
  de: 'flags/de',
  es: 'flags/es',
  fr: 'flags/fr',
  it: 'flags/it',
}

const props = withDefaults(
  defineProps<{
    /**
     * The applied language — or, on the first-run step, just the device's best
     * guess before anyone has chosen anything. Either way it is what shows as
     * selected; there is no separate "suggested" mark, because a language is a
     * subjective pick, not a recommendation this control is positioned to make.
     */
    current: Locale
    /**
     * 'tiles' previews a tap and waits for Confirm. 'compact' commits on tap.
     * See the note at the top for why the two screens differ.
     */
    variant?: 'tiles' | 'compact'
    /**
     * tiles only. Pass the owning dialog's open flag when this picker lives
     * inside something that stays mounted while closed, so a tap made and
     * abandoned on a previous visit is not still sitting there highlighted the
     * next time it opens.
     */
    open?: boolean
  }>(),
  { variant: 'tiles' },
)

const emit = defineEmits<{ confirm: [Locale] }>()

// tiles only. A tap previews; nothing is applied until Confirm. That two-step
// exists because on the first-run step the language step DISAPPEARS the moment
// a choice lands — a misclick there drops you into household setup reading a
// language you may not know, with no way back to this screen. Confirm's own
// label comes from t(), which reads the CURRENT applied locale rather than
// `pending`, so the one button that gets you unstuck stays legible for as long
// as you have not pressed it.
//
// Confirm is never disabled, including when pending equals current. Disabling
// on "nothing changed" looks right and is a trap: `current` here is only the
// device's guess, never a choice the user made, so anyone whose guess was
// already correct — most people — would find Confirm permanently unpressable
// with no way off the screen.
//
// 'compact' needs none of this. Settings applies on tap like the two controls
// above it, and a misclick is recoverable in one tap: the control stays on
// screen, and the flags identify each option without depending on reading.
const pending = ref<Locale>(props.current)

watch(
  () => props.current,
  (next) => {
    pending.value = next
  },
)
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) pending.value = props.current
  },
)
</script>

<template>
  <div
    v-if="variant === 'compact'"
    class="lang-seg"
    role="group"
    :aria-label="t('language.groupLabel')"
  >
    <button
      v-for="locale in LOCALES"
      :key="locale"
      class="lang-seg__btn"
      :class="{ 'lang-seg__btn--active': locale === current }"
      type="button"
      :aria-pressed="locale === current"
      @click="emit('confirm', locale)"
    >
      <AppIcon class="lang-seg__flag" :name="FLAGS[locale]" />
      <!-- lang= so a screen reader pronounces each name in its own language
           rather than reading "Français" with the voice of the current one. -->
      <span :lang="locale">{{ LOCALE_ENDONYMS[locale] }}</span>
    </button>
  </div>

  <template v-else>
    <div class="lang-grid" role="group" :aria-label="t('language.groupLabel')">
      <button
        v-for="locale in LOCALES"
        :key="locale"
        class="lang-tile"
        :class="{ 'lang-tile--active': locale === pending }"
        type="button"
        :aria-pressed="locale === pending"
        @click="pending = locale"
      >
        <span v-if="locale === pending" class="lang-tile__check" aria-hidden="true">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5"
               stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 10.5 8 14.5 16 6" />
          </svg>
        </span>
        <AppIcon class="lang-tile__flag" :name="FLAGS[locale]" />
        <span class="lang-tile__name" :lang="locale">{{ LOCALE_ENDONYMS[locale] }}</span>
      </button>
    </div>

    <AppButton class="lang-confirm" variant="primary" block @click="emit('confirm', pending)">
      {{ t('common.confirm') }}
    </AppButton>
  </template>
</template>

<style scoped>
/* ─── compact: App Settings ──────────────────────────────────────────────────
   A deliberate restatement of .segmented / .segmented__btn from
   AppSettingsModal, because a parent's scoped CSS cannot reach into a child
   component. Six options wrap to two rows of three rather than needing a
   different kind of control. Any change to the segmented look there has to be
   made here too — the whole point of this block is that the Language section
   is indistinguishable from Appearance and Notifications above it. */
.lang-seg {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.35rem;
  background: var(--bg-surface-alt);
  border: var(--border-width-thin) solid var(--border-main);
  border-radius: var(--radius-md);
  padding: 0.25rem;
}

.lang-seg__btn {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  border-radius: var(--radius-sm);
  padding: 0.42rem 0.2rem;
  cursor: pointer;
  transition: all var(--transition-fast) ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.28rem;
  min-width: 0;
}

.lang-seg__btn:hover:not(.lang-seg__btn--active) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.lang-seg__btn--active {
  background: var(--bg-surface);
  color: var(--color-primary);
  box-shadow: var(--elevation-soft);
}

/* Sized to sit on the text baseline like .control-icon does in the two
   controls above, rather than towering over it. */
.lang-seg__flag {
  width: 15px;
  height: 10px;
  flex-shrink: 0;
  display: inline-flex;
  border-radius: 1.5px;
  overflow: hidden;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--text-primary) 14%, transparent);
}

.lang-seg__flag :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}

/* ─── tiles: the first-run step ──────────────────────────────────────────── */
.lang-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
}

/* The same border/radius/hover language as .app-settings__row and the account
   dialog's rows, so a control you can pick reads as the same kind of thing
   wherever you meet one — just arranged as a card, since this screen has the
   room and nothing else competing for it. */
.lang-tile {
  position: relative;
  border: var(--border-width-thin) solid var(--border-main);
  background: var(--bg-surface);
  border-radius: var(--radius-md);
  padding: 0.85rem 0.6rem 0.7rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  text-align: center;
  font-family: inherit;
  cursor: pointer;
  transition:
    background var(--transition-base) ease,
    border-color var(--transition-base) ease;
}

.lang-tile:hover {
  background: var(--bg-hover);
  border-color: color-mix(in srgb, var(--color-primary) 45%, var(--bg-surface));
}

.lang-tile--active {
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 8%, var(--bg-surface));
}

.lang-tile__flag {
  width: 36px;
  height: 24px;
  display: inline-flex;
  border-radius: 3px;
  overflow: hidden;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--text-primary) 12%, transparent);
}

.lang-tile__flag :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}

.lang-tile__name {
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  color: var(--text-primary);
}

.lang-tile__check {
  position: absolute;
  top: 0.4rem;
  right: 0.4rem;
  display: inline-flex;
  color: var(--color-primary);
}

.lang-tile__check svg {
  width: 16px;
  height: 16px;
}

.lang-confirm {
  margin-top: 0.75rem;
}
</style>
