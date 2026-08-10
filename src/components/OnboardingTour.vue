<script setup lang="ts">
// One-time first-run tour. Three beats — add, swipe, invite — that teach the
// gestures a new (or returning-after-the-redesign) user needs. Rendered by
// HomeView over the real list; dismissing marks it seen.
import { ref, computed, watch } from 'vue'
import AppModal from './AppModal.vue'
import BackButton from './BackButton.vue'
import addIcon from '../assets/add.svg?raw'
import checkIcon from '../assets/check.svg?raw'
import xIcon from '../assets/x.svg?raw'
import cartIcon from '../assets/shopping-cart.svg?raw'

const props = defineProps({
  open: { type: Boolean, default: false },
  inviteCode: { type: String, default: '' },
})

const emit = defineEmits(['close'])

const step = ref(0)
const copied = ref(false)

// Written against what the app actually does. Tapping a suggestion adds it
// outright (HomeView.selectSuggestion calls addItem directly), and checking a
// row does not buy it: buy_items only runs once the bar is slid, which is the
// beat this tour used to leave out entirely.
//
// No emoji field any more. Each step already opens with an illustration of the
// thing it teaches, and a 🛒 sitting above a picture of the add form was the one
// element saying nothing the picture had not already said.
const steps = [
  {
    key: 'add',
    title: 'Add what you need',
    body: 'Start typing and the matching products come up. Tap one and it goes straight onto the list.',
  },
  {
    key: 'swipe',
    title: 'Swipe to check or remove',
    body: 'Swipe a row right once it is in your cart, or left to take it off the list. No small buttons to aim at.',
  },
  {
    key: 'checkout',
    title: 'Slide to check out',
    body: 'Checked rows wait in the cart until you slide the bar at the bottom. That is what clears them and saves the trip to your history.',
  },
  {
    key: 'invite',
    title: 'Bring your household in',
    body: 'Share your invite code so everyone shops from the same list. Every change shows up for all of you the moment it happens.',
  },
]

const current = computed(() => steps[step.value])
const isLast = computed(() => step.value === steps.length - 1)

// Restart at the first beat each time it opens.
watch(() => props.open, (open) => {
  if (open) {
    step.value = 0
    copied.value = false
  }
})

function next() {
  if (isLast.value) return finish()
  step.value += 1
}
function back() {
  if (step.value > 0) step.value -= 1
}
function finish() {
  emit('close')
}

async function copyCode() {
  if (!props.inviteCode) return
  try {
    await navigator.clipboard.writeText(props.inviteCode)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1800)
  } catch {
    // Clipboard blocked — the code is on screen to type by hand.
  }
}
</script>

<template>
  <!-- No backdrop dismissal, as before: a first-run tour is finished or skipped
       on purpose, not clicked away by accident. Escape is new, and does what
       Skip does — every other dialog answers to it, and a tour is the last
       thing that should feel like a trap. -->
  <AppModal
    :open="open"
    overlay-class="tour-overlay"
    transition="tour-fade"
    :close-on-backdrop="false"
    @close="finish"
  >
      <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title">
        <div class="tour-top">
          <button class="tour-skip" type="button" @click="finish">Skip tour</button>
        </div>

        <Transition :name="'tour-step'" mode="out-in">
          <div class="tour-step" :key="current.key">
            <!-- Illustrations: each beat gets a small purpose-built visual -->
            <div class="tour-art" aria-hidden="true">
              <!-- Add -->
              <div v-if="current.key === 'add'" class="art-add">
                <div class="art-addbar">
                  <span class="art-addbar__text">Avocados</span>
                  <span class="art-addbar__btn" aria-hidden="true" v-html="addIcon"></span>
                </div>
                <div class="art-suggest">
                  <span class="art-suggest__row"><span>🥑</span> Avocado</span>
                  <span class="art-suggest__row"><span>🥛</span> Milk</span>
                </div>
              </div>

              <!-- Swipe: the row makes the journey rather than sitting between two
                   labelled boxes. It travels right to uncover the check, returns,
                   then travels left to uncover the remove — the same directions and
                   the same two icons ShoppingListItem reveals. A still picture is
                   the weakest way to teach a gesture. -->
              <div v-else-if="current.key === 'swipe'" class="art-swipe">
                <span class="art-swipe__zone art-swipe__zone--check" aria-hidden="true" v-html="checkIcon"></span>
                <span class="art-swipe__zone art-swipe__zone--del" aria-hidden="true" v-html="xIcon"></span>
                <div class="art-swipe__row">
                  <span class="art-swipe__emoji">🍞</span>
                  <span class="art-swipe__name">Bread</span>
                </div>
              </div>

              <!-- Check out: the buy bar, with the thumb making the journey the
                   user has to make. This step is new. Checking a row does not buy
                   it, and nothing in the tour used to say so. -->
              <div v-else-if="current.key === 'checkout'" class="art-checkout">
                <div class="art-bar">
                  <span class="art-bar__fill"></span>
                  <span class="art-bar__label">Slide to check out</span>
                  <!-- A white copy of the same words, clipped to the swept region,
                       so the letters turn white as the thumb covers them. This is
                       how the real bar does it, and without it the label just sat
                       there while the trail passed under it. -->
                  <span class="art-bar__label art-bar__label--inverse">Slide to check out</span>
                  <span class="art-bar__thumb" aria-hidden="true" v-html="cartIcon"></span>
                </div>
              </div>

              <!-- Invite: no gesture to teach here, so nothing moves. -->
              <div v-else class="art-invite">
                <button
                  class="art-code"
                  type="button"
                  :aria-label="inviteCode ? `Copy invite code ${inviteCode}` : 'Invite code'"
                  @click="copyCode"
                >
                  <span class="art-code__value">{{ inviteCode || '••••••••' }}</span>
                  <span class="art-code__copy">{{ copied ? 'Copied!' : 'Copy' }}</span>
                </button>
                <div class="art-people">
                  <span>🧑</span><span>👩</span><span>🧒</span>
                </div>
              </div>
            </div>

            <h3 id="tour-title" class="tour-title">{{ current.title }}</h3>
            <p class="tour-body">{{ current.body }}</p>
          </div>
        </Transition>

        <div class="tour-dots" aria-hidden="true">
          <span
            v-for="(s, i) in steps"
            :key="s.key"
            class="tour-dot"
            :class="{ 'tour-dot--active': i === step }"
          ></span>
        </div>

        <div class="tour-actions">
          <BackButton v-if="step > 0" @click="back" />
          <button class="tour-next" type="button" @click="next">
            {{ isLast ? 'Start shopping' : 'Next' }}
          </button>
        </div>
      </div>
  </AppModal>
