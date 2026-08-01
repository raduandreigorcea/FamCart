<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { closeModal, isTopModal, openModal } from '../lib/modalStack'

// The dialog shell: overlay, dismissal, scroll lock, and focus. Knows nothing
// about what is in it.
//
// Same idea as PopoverMenu, which already owns those concerns for menus. Six
// dialogs had grown their own overlay independently and drifted apart: only
// AccountActionModal closed on Escape, none of them locked the page behind
// them, and only CustomProductModal put focus anywhere. Behaviour every dialog
// should share is the kind that belongs in one place.
//
// Two things it deliberately does NOT do:
//
//   • Teleport, unlike PopoverMenu. The menus are teleported because their
//     callers sit inside containers that clip or stack; the dialogs render at
//     view root already, so teleporting would only move their DOM out of the
//     component tree their tests and scoped CSS reach.
//
//   • Own the ARIA. role, aria-modal and aria-labelledby stay on the caller's
//     own dialog element. Wrapping that in a second labelled element would
//     announce the dialog twice, and the obvious way to avoid a visual wrapper
//     — display:contents — is known to drop elements out of the accessibility
//     tree in several browsers, which is the opposite of the point.
//
// The overlay class and transition name come from the caller so each dialog
// keeps the look it already had: parent scoped styles apply to a child
// component's root element, and the overlay below is this component's root.

const props = defineProps({
  open: { type: Boolean, default: false },
  // Applied to the overlay, so the caller's own scoped styling still lands.
  overlayClass: { type: String, default: '' },
  transition: { type: String, default: 'app-modal-fade' },
  // A confirm dialog wants a click outside to mean cancel; a destructive one
  // may not want to be dismissed by accident.
  closeOnBackdrop: { type: Boolean, default: true },
  // Off for a dialog that places focus itself — a form wanting its first field
  // focused and selected, say. Both would otherwise fire on the same tick and
  // the winner would come down to watcher order. Escape, the Tab trap and
  // restoring focus on close stay in force either way.
  autofocus: { type: Boolean, default: true },
})

const emit = defineEmits(['close'])

const overlay = ref(null)

// Which dialogs are open, and the page's scroll lock, live in lib/modalStack —
// they are properties of the screen rather than of any one dialog, and state
// declared here would be per-instance rather than shared (see the note there).

// ── Focus ────────────────────────────────────────────────────────────────────
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

let previouslyFocused = null

function focusables() {
  if (!overlay.value) return []
  return [...overlay.value.querySelectorAll(FOCUSABLE)]
}

// Tab must not walk out of an open dialog into the page behind it, which the
// overlay makes unreachable to a mouse but not to a keyboard.
function trapTab(event) {
  const items = focusables()
  if (!items.length) return
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement
  const inside = overlay.value?.contains(active)
  if (event.shiftKey && (active === first || !inside)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (active === last || !inside)) {
    event.preventDefault()
    first.focus()
  }
}

// Identity for this instance's place in the stack.
const token = Symbol('app-modal')

function onKeydown(event) {
  if (!isTopModal(token)) return
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
    return
  }
  if (event.key === 'Tab') trapTab(event)
}

// Guards both directions. The watcher below runs immediately, so it fires for a
// dialog that starts closed, and onBeforeUnmount can follow a close that already
// happened — without this, either would unbalance the stack.
let active = false

function activate() {
  if (typeof document === 'undefined' || active) return
  active = true
  previouslyFocused = document.activeElement
  openModal(token)
  document.addEventListener('keydown', onKeydown)
  // The overlay does not exist until after this tick.
  if (props.autofocus) {
    void nextTick(() => {
      focusables()[0]?.focus()
    })
  }
}

function deactivate() {
  if (typeof document === 'undefined' || !active) return
  active = false
  closeModal(token)
  document.removeEventListener('keydown', onKeydown)
  // Hand focus back to whatever opened this, so keyboard position is not lost.
  if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
    previouslyFocused.focus()
  }
  previouslyFocused = null
}

watch(
  () => props.open,
  (isOpen) => (isOpen ? activate() : deactivate()),
  { immediate: true },
)

// Unmounting while open (a v-if on the caller, a route change) has to release
// the lock and the listener too, or the page stays frozen with nothing on it.
onBeforeUnmount(deactivate)
</script>

<template>
  <Transition :name="transition">
    <div
      v-if="open"
      ref="overlay"
      class="app-modal-overlay"
      :class="overlayClass"
      @click.self="closeOnBackdrop && emit('close')"
    >
      <slot />
    </div>
  </Transition>
</template>

<style scoped>
/* Covering the screen is the only thing every dialog agrees on, so it is the
   only thing declared here.
   Layout and stacking deliberately are NOT: the callers disagree (z-index runs
   999 to 1200, and the tour sits at the bottom of the screen rather than the
   middle), and their class lands on this same element at the same specificity.
   Anything set here would be settled by stylesheet order rather than intent. */
.app-modal-overlay {
  position: fixed;
  inset: 0;
}

.app-modal-fade-enter-active,
.app-modal-fade-leave-active {
  transition: opacity var(--transition-base) ease;
}

.app-modal-fade-enter-from,
.app-modal-fade-leave-to {
  opacity: 0;
}
</style>
