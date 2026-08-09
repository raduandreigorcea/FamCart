<script setup lang="ts">
// Scanning a product onto the list.
//
// Presentational in the same way AddItemForm is: it runs the camera and reports
// the codes it reads, but what a code MEANS is the parent's answer.
//
// A code the catalog knows is not this screen's business at all — the parent
// writes the product's name into the add form and closes this. So the scanner
// never adds anything itself, and the only outcome it draws is the one that
// still needs a decision: a code nothing matched.
//
// It is a dialog rather than a second full-screen mode of the add form, because
// everything a dialog already owns here is something a camera screen needs:
// Escape, Android's Back press (via modalStack), the scroll lock, and focus
// coming back to the button that opened it. The band at the top is the search
// screen's band, in the same place, so Back is where the hand already expects it.
import { computed, ref, watch } from 'vue'
import AppButton from './AppButton.vue'
import AppModal from './AppModal.vue'
import BackButton from './BackButton.vue'
import { useBarcodeScanner } from '../lib/barcodeScanner'
import scanBarcodeIcon from '../assets/scan-barcode.svg?raw'

const props = defineProps({
  open: { type: Boolean, default: false },
  // A lookup is in flight for the code just read.
  busy: { type: Boolean, default: false },
  // A code the catalog had no product for. Shown until something else replaces
  // it; the camera keeps reading through it, because scanning the next thing is
  // the more likely answer to "we don't have this one" than naming it.
  //
  // Note this is the only result the screen ever draws. A code the catalog DOES
  // know closes the scanner and fills the add form, so there is nothing to
  // confirm here — the name sitting in the field is the confirmation, and it is
  // one the user can still edit.
  unknownCode: { type: String, default: '' },
})

const emit = defineEmits(['detected', 'name-unknown', 'close'])

// How long the frame stays lit after a read. Long enough to see, short enough to
// be over before the lookup usually is.
const FLASH_MS = 320
// A short tap, not a buzz. The screen is already saying what happened; this only
// has to confirm that the camera saw something, at the moment it did — which is
// before the lookup can possibly know whether it was a product.
const HAPTIC_MS = 18

const flashing = ref(false)
let flashTimer: ReturnType<typeof setTimeout> | null = null

const { status, videoRef, paused, start, stop } = useBarcodeScanner({
  onDetect(code) {
    flashing.value = true
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => {
      flashing.value = false
      flashTimer = null
    }, FLASH_MS)
    navigator.vibrate?.(HAPTIC_MS)
    emit('detected', code)
  },
})

// Reading stops only while a code is being resolved, so one barcode cannot start
// a second lookup on top of its own. A code that turned out to be unknown leaves
// the camera live: scanning the next thing is a likelier answer to "we don't
// have this one" than stopping to name it.
watch(() => props.busy, (busy) => { paused.value = busy }, { immediate: true })

// immediate, because this component is mounted only once it is already open —
// HomeView renders it under a v-if that flips in the same tick as `open`, so
// `open` never CHANGES here and a plain watcher would never run. The camera was
// therefore never asked for: no permission prompt, and a screen stuck on
// "starting the camera" with nothing in flight to time out. AppModal's own
// header describes the same trap from the other side, which is why its
// transition needs `appear`.
//
// flush: 'post' so the first run lands after the DOM exists — start() wants the
// <video> element to attach the stream to.
watch(
  () => props.open,
  (open) => {
    if (open) void start()
    else stop()
  },
  { immediate: true, flush: 'post' },
)

