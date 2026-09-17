<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, type PropType } from 'vue'
import MemberAvatarStack from './MemberAvatarStack.vue'
import SkeletonBlock from './SkeletonBlock.vue'
import { t, tn } from '../lib/i18n'
import { IS_NIGHTLY } from '../lib/appChannel'
import type { HouseholdMemberProfile } from '../lib/householdRealtime'

// The phone's answer to "which household, and how much is left", at the top of
// the list. The desktop topbar says the same thing; at this width it is hidden
// and the action bar at the bottom had been the only place the household showed,
// as an emoji the size of a thumbnail.
//
// Two copies of the same content, not one bar that changes size. A sticky bar
// that shrinks changes the height of the document while you scroll it, and on a
// list only just long enough to scroll that shrink is enough to end the scroll:
// the page snaps back to the top, the bar grows, the page can scroll again, and
// the bar flickers between the two. So the full card scrolls away like any other
// content, and once it has gone a slim copy slides in over the top edge. The
// slim one is fixed, so neither of them ever moves anything else.
const props = defineProps({
  emoji: { type: String, default: '' },
  name: { type: String, default: '' },
  members: { type: Array as PropType<HouseholdMemberProfile[]>, default: () => [] },
  membersLoading: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  toBuy: { type: Number, default: 0 },
  inCart: { type: Number, default: 0 },
})

const emit = defineEmits<{ (e: 'open'): void; (e: 'prefetch'): void }>()

// Each half only when it has something in it: "0 in cart" on a fresh list and
// "0 to buy" with everything in the trolley both read as a thing gone wrong.
// An empty list still says "0 to buy", which is true and is the empty state.
const summary = computed(() => {
  const parts: string[] = []
  if (props.toBuy > 0 || props.inCart === 0) parts.push(tn('householdBar.toBuy', props.toBuy))
  if (props.inCart > 0) parts.push(tn('householdBar.inCart', props.inCart))
  return parts.join(' · ')
})

// How much of the shop is done, for the ring around the emoji. Units, like the
// counts beside it. An empty list is 0, not NaN.
const progress = computed(() => {
  const total = props.toBuy + props.inCart
  return total > 0 ? Math.round((props.inCart / total) * 100) : 0
})

// A burst of sparks the moment the last thing goes in the cart. Only on the
// way UP to full: opening the app on a finished list is not an achievement, and
// neither is a row being added and ticked again at 100%. The key replays the
// burst if the list is finished twice in quick succession.
const SPARK_COUNT = 10
const SPARK_MS = 900
const burst = ref(0)
const sparking = ref(false)
let sparkTimer: ReturnType<typeof setTimeout> | undefined

watch(progress, (now, before) => {
  if (now !== 100 || before >= 100) return
  burst.value += 1
  sparking.value = true
  clearTimeout(sparkTimer)
  sparkTimer = setTimeout(() => {
    sparking.value = false
  }, SPARK_MS)
})

const card = ref<HTMLElement | null>(null)
const compact = ref(false)
let observer: IntersectionObserver | null = null

onMounted(() => {
  // Absent in some test environments and very old WebViews. Without it the
  // slim bar simply never appears, and the full card still scrolls normally.
  if (typeof IntersectionObserver === 'undefined' || !card.value) return
  observer = new IntersectionObserver(
    ([entry]) => {
      if (entry) compact.value = !entry.isIntersecting
    },
    // The slim bar is ~56px tall under the status bar; hand over as the card
    // slides beneath it rather than after it has fully gone.
    { rootMargin: '-56px 0px 0px 0px' },
  )
  observer.observe(card.value)
})

onBeforeUnmount(() => {
  clearTimeout(sparkTimer)
  observer?.disconnect()
  observer = null
})

const buttonLabel = computed(() =>
  props.name ? t('topbar.householdSettings', { name: props.name }) : t('nav.household'),
)
</script>

