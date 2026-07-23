<script setup>
// One-time first-run tour. Three beats — add, swipe, invite — that teach the
// gestures a new (or returning-after-the-redesign) user needs. Rendered by
// HomeView over the real list; dismissing marks it seen.
import { ref, computed, watch } from 'vue'
import addIcon from '../assets/add.svg?raw'
import checkIcon from '../assets/check.svg?raw'
import xIcon from '../assets/x.svg?raw'

const props = defineProps({
  open: { type: Boolean, default: false },
  inviteCode: { type: String, default: '' },
})

const emit = defineEmits(['close'])

const step = ref(0)
const copied = ref(false)

const steps = [
  {
    key: 'add',
    emoji: '🛒',
    title: 'Add anything, together',
    body: 'Type an item and add it. Start typing and suggestions help you find the exact product fast.',
  },
  {
    key: 'swipe',
    emoji: '👆',
    title: 'Swipe to check or remove',
    body: 'Swipe a row right to check it off once it’s in the cart, or left to remove it. No tiny buttons to aim for.',
  },
  {
    key: 'invite',
    emoji: '💌',
    title: 'Bring your family in',
    body: 'Share your invite code so everyone shops from the same list. Every change shows up for all of you instantly.',
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
  <Transition name="tour-fade">
    <div v-if="open" class="tour-overlay" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div class="tour-card">
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
                  <span class="art-addbar__btn" v-html="addIcon"></span>
                </div>
                <div class="art-suggest">
                  <span class="art-suggest__row"><span>🥑</span> Avocado</span>
                  <span class="art-suggest__row"><span>🥛</span> Milk</span>
                </div>
              </div>

              <!-- Swipe: green check zone · item · red remove zone. The icons come
                   from the same assets ShoppingListItem uses, so what the tour
                   teaches is what the gesture actually shows. -->
              <div v-else-if="current.key === 'swipe'" class="art-swipe">
                <span class="art-swipe__zone art-swipe__zone--check" aria-hidden="true" v-html="checkIcon"></span>
                <div class="art-swipe__row">
                  <span class="art-swipe__emoji">🍞</span>
                  <span class="art-swipe__name">Bread</span>
                </div>
                <span class="art-swipe__zone art-swipe__zone--del" aria-hidden="true" v-html="xIcon"></span>
              </div>

              <!-- Invite -->
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

            <span class="tour-emoji" aria-hidden="true">{{ current.emoji }}</span>
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
          <button v-if="step > 0" class="tour-back" type="button" @click="back">Back</button>
          <button class="tour-next" type="button" @click="next">
            {{ isLast ? 'Start shopping' : 'Next' }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
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
  border-radius: var(--radius-4xl);
  box-shadow: var(--elevation-dialog);
  padding: var(--space-4) var(--space-6) var(--space-6);
  animation: tourRise 0.32s cubic-bezier(0.22, 1, 0.36, 1);
}

.tour-top {
  display: flex;
  justify-content: flex-end;
  margin-bottom: var(--space-2);
}

@keyframes tourRise {
  from { transform: translateY(16px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
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
  background: var(--color-primary-bg);
  border: var(--border-width-thin) solid color-mix(in srgb, var(--color-primary) 16%, transparent);
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

/* Swipe: a static diagram — green check zone on the left, the item, red remove
   zone on the right — so the two directions read at a glance without motion. */
.art-swipe { display: flex; align-items: center; justify-content: center; gap: var(--space-3); width: 100%; }
.art-swipe__zone {
  flex-shrink: 0; width: 2.4rem; height: 2.4rem; border-radius: var(--radius-lg);
  display: inline-flex; align-items: center; justify-content: center; color: var(--text-inverse);
}
/* Same icons and weight the real swipe panels use, so the lesson matches. */
.art-swipe__zone :deep(svg) {
  width: 20px; height: 20px; stroke: currentColor; stroke-width: 2.4;
}
.art-swipe__zone--check { background: var(--color-primary); }
.art-swipe__zone--del { background: var(--danger-solid); }
.art-swipe__row {
  display: flex; align-items: center; gap: var(--space-2);
  background: var(--bg-surface); border: var(--border-width-base) solid var(--border-main);
  border-radius: var(--radius-lg); padding: var(--space-2) var(--space-3);
  box-shadow: var(--elevation-soft);
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
  font-family: var(--mono, ui-monospace, monospace); letter-spacing: 0.14em;
  font-size: var(--text-md); font-weight: var(--weight-extrabold); color: var(--text-primary);
}
.art-code__copy {
  font-size: var(--text-xs); font-weight: var(--weight-bold); color: var(--text-inverse);
  background: var(--color-primary); border-radius: var(--radius-sm); padding: var(--space-1) var(--space-2);
}
.art-people { display: flex; gap: var(--space-2); font-size: var(--text-lg); }

/* ── Copy ── */
.tour-emoji { font-size: var(--text-2xl); line-height: 1; margin-bottom: var(--space-3); }
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
.tour-back {
  flex-shrink: 0; background: none; border: none; cursor: pointer;
  color: var(--text-secondary); font-size: var(--text-base); font-weight: var(--weight-bold);
  padding: 0.65rem var(--space-3); border-radius: var(--radius-md);
}
.tour-back:hover { color: var(--text-primary); background: var(--bg-hover); }
.tour-next {
  flex: 1; background: var(--color-primary); color: var(--text-inverse); border: none;
  border-radius: var(--radius-md); padding: 0.75rem var(--space-4);
  font-size: var(--text-base); font-weight: var(--weight-bold); cursor: pointer;
  box-shadow: var(--elevation-primary); transition: transform var(--transition-fast) ease;
}
.tour-next:hover { transform: translateY(-1px); }

/* ── Transitions ── */
.tour-fade-enter-active, .tour-fade-leave-active { transition: opacity var(--transition-base) ease; }
.tour-fade-enter-from, .tour-fade-leave-to { opacity: 0; }
.tour-step-enter-active, .tour-step-leave-active { transition: opacity var(--transition-fast) ease, transform var(--transition-fast) ease; }
.tour-step-enter-from { opacity: 0; transform: translateX(12px); }
.tour-step-leave-to { opacity: 0; transform: translateX(-12px); }
</style>
