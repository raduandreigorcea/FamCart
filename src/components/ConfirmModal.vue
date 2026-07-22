<script setup>
import { computed } from 'vue'
import AppButton from './AppButton.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  message: { type: String, default: '' },
  danger: { type: Boolean, default: false },
  tone: {
    type: String,
    default: '',
    validator: (value) => ['danger', 'warning', 'success', ''].includes(value),
  },
  confirmText: { type: String, default: 'Confirm' },
  cancelText: { type: String, default: 'Cancel' },
  showCancel: { type: Boolean, default: true },
})

const resolvedTone = computed(() => {
  if (props.tone) return props.tone
  return props.danger ? 'danger' : 'warning'
})

const confirmVariant = computed(() => {
  if (resolvedTone.value === 'danger') return 'danger'
  if (resolvedTone.value === 'warning') return 'warning'
  return 'primary'
})

const emit = defineEmits(['confirm', 'cancel'])
</script>

<template>
  <Transition name="confirm-fade">
    <div v-if="open" class="confirm-overlay" @click.self="emit('cancel')">
      <div class="confirm-dialog" :class="`confirm-dialog--${resolvedTone}`" role="alertdialog" aria-modal="true" aria-labelledby="confirm-modal-title">
        <div class="confirm-dialog__icon-wrap" :class="`confirm-dialog__icon-wrap--${resolvedTone}`">
          <svg v-if="resolvedTone === 'danger'" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="confirm-dialog__icon">
            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <svg v-else-if="resolvedTone === 'success'" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="confirm-dialog__icon">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
            <path d="M8 12.5l2.5 2.5L16 9.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="confirm-dialog__icon">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
            <path d="M12 8v4m0 4h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>

        <div class="confirm-dialog__body">
          <h4 id="confirm-modal-title" class="confirm-dialog__title">{{ title }}</h4>
          <p class="confirm-dialog__message">{{ message }}</p>
        </div>

        <div class="confirm-dialog__actions" :class="{ 'confirm-dialog__actions--single': !showCancel }">
          <AppButton v-if="showCancel" variant="secondary" block @click="emit('cancel')">{{ cancelText }}</AppButton>
          <AppButton :variant="confirmVariant" :block="showCancel" @click="emit('confirm')">{{ confirmText }}</AppButton>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.confirm-overlay {
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

.confirm-dialog {
  width: 100%;
  max-width: 400px;
  background: var(--bg-surface);
  border-radius: var(--radius-dialog);
  border: var(--border-width-thin) solid var(--border-main);
  box-shadow: var(--elevation-dialog);
  padding: var(--space-7) var(--space-7) var(--space-6);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  text-align: center;
  animation: confirmScaleIn 0.26s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

.confirm-dialog--danger {
  border-color: color-mix(in srgb, var(--danger-main) 40%, var(--border-main));
}

.confirm-dialog--warning {
  border-color: color-mix(in srgb, var(--warning-border) 60%, var(--border-main));
}

.confirm-dialog--success {
  border-color: color-mix(in srgb, var(--color-primary) 42%, var(--border-main));
}

.confirm-dialog__icon-wrap {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-primary) 10%, var(--bg-surface));
  color: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.confirm-dialog__icon-wrap--danger {
  background: var(--danger-bg);
  color: var(--danger-text);
}

.confirm-dialog__icon-wrap--warning {
  background: var(--warning-bg);
  color: var(--warning-text);
}

.confirm-dialog__icon-wrap--success {
  background: color-mix(in srgb, var(--color-primary) 14%, var(--bg-surface));
  color: var(--color-primary);
}

.confirm-dialog__icon {
  width: 26px;
  height: 26px;
}

.confirm-dialog__body {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.confirm-dialog__title {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--weight-extrabold);
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.confirm-dialog__message {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: 1.5;
}

.confirm-dialog__actions {
  display: flex;
  gap: 0.65rem;
  width: 100%;
  margin-top: 0.25rem;
}

.confirm-dialog__actions--single .app-btn {
  flex: 0 0 auto;
  min-width: 120px;
  margin: 0 auto;
}

/* Transitions */
.confirm-fade-enter-active,
.confirm-fade-leave-active {
  transition: opacity var(--transition-base) ease;
}

.confirm-fade-enter-from,
.confirm-fade-leave-to {
  opacity: 0;
}

@keyframes confirmScaleIn {
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
