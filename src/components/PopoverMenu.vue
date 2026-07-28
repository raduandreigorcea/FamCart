<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'

// The menu shell: a panel that hangs off a button on a wide screen and comes up
// as a bottom sheet on a phone. Owns the teleport, the overlay, the transition,
// dismissal, and where the panel lands. Knows nothing about what is in it.
//
// Extracted from the family switcher and the list filter, which had grown the
// same twenty lines each. The panel chrome and the row styling live here (see
// the :slotted rules below), so a menu added later looks like the two that
// already exist instead of approximating them.
//
// Teleported to <body> because both callers sit inside a container that clips
// or stacks: the topbar has overflow:hidden to ellipsize the family name, and
// the list header sits under the add form's dropdown.
const open = defineModel({ type: Boolean, default: false })

const props = defineProps({
  // The button that opens this. Measured to place the panel, so the panel
  // follows the button when the layout above it changes height.
  trigger: { type: Object, default: null },
  // Names the menu for assistive tech; both callers have a visible heading too.
  label: { type: String, default: '' },
  // Which edge of the trigger the panel lines up with on a wide screen.
  align: {
    type: String,
    default: 'left',
    validator: (value) => ['left', 'right'].includes(value),
  },
  // Panel width on a wide screen. The sheet is always full width.
  width: { type: String, default: '264px' },
})

const emit = defineEmits(['close'])

// Null on a phone: there the stylesheet owns the sheet's position entirely, and
// an inline top/left measured from the button would beat the media query and
// leave the sheet floating mid-screen.
const anchor = ref(null)

const isWide = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(min-width: 600px)').matches

function measure() {
  if (!open.value || !props.trigger || !isWide()) {
    anchor.value = null
    return
  }
  const rect = props.trigger.getBoundingClientRect()
  anchor.value = {
    top: `${Math.round(rect.bottom + 8)}px`,
    width: props.width,
    ...(props.align === 'right'
      ? { right: `${Math.round(window.innerWidth - rect.right)}px`, left: 'auto' }
      : { left: `${Math.round(rect.left)}px`, right: 'auto' }),
  }
}

function close() {
  open.value = false
  emit('close')
}

function onKeydown(e) {
  if (e.key === 'Escape') close()
}

// A resize can cross the sheet/popover breakpoint or move the trigger, and
// re-measuring is cheaper than working out which happened.
function onResize() {
  measure()
}

// Bound only while open: a document listener that outlived the menu would
// swallow Escape for the modals above it.
watch(open, (isOpen) => {
  if (typeof document === 'undefined') return
  if (isOpen) {
    measure()
    document.addEventListener('keydown', onKeydown)
    window.addEventListener('resize', onResize)
  } else {
    anchor.value = null
    document.removeEventListener('keydown', onKeydown)
    window.removeEventListener('resize', onResize)
  }
})

onBeforeUnmount(() => {
  if (typeof document === 'undefined') return
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="popover">
      <div v-if="open" class="popover-overlay" @click.self="close">
        <div class="popover-panel" :style="anchor" role="menu" :aria-label="label">
          <slot :close="close" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.popover-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  /* Dimmed for the sheet; the popover below turns this transparent, matching
     how the switcher has always behaved on desktop. */
  background: var(--backdrop);
}

.popover-panel {
  position: fixed;
  background: var(--bg-surface);
  border: var(--border-width-thin) solid var(--border-main);
  box-shadow: var(--elevation-modal);
  padding: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* ─── Phone: a bottom sheet ──────────────────────────────────────────────────
   Both triggers sit near the top of the screen, which is the one place a thumb
   cannot reach. The menu comes up from the bottom at full width instead. */
.popover-panel {
  left: 0;
  right: 0;
  bottom: 0;
  border-radius: var(--radius-3xl) var(--radius-3xl) 0 0;
  border-bottom: none;
  padding-bottom: calc(var(--space-3) + var(--safe-bottom));
  max-height: 80vh;
  overflow-y: auto;
}

/* The grab handle that says "this came up from the bottom". Sheet only. */
.popover-panel::before {
  content: '';
  flex-shrink: 0;
  width: 36px;
  height: 4px;
  margin: var(--space-1) auto var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--border-main);
}

/* ─── Shared row chrome ───────────────────────────────────────────────────────
   :slotted so the callers' own markup picks these up. Each still adds whatever
   it needs on top — an emoji tile, a count — but the box, the hover and the
   active fill are decided once. */
:slotted(.menu-heading) {
  margin: var(--space-2) var(--space-3) var(--space-1);
  font-size: var(--text-2xs);
  font-weight: var(--weight-extrabold);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-disabled);
}

:slotted(.menu-item) {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  /* 48px on touch: the whole reason the sheet exists. */
  min-height: 48px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-lg);
  font-family: inherit;
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
  cursor: pointer;
  text-align: left;
  transition: background var(--transition-fast);
}

:slotted(.menu-item:hover) {
  background: var(--bg-hover);
}

/* A quiet neutral fill, not a colour wash — the check is the only accent, so
   anything coloured inside the row (a family's emoji) stays readable on it. */
:slotted(.menu-item--active) {
  background: var(--bg-hover);
}

:slotted(.menu-divider) {
  height: 1px;
  flex-shrink: 0;
  background: var(--border-light);
  margin: var(--space-1) var(--space-2);
}

:slotted(.menu-check) {
  flex-shrink: 0;
  width: var(--size-icon-md);
  height: var(--size-icon-md);
  color: var(--color-primary);
  display: block;
}

:slotted(.menu-check svg) {
  width: 100%;
  height: 100%;
  display: block;
  stroke: currentColor;
  stroke-width: 2.5;
  fill: none;
}

/* ─── Transition ────────────────────────────────────────────────────────────── */
.popover-enter-active,
.popover-leave-active {
  transition: opacity var(--transition-fast) ease;
}

.popover-enter-active .popover-panel,
.popover-leave-active .popover-panel {
  transition: transform var(--transition-base) cubic-bezier(0.22, 1, 0.36, 1);
}

.popover-enter-from,
.popover-leave-to {
  opacity: 0;
}

.popover-enter-from .popover-panel,
.popover-leave-to .popover-panel {
  transform: translateY(100%);
}

/* ─── Pointer / wide: a popover on the trigger ───────────────────────────────
   top/left/right come from the measured trigger; the values here are the
   fallback for the frame before that measurement lands. */
@media (min-width: 600px) {
  .popover-overlay {
    background: transparent;
  }

  .popover-panel {
    left: 1.25rem;
    right: auto;
    bottom: auto;
    top: 25vh;
    border-radius: var(--radius-2xl);
    border-bottom: var(--border-width-thin) solid var(--border-main);
    padding-bottom: var(--space-2);
    max-height: min(70vh, 32rem);
  }

  .popover-panel::before {
    display: none;
  }

  :slotted(.menu-item) {
    min-height: 0;
  }

  .popover-enter-from .popover-panel,
  .popover-leave-to .popover-panel {
    transform: translateY(-6px) scale(0.98);
  }
}

@media (prefers-reduced-motion: reduce) {
  .popover-enter-active,
  .popover-leave-active,
  .popover-enter-active .popover-panel,
  .popover-leave-active .popover-panel {
    transition: none;
  }

  .popover-enter-from .popover-panel,
  .popover-leave-to .popover-panel {
    transform: none;
  }
}
</style>