// Every state that is not "point it at something" — each one replaces the
// viewfinder, because a frame around a camera that is not running is a lie.
const failure = computed(() => {
  switch (status.value) {
    case 'denied':
      return {
        title: 'FamCart has no camera access',
        detail: 'Allow the camera for this app, then try again.',
        retry: true,
      }
    case 'unavailable':
      return {
        title: "This device can't scan",
        detail: 'Add the item by name instead.',
        retry: false,
      }
    case 'error':
      return {
        title: "The camera didn't start",
        detail: 'Another app may be using it.',
        retry: true,
      }
    case 'timeout':
      // Nothing refused and nothing failed — the request went unanswered. The
      // one thing the user can act on is whether they were ever asked, so that
      // is what this says rather than guessing at a cause.
      return {
        title: 'The camera never answered',
        detail: "If nothing asked for camera access, check FamCart's camera permission in your device settings.",
        retry: true,
      }
    default:
      return null
  }
})

const live = computed(() => status.value === 'scanning')

function retry() {
  stop()
  void start()
}
</script>

<template>
  <AppModal
    :open="open"
    overlay-class="scanner-overlay"
    transition="scanner-fade"
    @close="emit('close')"
  >
    <div class="scanner" role="dialog" aria-modal="true" aria-labelledby="scanner-title">
      <!-- The search screen's band, in the search screen's place. -->
      <div class="scanner__bar">
        <BackButton @click="emit('close')" />
      </div>

      <div class="scanner__stage">
        <!-- The aiming window is landscape because a barcode is: a square
             reticle would be telling the user to frame something that never has
             that shape. Brackets rather than a full frame — they mark the
             corners to fill without drawing a box over the thing being read.

             Two directives, for two different reasons. v-show hides it until the
             camera is live, because start() attaches the stream to the <video>
             inside it — the element has to exist before there is a picture, so it
             cannot be v-if'd on `live`. v-if handles the failure case, where no
             stream is coming and the element is genuinely not wanted. -->
        <div
          v-if="!failure"
          v-show="live"
          class="viewfinder"
          :class="{ 'viewfinder--hit': flashing }"
        >
          <!-- Assigned rather than bound by name: the ref belongs to the scanner
               composable, not to this component, so `ref="videoRef"` would work
               at runtime while reading to the type checker as a value nothing
               ever uses. muted and playsinline are both load-bearing — without
               them a mobile WebView refuses to autoplay the preview at all. -->
          <video
            :ref="(el) => (videoRef = el as HTMLVideoElement | null)"
            class="viewfinder__feed"
            playsinline
            muted
            autoplay
          ></video>

          <span class="viewfinder__corner viewfinder__corner--tl" aria-hidden="true"></span>
          <span class="viewfinder__corner viewfinder__corner--tr" aria-hidden="true"></span>
          <span class="viewfinder__corner viewfinder__corner--bl" aria-hidden="true"></span>
          <span class="viewfinder__corner viewfinder__corner--br" aria-hidden="true"></span>
        </div>

        <!-- Nothing but a spinner until there is a picture. An empty black frame
             with corner brackets over it is a viewfinder for a camera that is not
             running: it invites aiming at something that cannot be read yet. -->
        <div v-if="!failure && !live" class="scanner__starting">
          <span class="scanner-spinner scanner-spinner--dark" aria-hidden="true"></span>
        </div>

        <div v-if="failure" class="scanner__failure">
          <span class="scanner__failure-icon" aria-hidden="true" v-html="scanBarcodeIcon"></span>
          <h4 id="scanner-title" class="scanner__title">{{ failure.title }}</h4>
          <p class="scanner__detail">{{ failure.detail }}</p>
          <AppButton v-if="failure.retry" variant="primary" type="button" @click="retry">
            Try again
          </AppButton>
        </div>

        <p v-if="!failure" id="scanner-title" class="scanner__instruction">
          {{ live ? 'Point the camera at a barcode' : 'Starting the camera' }}
        </p>
      </div>

      <!-- What came of the last read. Reserves nothing when empty, so the
           viewfinder is not sitting above a permanent gap. -->
      <div class="scanner__result" role="status" aria-live="polite">
        <Transition name="result">
          <div v-if="unknownCode" key="unknown" class="result-row result-row--unknown">
            <span class="result-row__mark result-row__mark--quiet" aria-hidden="true">
              <span class="result-row__code-glyph" v-html="scanBarcodeIcon"></span>
            </span>
            <span class="result-row__text">
              <span class="result-row__name">Not in the catalog</span>
              <span class="result-row__note result-row__note--quiet">{{ unknownCode }}</span>
            </span>
            <AppButton
              variant="secondary"
              type="button"
              @click="emit('name-unknown', unknownCode)"
            >
              Add your own
            </AppButton>
          </div>

          <div v-else-if="busy" key="busy" class="result-row">
            <span class="result-row__mark result-row__mark--quiet" aria-hidden="true">
              <span class="scanner-spinner scanner-spinner--dark"></span>
            </span>
            <span class="result-row__text">
              <span class="result-row__name">Looking it up</span>
            </span>
          </div>
        </Transition>
      </div>
    </div>
  </AppModal>