</template>

<style scoped>
.tour-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: var(--overlay-dark-strong);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: calc(var(--space-4) + var(--safe-top)) var(--space-4) calc(var(--space-5) + var(--safe-bottom));
}

@media (min-width: 640px) {
  .tour-overlay { align-items: center; }
}

.tour-card {
  position: relative;
  width: 100%;
  max-width: 420px;
  background: var(--bg-surface);
  border: var(--border-width-thin) solid var(--border-main);
  border-radius: var(--radius-dialog);
  box-shadow: var(--elevation-dialog);
  padding: var(--space-4) var(--space-6) var(--space-6);
  animation: modal-rise-in var(--transition-slow) var(--ease-rise);
}

.tour-top {
  display: flex;
  justify-content: flex-end;
  margin-bottom: var(--space-2);
}

.tour-skip {
  background: var(--bg-hover);
  border: var(--border-width-thin) solid var(--border-main);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  letter-spacing: 0.01em;
  cursor: pointer;
  padding: 0.4rem 0.8rem;
  border-radius: var(--radius-pill);
  transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
}

.tour-skip:hover {
  color: var(--text-primary);
  background: var(--bg-surface-alt);
  border-color: var(--border-dark);
}

.tour-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

/* ── Illustration frame ── */
.tour-art {
  width: 100%;
  height: 132px;
  border-radius: var(--radius-2xl);
  /* The app's own list background, not a tinted panel. A white row sitting on
     this is the same white-on-grey the real list is, so the miniature reads as
     the thing being taught rather than as a diagram of it. */
  background: var(--bg-main);
  border: var(--border-width-thin) solid var(--border-main);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  margin-bottom: var(--space-5);
  overflow: hidden;
}

/* Add */
.art-add { width: 100%; max-width: 240px; display: flex; flex-direction: column; gap: var(--space-2); }
.art-addbar {
  display: flex; align-items: center; justify-content: space-between;
  background: var(--bg-surface); border: var(--border-width-base) solid var(--color-primary);
  border-radius: var(--radius-xl); padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
  font-size: var(--text-sm); color: var(--text-primary); font-weight: var(--weight-semibold);
}
/* The real add button's icon, not a "＋" glyph: the fullwidth character has
   uneven side bearings, so it never sat centred in the tile. */
.art-addbar__btn {
  width: 1.7rem; height: 1.7rem; border-radius: var(--radius-md);
  background: var(--color-primary); color: var(--text-inverse);
  display: inline-flex; align-items: center; justify-content: center;
}
.art-addbar__btn :deep(svg) {
  width: 0.85rem; height: 0.85rem; display: block; stroke: currentColor;
}
.art-suggest {
  background: var(--bg-surface); border: var(--border-width-thin) solid var(--border-main);
  border-radius: var(--radius-lg); padding: var(--space-1);
  display: flex; flex-direction: column;
}
.art-suggest__row {
  display: flex; align-items: center; gap: var(--space-2);
  padding: var(--space-1) var(--space-2); font-size: var(--text-xs); color: var(--text-secondary);
}

