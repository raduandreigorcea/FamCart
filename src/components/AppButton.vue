<script setup>
// The one action button for the whole app. Encodes the primary/secondary/danger/
// warning treatment that had been copied — identically — into every modal, plus a
// ghost variant for toolbar-style actions. Layout (full-width, position in a row)
// stays with the parent; this owns only the button's look and states.
defineProps({
  // primary → filled green · secondary → subtle grey · danger → filled red ·
  // warning → amber · ghost → text-only
  variant: {
    type: String,
    default: 'primary',
    validator: (v) => ['primary', 'secondary', 'danger', 'warning', 'ghost'].includes(v),
  },
  size: { type: String, default: 'md', validator: (v) => ['sm', 'md'].includes(v) },
  // Fills the available width — flex:1 inside a button row, 100% otherwise.
  block: { type: Boolean, default: false },
  type: { type: String, default: 'button' },
  disabled: { type: Boolean, default: false },
})

defineEmits(['click'])
</script>

<template>
  <button
    class="app-btn"
    :class="[`app-btn--${variant}`, `app-btn--${size}`, { 'app-btn--block': block }]"
    :type="type"
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <slot />
  </button>
</template>

<style scoped>
.app-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  border-radius: var(--radius-md);
  padding: 0.65rem var(--space-4);
  font-family: inherit;
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
  cursor: pointer;
  border: var(--border-width-thin) solid transparent;
  transition: all var(--transition-base) ease;
}

.app-btn--sm {
  padding: 0.5rem var(--space-3);
  font-size: var(--text-sm);
}

.app-btn--block {
  flex: 1 1 0;
  width: 100%;
}

.app-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.app-btn--primary {
  background: var(--color-primary);
  color: var(--text-inverse);
  box-shadow: var(--elevation-primary);
}

.app-btn--primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-primary) 85%, var(--text-primary));
  transform: translateY(-1px);
}

.app-btn--secondary {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--bg-hover);
}

.app-btn--secondary:hover:not(:disabled) {
  background: var(--border-light);
}

.app-btn--danger {
  background: var(--danger-solid);
  color: var(--text-inverse);
  box-shadow: var(--elevation-danger);
}

.app-btn--danger:hover:not(:disabled) {
  background: var(--danger-solid-hover);
  transform: translateY(-1px);
}

.app-btn--warning {
  background: var(--warning-bg);
  color: var(--warning-text);
  border-color: var(--warning-border);
}

.app-btn--warning:hover:not(:disabled) {
  background: color-mix(in srgb, var(--warning-bg) 82%, var(--warning-border));
  transform: translateY(-1px);
}

.app-btn--ghost {
  background: none;
  color: var(--text-secondary);
}

.app-btn--ghost:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}
</style>
