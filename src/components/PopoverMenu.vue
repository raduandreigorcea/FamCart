<script setup lang="ts">
import { onBeforeUnmount, ref, watch, type PropType } from 'vue'
import { closeModal, openModal } from '../lib/modalStack'

// The menu shell: a panel that hangs off a button on a wide screen and comes up
// as a bottom sheet on a phone. Owns the teleport, the overlay, the transition,
// dismissal, and where the panel lands. Knows nothing about what is in it.
//
// Extracted from the household switcher and the list filter, which had grown the
// same twenty lines each. The switcher is gone -- the list filter is the only
// caller left -- but the split is still worth keeping: what lives here is the
// sheet/popover behaviour, not anything about filtering. The panel chrome and the row styling live here (see
// the :slotted rules below), so a menu added later looks like the two that
// already exist instead of approximating them.
//
// Teleported to <body> because both callers sit inside a container that clips
// or stacks: the topbar has overflow:hidden to ellipsize the household name, and
// the list header sits under the add form's dropdown.
const open = defineModel({ type: Boolean, default: false })

const props = defineProps({
  // The button that opens this. Measured to place the panel, so the panel
  // follows the button when the layout above it changes height.
  trigger: { type: Object as PropType<HTMLElement | null>, default: null },
  // Names the menu for assistive tech. Defaults to the visible heading, so a
  // caller only passes this when the two need to differ.
  label: { type: String, default: '' },
  // The header, same shape as a modal's: a tinted square holding an icon, the
  // title, and a line saying what the thing is. Drop `heading` and there is no
  // header at all.
  heading: { type: String, default: '' },
  // Raw SVG markup (an `import ... from '../assets/x.svg?raw'`), not a path.
  icon: { type: String, default: '' },
  hint: { type: String, default: '' },
  // Which edge of the trigger the panel lines up with on a wide screen.
  align: {
    type: String,
    default: 'left',
    validator: (value: string) => ['left', 'right'].includes(value),
  },
  // Panel width on a wide screen. The sheet is always full width.
  width: { type: String, default: '264px' },
})

const emit = defineEmits(['close'])

// Null on a phone: there the stylesheet owns the sheet's position entirely, and
// an inline top/left measured from the button would beat the media query and
// leave the sheet floating mid-screen.
// Absolute placement for the wide-screen panel; null while it is a sheet.
const anchor = ref<Record<string, string> | null>(null)

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

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

// A resize can cross the sheet/popover breakpoint or move the trigger, and
// re-measuring is cheaper than working out which happened.
function onResize() {
  measure()
}

// This menu's place in the layer stack. It joins the dialogs there so Android's
// Back press closes whatever is actually in front — on a phone this opens as a
// bottom sheet, and a sheet the hardware button ignores reads as a dead button.
// It does not lock the page's scroll, which is the one way it differs from a
// dialog and why openModal is told so.
const layer = Symbol('popover-menu')

// Bound only while open: a document listener that outlived the menu would
// swallow Escape for the modals above it.
watch(open, (isOpen) => {
  if (typeof document === 'undefined') return
  if (isOpen) {
    measure()
    openModal(layer, { close, locksScroll: false })
    document.addEventListener('keydown', onKeydown)
    window.addEventListener('resize', onResize)
  } else {
    anchor.value = null
    closeModal(layer)
    document.removeEventListener('keydown', onKeydown)
    window.removeEventListener('resize', onResize)
  }
})

