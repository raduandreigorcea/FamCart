<script setup>
// One-time greeting shown after login for users who never decided on
// notifications. Explains the benefit up front so the browser/OS permission
// prompt that follows an accept doesn't arrive cold.
import AppButton from './AppButton.vue'
import bellIcon from '../assets/bell.svg?raw'

defineProps({
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['accept', 'decline'])
</script>

<template>
  <Transition name="notify-fade">
    <div v-if="open" class="notify-overlay" @click.self="emit('decline')">
      <div class="notify-dialog" role="alertdialog" aria-modal="true" aria-labelledby="notify-prompt-title">
        <div class="notify-dialog__icon-wrap">
          <span class="notify-dialog__icon" aria-hidden="true" v-html="bellIcon"></span>
        </div>

        <div class="notify-dialog__body">
          <h4 id="notify-prompt-title" class="notify-dialog__title">Turn on notifications?</h4>
          <p class="notify-dialog__message">
            Know the moment someone in your family adds something to the
            list or checks items off, so nothing gets forgotten at the store.
          </p>
        </div>

        <div class="notify-dialog__actions">
          <AppButton variant="secondary" block @click="emit('decline')">Not now</AppButton>
          <AppButton variant="primary" block @click="emit('accept')">Turn on</AppButton>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.notify-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-dark-strong);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
  padding: calc(var(--space-4) + var(--safe-top)) var(--space-4) calc(var(--space-4) + var(--safe-bottom));
}

.notify-dialog {
  width: 100%;
  max-width: 400px;
  background: var(--bg-surface);
  border-radius: var(--radius-dialog);
  border: var(--border-width-thin) solid color-mix(in srgb, var(--color-primary) 42%, var(--border-main));
  box-shadow: var(--elevation-dialog);
  padding: var(--space-7) var(--space-7) var(--space-6);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  text-align: center;
  animation: notifyScaleIn 0.26s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

.notify-dialog__icon-wrap {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-primary) 14%, var(--bg-surface));
  color: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.notify-dialog__icon {
  width: 26px;
  height: 26px;
  display: inline-flex;
}

/* The asset ships at stroke-width 1 for a 24px box; weight it for this size. */
.notify-dialog__icon :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  stroke: currentColor;
  stroke-width: 2;
}

.notify-dialog__body {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.notify-dialog__title {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--weight-extrabold);
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.notify-dialog__message {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: 1.5;
}

.notify-dialog__actions {
  display: flex;
  gap: 0.65rem;
  width: 100%;
  margin-top: 0.25rem;
}

.notify-fade-enter-active,
.notify-fade-leave-active {
  transition: opacity var(--transition-base) ease;
}

.notify-fade-enter-from,
.notify-fade-leave-to {
  opacity: 0;
}

@keyframes notifyScaleIn {
  from {
    transform: scale(0.9);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