</template>

<style scoped>
.scanner-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-dark-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
}

.scanner {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--bg-surface);
  padding: calc(var(--safe-top) + var(--space-2)) var(--space-4)
    calc(var(--safe-bottom) + var(--space-4));
}

/* On anything wider than a phone it stops being a screen and becomes a dialog,
   the way every other surface in the app does. */
@media (min-width: 600px) {
  .scanner-overlay {
    padding: var(--space-4);
  }

  .scanner {
    width: 100%;
    max-width: 420px;
    height: auto;
    border-radius: var(--radius-dialog);
    border: var(--border-width-thin) solid var(--border-main);
    box-shadow: var(--elevation-dialog);
    padding: var(--space-3) var(--space-5) var(--space-5);
    animation: modal-rise-in var(--transition-slow) var(--ease-rise) forwards;
  }

  /* In a dialog the frame is one element among several and takes the width it
     is given. On a phone it is the screen's whole subject, so it runs the full
     gutter-to-gutter width instead — a bigger window is a bigger target, and a
     340px rectangle adrift in a 430px screen reads as a component rather than a
     camera. */
  .viewfinder,
  .scanner__starting {
    max-width: 340px;
  }
}

.scanner__bar {
  display: flex;
  justify-content: flex-start;
  flex-shrink: 0;
  margin-left: -0.4rem;
}

.scanner__stage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
}

/* ─── The viewfinder ─────────────────────────────────────────────────────────
   Landscape, because that is the shape of the thing it is looking for. 8:5 is
   wide enough to say so without leaving a letterbox on a tall phone. */
.viewfinder {
  position: relative;
  width: 100%;
  aspect-ratio: 8 / 5;
  border-radius: var(--radius-2xl);
  overflow: hidden;
  background: #0b0f14;
  transition: box-shadow var(--transition-base) var(--ease-standard);
}

/* The one moment of colour on the screen: a code was read. The brackets take the
   primary and the whole window is briefly ringed in it — feedback at the instant
   the camera saw something, which is well before the lookup can say what it was. */
.viewfinder--hit {
  box-shadow: 0 0 0 3px var(--color-primary);
}

.viewfinder__feed {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* Holds exactly the frame's box while there is no frame, so the instruction under
   it does not jump when the picture arrives. Same width rules as .viewfinder,
   including the desktop cap below. */
.scanner__starting {
  width: 100%;
  aspect-ratio: 8 / 5;
  display: flex;
  align-items: center;
  justify-content: center;
}

.viewfinder__corner {
  position: absolute;
  width: 26px;
  height: 26px;
  border: 2.5px solid rgba(255, 255, 255, 0.85);
  transition: border-color var(--transition-fast) var(--ease-standard);
}

.viewfinder--hit .viewfinder__corner {
  border-color: var(--color-primary);
}

/* Each bracket keeps only the two edges that meet at its corner. */
.viewfinder__corner--tl {
  top: 12px;
  left: 12px;
  border-right: none;
  border-bottom: none;
  border-top-left-radius: var(--radius-md);
}

.viewfinder__corner--tr {
  top: 12px;
  right: 12px;
  border-left: none;
  border-bottom: none;
  border-top-right-radius: var(--radius-md);
}

.viewfinder__corner--bl {
  bottom: 12px;
  left: 12px;
  border-right: none;
  border-top: none;
  border-bottom-left-radius: var(--radius-md);
}

.viewfinder__corner--br {
  bottom: 12px;
  right: 12px;
  border-left: none;
  border-top: none;
  border-bottom-right-radius: var(--radius-md);
}

.scanner__instruction {
  margin: 0;
  text-align: center;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

/* ─── When there is no camera to frame ───────────────────────────────────────*/
.scanner__failure {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--space-2);
  padding: var(--space-6) var(--space-4);
}

.scanner__failure-icon {
  width: 34px;
  height: 34px;
  color: var(--text-disabled);
  margin-bottom: var(--space-1);
}

.scanner__failure-icon :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  stroke: currentColor;
  stroke-width: 1.8;
  fill: none;
}