<template>
  <div class="household-bar" :class="{ 'household-bar--compact': compact }">
    <div ref="card" class="household-bar__card">
      <div v-if="loading && !name" class="household-bar__button" aria-hidden="true">
        <SkeletonBlock width="44px" height="44px" radius="var(--radius-pill)" />
        <span class="household-bar__text">
          <SkeletonBlock width="7.5rem" height="0.95rem" />
        </span>
      </div>
      <button
        v-else
        type="button"
        class="household-bar__button"
        :aria-label="buttonLabel"
        @pointerdown="emit('prefetch')"
        @click="emit('open')"
      >
        <!-- The ring is decoration: the summary beside it says the same thing
             in words. -->
        <span
          class="household-bar__ring"
          :class="{ 'household-bar__ring--done': sparking }"
          aria-hidden="true"
        >
          <!-- An SVG stroke rather than a conic gradient, for the round cap on
               the end of the fill. pathLength=100 makes the dash offset read as
               a percentage. -->
          <svg class="household-bar__ring-svg" viewBox="0 0 44 44">
            <circle class="household-bar__ring-track" cx="22" cy="22" r="20" pathLength="100" />
            <circle
              class="household-bar__ring-fill"
              :class="{ 'household-bar__ring-fill--empty': progress === 0 }"
              cx="22"
              cy="22"
              r="20"
              pathLength="100"
              :stroke-dashoffset="100 - progress"
            />
          </svg>
          <span class="household-bar__emoji">{{ emoji }}</span>
          <span v-if="sparking" :key="burst" class="household-bar__sparks">
            <span
              v-for="n in SPARK_COUNT"
              :key="n"
              class="household-bar__spark"
              :style="{ '--angle': `${(360 / SPARK_COUNT) * n}deg` }"
            />
          </span>
        </span>
        <span class="household-bar__text">
          <span class="household-bar__name">{{ name }}</span>
          <span class="household-bar__summary">{{ summary }}</span>
        </span>
        <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- build channel, the same word in every language -->
        <span v-if="IS_NIGHTLY" class="channel-badge">NIGHTLY</span>
        <MemberAvatarStack
          class="household-bar__members"
          :members="members"
          :loading="membersLoading"
        />
      </button>
    </div>

    <!-- The slim copy. Hidden from assistive tech and from Tab while the card is
         on screen, because then it is a second button saying the same thing. -->
    <div class="household-bar__mini" :aria-hidden="!compact" :inert="!compact">
      <button
        type="button"
        class="household-bar__mini-button"
        :aria-label="buttonLabel"
        @pointerdown="emit('prefetch')"
        @click="emit('open')"
      >
        <span class="household-bar__mini-name">{{ name }}</span>
        <span class="household-bar__mini-summary">{{ summary }}</span>
        <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- build channel, the same word in every language -->
        <span v-if="IS_NIGHTLY" class="channel-badge">NIGHTLY</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.household-bar {
  width: 100%;
  max-width: calc(480px + 2rem);
  margin: 0 auto;
  padding: calc(var(--safe-top) + var(--space-3)) var(--space-4) 0;
}

/* The desktop topbar carries all of this at that width. */
@media (min-width: 900px) {
  .household-bar {
    display: none;
  }
}

.household-bar__button,
.household-bar__mini-button {
  width: 100%;
  display: flex;
  align-items: center;
  border: none;
  font: inherit;
  text-align: left;
  color: var(--color-on-strong);
  background: var(--color-primary-strong);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform var(--transition-fast) var(--ease-rise);
}

/* Same press as the topbar's household block: in instantly, out eased, and a
   small scale because the target is the width of the screen. */
.household-bar__button:active,
.household-bar__mini-button:active {
  transform: scale(0.98);
  transition-duration: 0s;
}

.household-bar__button:focus-visible,
.household-bar__mini-button:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-primary);
}

.household-bar__button {
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3) var(--space-2) var(--space-2);
  border-radius: var(--radius-3xl);
  box-shadow: var(--elevation-primary);
}

/* The loading placeholder borrows the button's box but not its colour: a dark
   slab arriving before the name reads as something having gone wrong. */
div.household-bar__button {
  background: var(--bg-surface);
  box-shadow: none;
  cursor: default;
}

.household-bar__ring {
  position: relative;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/* Turned a quarter so the fill starts at twelve o'clock. */
.household-bar__ring-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
  overflow: visible;
}

.household-bar__ring-track,
.household-bar__ring-fill {
  fill: none;
  stroke-width: 4;
}

.household-bar__ring-track {
  stroke: var(--color-on-strong-track);
}

/* The fill sweeps rather than jumps: from empty when the bar first appears,
   and from the old share to the new one each time a row is ticked. Slower than
   an interaction's feedback on purpose: it is a gauge settling, and the tick
   itself has already answered the tap. */
.household-bar__ring-fill {
  stroke: var(--color-on-strong);
  stroke-linecap: round;
  stroke-dasharray: 100;
  transition:
    stroke-dashoffset var(--transition-slow) var(--ease-rise),
    opacity var(--transition-fast) var(--ease-standard);
  animation: household-ring-fill 0.7s var(--ease-rise);
}

/* ── Finished ────────────────────────────────────────────────────────────────
   The ring gives one small pop and throws sparks outward from its edge. Both
   start as the fill arrives rather than with the tap, so the burst reads as the
   ring closing, not as the row being ticked. Transform and opacity only. */
.household-bar__ring--done {
  animation: household-ring-pop 0.45s var(--ease-rise) 0.2s;
}

@keyframes household-ring-pop {
  40% {
    transform: scale(1.12);
  }
}