onBeforeUnmount(() => {
  if (typeof document === 'undefined') return
  closeModal(layer)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="popover">
      <div v-if="open" class="popover-overlay" @click.self="close">
        <div class="popover-panel" :style="anchor">
          <header v-if="heading" class="popover-header">
            <span v-if="icon" class="popover-header__icon-bg" aria-hidden="true">
              <span class="popover-header__icon" aria-hidden="true" v-html="icon"></span>
            </span>
            <span class="popover-header__text">
              <span class="popover-header__title">{{ heading }}</span>
              <span v-if="hint" class="popover-header__hint">{{ hint }}</span>
            </span>
          </header>
          <!-- The rows live in their own box so the header can stay put while
               they scroll, the way a modal's header does.
               role="menu" sits here rather than on the panel because a menu
               exposes only its menuitems: with the header inside it, the title
               a sighted user reads would be dropped on the way to a screen
               reader. Outside it, the header is ordinary text and aria-label
               carries the same name. -->
          <div class="popover-body" role="menu" :aria-label="label || heading">
            <slot :close="close" />
          </div>
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
     how these menus have always behaved on desktop. */
  background: var(--backdrop);
}

.popover-panel {
  position: fixed;
  background: var(--bg-surface);
  border: var(--border-width-thin) solid var(--border-main);
  box-shadow: var(--elevation-modal);
  display: flex;
  flex-direction: column;
  /* The header runs edge to edge, so its corners have to be cut by the panel's
     rather than sitting square inside them. */
  overflow: hidden;
}

.popover-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-2);
  /* The scroll lives here rather than on the panel, so a long list of households
     moves under a header that stays put. */
  overflow-y: auto;
}

/* ─── Phone: a bottom sheet ──────────────────────────────────────────────────
   Both triggers sit near the top of the screen, which is the one place a thumb
   cannot reach. The menu comes up from the bottom at full width instead. */
.popover-panel {
  left: 0;
  right: 0;
  bottom: 0;
  border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
  border-bottom: none;
  max-height: 80vh;
}

.popover-body {
  padding-bottom: calc(var(--space-3) + var(--safe-bottom));
}

/* ─── Header ─────────────────────────────────────────────────────────────────
   Deliberately the same construction as a modal's header -- tinted square, icon
   at 22px, title, subtitle, a rule underneath -- because on a phone this panel
   IS a sheet the same width as those modals, and two headers that are nearly
   the same read worse than either one alone. The wide-screen sizes below are
   the only place it steps down. */
.popover-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-shrink: 0;
  padding: var(--space-4) var(--space-5);
  border-bottom: var(--border-width-thin) solid var(--bg-hover);
}

.popover-header__icon-bg {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-primary) 10%, var(--bg-surface));
  color: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.popover-header__icon {
  width: 22px;
  height: 22px;
  display: block;
}

/* The assets ship at stroke-width 1, too fine to read at this size. */
.popover-header__icon :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  stroke: currentColor;
  stroke-width: 2;
  fill: none;
}

.popover-header__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.popover-header__title {
  font-size: var(--text-lg);
  font-weight: var(--weight-extrabold);
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.popover-header__hint {
  margin-top: 0.1rem;
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-secondary);
}

/* ─── Shared row chrome ───────────────────────────────────────────────────────
   :slotted so the callers' own markup picks these up. Each still adds whatever
   it needs on top — an emoji tile, a count — but the box, the hover and the
   active fill are decided once. */
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
   anything coloured inside the row (a household's emoji) stays readable on it. */
:slotted(.menu-item--active) {
  background: var(--bg-hover);
}

:slotted(.menu-divider) {
  height: 1px;
  flex-shrink: 0;
  background: var(--border-light);
  margin: var(--space-1) var(--space-2);
}

/* Sits a little above the middle of its row, which is where a tick reads as
   belonging to the label rather than floating beside it.

   The 4px is measured, not picked. Flush with the top of the row the tick reads
   as too high; centred on the row it reads as too low, because both callers put
   something taller than the icon in the row -- a hint line under the label, a
   28px emoji tile. 4px is the midpoint of those two, and lands within a pixel of
   halfway between flush and centred in either row. */
:slotted(.menu-check) {
  flex-shrink: 0;
  align-self: flex-start;
  margin-top: 4px;
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
    border-radius: var(--radius-dialog);
    border-bottom: var(--border-width-thin) solid var(--border-main);
    max-height: min(70vh, 32rem);
  }

  .popover-body {
    padding-bottom: var(--space-2);
  }

  /* The panel is ~270px here rather than a phone's full width, so the modal
     header's proportions would eat a third of it. Everything comes down a
     step; the layout is unchanged. */
  .popover-header {
    gap: 0.6rem;
    padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
  }

  .popover-header__icon-bg {
    width: 30px;
    height: 30px;
  }

  .popover-header__icon {
    width: 17px;
    height: 17px;
  }

  .popover-header__title {
    font-size: var(--text-md);
  }

  .popover-header__hint {
    font-size: var(--text-2xs);
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