/* Swipe: the row travels, uncovering a zone at each end. The zones sit behind
   it and never move, exactly as they do in ShoppingListItem. */
.art-swipe { position: relative; width: 100%; max-width: 216px; height: 3rem; }
.art-swipe__zone {
  position: absolute; top: 0; width: 3rem; height: 100%; border-radius: var(--radius-lg);
  display: inline-flex; align-items: center; justify-content: center; color: var(--text-inverse);
}
/* Same icons and weight the real swipe panels use, so the lesson matches. */
.art-swipe__zone :deep(svg) {
  width: 20px; height: 20px; stroke: currentColor; stroke-width: 2.4;
}
/* Right uncovers the check on the left, left uncovers remove on the right —
   the mapping ShoppingListItem uses (offset > 0 shows check). */
.art-swipe__zone--check { left: 0; background: var(--color-primary); }
.art-swipe__zone--del { right: 0; background: var(--danger-solid); }
.art-swipe__row {
  position: absolute; inset: 0;
  display: flex; align-items: center; gap: var(--space-2);
  padding: 0 var(--space-3);
  background: var(--bg-surface); border: var(--border-width-base) solid var(--border-main);
  border-radius: var(--radius-lg);
  box-shadow: var(--elevation-soft);
  animation: tour-swipe 4.4s var(--ease-rise) infinite;
}

/* Holds at each end long enough to be read, not just glimpsed. */
@keyframes tour-swipe {
  0%, 10% { transform: translateX(0); }
  22%, 34% { transform: translateX(3.4rem); }
  46%, 56% { transform: translateX(0); }
  68%, 80% { transform: translateX(-3.4rem); }
  92%, 100% { transform: translateX(0); }
}

/* Check out: the slide-to-confirm bar, performing its own slide.

   Every value here is the real control's, scaled down. Getting these wrong is
   what made an earlier version read as a different widget: the trail was full
   --color-primary rather than the lighter mix, and the label never inverted
   because there was only one copy of it.

   Fixed pixels rather than rem or percentages, because three things have to
   stay locked together — the thumb's travel, the trail's width, and the clip on
   the white label — and they can only agree if they are measured from the same
   numbers.

   box-sizing is border-box globally, so the 232x44 track encloses its own
   1.5px border and everything positioned inside it lives in a 229x41 padding
   box. The thumb has to be 41, not 44: at 44 it was three pixels taller and
   three wider than the space it sits in, and overflow:hidden trimmed it top,
   bottom and right. The real control states the same rule outright —
   THUMB_SIZE is "bar height minus its borders", 54 - 2x1.5 = 51.

     inner   229 x 41
     thumb   41
     travel  229 - 41 = 188
     fill    41 at rest, 229 at the end (thumb size + travel)
     clip    thumb midline, 20.5 + travel, as an inset from the right edge */
.art-checkout { width: 232px; }
.art-bar {
  position: relative; height: 44px; border-radius: var(--radius-pill);
  background: var(--bg-surface); border: var(--border-width-base) solid var(--border-main);
  color: var(--color-primary);
  box-shadow: var(--elevation-primary);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden; /* fill and thumb stay inside the pill */
}
/* Lighter than the thumb on purpose, exactly as .buy-bar__fill is: the trail is
   the ground already covered, the thumb is the thing you are holding. */
.art-bar__fill {
  position: absolute; left: 0; top: 0; bottom: 0; width: 41px;
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--color-primary) 80%, var(--bg-surface));
  animation: tour-fill 3.8s var(--ease-rise) infinite;
}
.art-bar__label {
  position: relative; z-index: 1;
  padding: 0 2.9rem; /* keeps the words clear of the thumb's resting spot */
  font-size: var(--text-xs); font-weight: var(--weight-extrabold);
  letter-spacing: -0.01em; white-space: nowrap;
}
.art-bar__label--inverse {
  position: absolute; inset: 0; z-index: 1;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-inverse);
  clip-path: inset(0 208.5px 0 0);
  animation: tour-reveal 3.8s var(--ease-rise) infinite;
}
.art-bar__thumb {
  position: absolute; left: 0; top: 0; z-index: 2;
  width: 41px; height: 41px;
  border-radius: 50%; background: var(--color-primary); color: var(--text-inverse);
  display: inline-flex; align-items: center; justify-content: center;
  animation: tour-thumb 3.8s var(--ease-rise) infinite;
}
.art-bar__thumb :deep(svg) {
  width: 16px; height: 16px; stroke: currentColor; stroke-width: 2.2;
}

/* All three share the timeline. The clip is taken at the thumb's midline
   (22px + travel), not at the trail's leading edge: clipping at the edge flips
   letters white a few pixels ahead of the knob, which is visible around its
   rounded nose. The real bar makes the same adjustment for the same reason. */