.household-bar__sparks {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

/* Every other spark is amber, so the burst reads as sparks and not as the
   white of the ring breaking up. */
.household-bar__spark {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 6px;
  height: 6px;
  margin: -3px 0 0 -3px;
  border-radius: var(--radius-pill);
  background: var(--color-on-strong);
  opacity: 0;
  transform: rotate(var(--angle)) translateY(-22px);
  animation: household-spark 0.6s ease-out 0.22s;
}

.household-bar__spark:nth-child(even) {
  width: 5px;
  height: 5px;
  margin: -2.5px 0 0 -2.5px;
  background: var(--color-celebrate);
  animation-duration: 0.5s;
}

@keyframes household-spark {
  0% {
    opacity: 1;
    transform: rotate(var(--angle)) translateY(-22px) scale(1);
  }
  100% {
    opacity: 0;
    transform: rotate(var(--angle)) translateY(-46px) scale(0.3);
  }
}

/* A round cap on a zero-length dash still draws a dot. */
.household-bar__ring-fill--empty {
  opacity: 0;
}

@keyframes household-ring-fill {
  from {
    stroke-dashoffset: 100;
  }
}

@media (prefers-reduced-motion: reduce) {
  .household-bar__ring-fill {
    transition: none;
    animation: none;
  }

  /* Nothing flies. The ring being full says it. */
  .household-bar__ring--done {
    animation: none;
  }

  .household-bar__sparks {
    display: none;
  }
}

/* A disc in the bar's own colour, punched out of the ring's middle. */
.household-bar__emoji {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-pill);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-lg);
  line-height: 1;
  background: var(--color-primary-strong);
}

.household-bar__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.household-bar__name,
.household-bar__mini-name {
  font-size: var(--text-md);
  font-weight: var(--weight-extrabold);
  letter-spacing: -0.01em;
  line-height: var(--leading-tight);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.household-bar__summary,
.household-bar__mini-summary {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--color-on-strong-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* On the green, the stack's usual surface-coloured ring would read as holes.
   So each face gets a 2px ring in the bar's own colour, which cuts cleanly
   where one overlaps the next, and a faint white line just outside it, which
   lifts the face off the green instead of letting its edge blur into it. */
.household-bar__members {
  flex-shrink: 0;
  --member-avatar-size: 28px;
}

.household-bar__members :deep(.member-avatar) {
  border: var(--border-width-thick) solid var(--color-primary-strong);
  box-shadow: 0 0 0 1px var(--color-on-strong-track);
}

/* On the brand fill, the stamp inverts: a light chip rather than a tinted one,
   which would sink into the green. */
.channel-badge {
  flex-shrink: 0;
  padding: 0.1rem 0.4rem;
  border-radius: var(--radius-xs);
  background: var(--color-on-strong);
  color: var(--color-primary-strong);
  font-size: var(--text-2xs);
  font-weight: var(--weight-extrabold);
  letter-spacing: 0.08em;
  line-height: 1.5;
}

/* ── The slim copy ─────────────────────────────────────────────────────────── */
.household-bar__mini {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 15;
  padding: calc(var(--safe-top) + var(--space-2)) var(--space-4) var(--space-2);
  transform: translateY(-100%);
  opacity: 0;
  pointer-events: none;
  transition:
    transform var(--transition-base) var(--ease-fall),
    opacity var(--transition-fast) var(--ease-standard);
}

/* The same fade the checkout slider sits on, mirrored: the page's colour,
   dense from the status bar to a little below the pill, then gone. Rows
   scrolling up dissolve into it instead of cutting under the pill's edge. */
.household-bar__mini::before {
  content: '';
  position: absolute;
  z-index: -1;
  left: 0;
  right: 0;
  top: 0;
  bottom: -3rem;
  background: linear-gradient(
    to bottom,
    color-mix(in oklab, var(--color-primary-bg) 92%, transparent) 60%,
    color-mix(in oklab, var(--color-primary-bg) 0%, transparent)
  );
  pointer-events: none;
}

.household-bar--compact .household-bar__mini {
  transform: translateY(0);
  opacity: 1;
  pointer-events: auto;
  transition:
    transform var(--transition-base) var(--ease-rise),
    opacity var(--transition-fast) var(--ease-standard);
}

.household-bar__mini-button {
  max-width: 480px;
  margin: 0 auto;
  gap: var(--space-2);
  min-height: var(--size-control-md);
  padding: 0 var(--space-4);
  border-radius: var(--radius-pill);
  box-shadow: var(--elevation-primary);
}

/* Name on the left taking the slack, counts pushed to the right end (before
   the nightly stamp, when there is one). */
.household-bar__mini-name {
  flex: 1;
  min-width: 0;
}

.household-bar__mini-summary {
  flex-shrink: 0;
}

@media (min-width: 900px) {
  .household-bar__mini {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .household-bar__mini,
  .household-bar--compact .household-bar__mini {
    transform: none;
    transition: opacity var(--transition-fast) var(--ease-standard);
  }

  .household-bar__button:active,
  .household-bar__mini-button:active {
    transform: none;
  }
}
</style>