.scanner__title {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--weight-extrabold);
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.scanner__detail {
  margin: 0 0 var(--space-2);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: var(--leading-normal);
}

/* ─── The result of the last read ────────────────────────────────────────────*/
.scanner__result {
  flex-shrink: 0;
  margin-top: var(--space-4);
}

.result-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-height: 56px;
  padding: 0.6rem 0.75rem;
  border-radius: var(--radius-xl);
  background: var(--bg-surface-alt);
}

.result-row__mark {
  flex-shrink: 0;
  width: 2.15rem;
  height: 2.15rem;
  border-radius: 0.6rem;
  background: var(--color-primary);
  color: var(--text-inverse);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/* An unresolved read has not earned the filled tile: same box, no claim. */
.result-row__mark--quiet {
  background: color-mix(in srgb, var(--color-primary) 10%, var(--bg-surface));
  border: var(--border-width-thin) solid
    color-mix(in srgb, var(--color-primary) 22%, var(--bg-surface));
  color: var(--text-secondary);
}

.result-row__mark :deep(svg) {
  width: 1.15rem;
  height: 1.15rem;
  display: block;
  stroke: currentColor;
  stroke-width: 2.5;
  fill: none;
}

.result-row__code-glyph {
  width: 1.15rem;
  height: 1.15rem;
  display: block;
}

.result-row__code-glyph :deep(svg) {
  stroke-width: 2;
}

.result-row__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.result-row__name {
  font-size: var(--text-md);
  color: var(--text-primary);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The code itself is evidence, not a status: it takes the muted colour and
   tabular figures so it reads as the number that was scanned. */
.result-row__note--quiet {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

.scanner-spinner {
  width: 18px;
  height: 18px;
  border: var(--border-width-thick) solid rgba(255, 255, 255, 0.25);
  border-top-color: var(--text-inverse);
  border-radius: 50%;
  animation: scanner-spin 0.7s linear infinite;
  display: block;
}

.scanner-spinner--dark {
  width: 16px;
  height: 16px;
  border-color: color-mix(in srgb, var(--color-primary) 25%, transparent);
  border-top-color: var(--color-primary);
}

@keyframes scanner-spin {
  to {
    transform: rotate(360deg);
  }
}

.result-enter-active {
  transition: opacity var(--transition-fast) var(--ease-standard),
    transform var(--transition-base) var(--ease-rise);
}

.result-leave-active {
  transition: opacity var(--transition-base) var(--ease-fall);
}

.result-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.result-leave-to {
  opacity: 0;
}

.scanner-fade-enter-active,
.scanner-fade-leave-active {
  transition: opacity var(--transition-base) ease;
}

.scanner-fade-enter-from,
.scanner-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .result-enter-active,
  .result-leave-active,
  .viewfinder,
  .viewfinder__corner {
    transition: none;
  }

  .result-enter-from {
    transform: none;
  }

  .scanner-spinner {
    animation-duration: 1.6s;
  }

  @media (min-width: 600px) {
    .scanner {
      animation: none;
    }
  }
}
</style>