@keyframes tour-thumb {
  0%, 14% { transform: translateX(0); }
  60%, 78% { transform: translateX(188px); }
  94%, 100% { transform: translateX(0); }
}
@keyframes tour-fill {
  0%, 14% { width: 41px; }
  60%, 78% { width: 229px; }
  94%, 100% { width: 41px; }
}
@keyframes tour-reveal {
  0%, 14% { clip-path: inset(0 208.5px 0 0); }
  60%, 78% { clip-path: inset(0 20.5px 0 0); }
  94%, 100% { clip-path: inset(0 208.5px 0 0); }
}

/* Everything above teaches by moving. Asked for stillness, each art parks at a
   frame that still reads: the row half open on its check, the bar mid journey. */
@media (prefers-reduced-motion: reduce) {
  .art-swipe__row,
  .art-bar__fill,
  .art-bar__thumb,
  .art-bar__label--inverse {
    animation: none;
  }
  .art-swipe__row { transform: translateX(3.4rem); }
  /* Parked mid journey, with all three still agreeing: thumb at 94px, trail to
     its trailing edge, label inverted up to the thumb's midline. */
  .art-bar__thumb { transform: translateX(94px); }
  .art-bar__fill { width: 135px; }
  .art-bar__label--inverse { clip-path: inset(0 114.5px 0 0); }
}
.art-swipe__emoji {
  width: 1.6rem; height: 1.6rem; display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm); background: color-mix(in srgb, var(--color-primary) 10%, var(--bg-surface));
  font-size: var(--text-base);
}
.art-swipe__name { font-size: var(--text-sm); font-weight: var(--weight-semibold); color: var(--text-primary); }

/* Invite */
.art-invite { display: flex; flex-direction: column; align-items: center; gap: var(--space-3); }
.art-code {
  display: flex; align-items: center; gap: var(--space-3);
  background: var(--bg-surface); border: var(--border-width-base) dashed color-mix(in srgb, var(--color-primary) 40%, transparent);
  border-radius: var(--radius-lg); padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
  cursor: pointer;
}
.art-code__value {
  font-family: var(--font-mono); letter-spacing: 0.14em;
  font-size: var(--text-md); font-weight: var(--weight-extrabold); color: var(--text-primary);
}
.art-code__copy {
  font-size: var(--text-xs); font-weight: var(--weight-bold); color: var(--text-inverse);
  background: var(--color-primary); border-radius: var(--radius-sm); padding: var(--space-1) var(--space-2);
}
.art-people { display: flex; gap: var(--space-2); font-size: var(--text-lg); }

/* ── Copy ── */
.tour-title {
  margin: 0 0 var(--space-2); font-size: var(--text-xl); font-weight: var(--weight-extrabold);
  color: var(--text-primary); letter-spacing: -0.01em; text-wrap: balance;
}
.tour-body {
  margin: 0; font-size: var(--text-base); line-height: 1.55; color: var(--text-secondary);
  max-width: 34ch;
}

/* ── Dots ── */
.tour-dots { display: flex; justify-content: center; gap: var(--space-2); margin: var(--space-5) 0; }
.tour-dot {
  width: 7px; height: 7px; border-radius: 50%; background: var(--border-dark);
  transition: width var(--transition-base) ease, background var(--transition-base) ease;
}
.tour-dot--active { width: 22px; border-radius: var(--radius-pill); background: var(--color-primary); }

/* ── Actions ── */
.tour-actions { display: flex; align-items: center; gap: var(--space-3); }
/* Shared BackButton. It carries a top margin for standalone use at the top of a
   view; this row centres its items, so drop it and keep it from being squeezed. */
.tour-actions :deep(.back-btn) { flex-shrink: 0; margin-top: 0; }
.tour-next {
  flex: 1; background: var(--color-primary); color: var(--text-inverse); border: none;
  border-radius: var(--radius-md); padding: 0.75rem var(--space-4);
  font-size: var(--text-base); font-weight: var(--weight-bold); cursor: pointer;
  box-shadow: var(--elevation-primary); transition: background var(--transition-fast) ease;
}
/* Colour shift only — a lift here nudged the card's whole action row on hover. */
.tour-next:hover { background: color-mix(in srgb, var(--color-primary) 85%, var(--text-primary)); }

/* ── Transitions ── */
.tour-fade-enter-active, .tour-fade-leave-active { transition: opacity var(--transition-base) ease; }
.tour-fade-enter-from, .tour-fade-leave-to { opacity: 0; }
.tour-step-enter-active, .tour-step-leave-active { transition: opacity var(--transition-fast) ease, transform var(--transition-fast) ease; }
.tour-step-enter-from { opacity: 0; transform: translateX(12px); }
.tour-step-leave-to { opacity: 0; transform: translateX(-12px); }
</style>
