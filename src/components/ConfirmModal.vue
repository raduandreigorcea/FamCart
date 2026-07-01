<script setup>
defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  message: { type: String, default: '' },
  danger: { type: Boolean, default: false },
})

const emit = defineEmits(['confirm', 'cancel'])
</script>

<template>
  <Transition name="confirm-fade">
    <div v-if="open" class="confirm-overlay" @click.self="emit('cancel')">
      <div class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-modal-title">
        <div class="confirm-dialog__icon-wrap" :class="{ 'confirm-dialog__icon-wrap--danger': danger }">
          <svg v-if="danger" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="confirm-dialog__icon">
            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
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

        <div class="confirm-dialog__actions">
          <button class="confirm-btn confirm-btn--cancel" type="button" @click="emit('cancel')">Cancel</button>
          <button
            class="confirm-btn"
            :class="danger ? 'confirm-btn--danger' : 'confirm-btn--primary'"
            type="button"
            @click="emit('confirm')"
          >Confirm</button>
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
  padding: var(--space-4);
}

.confirm-dialog {
  width: 100%;
  max-width: 400px;
  background: var(--bg-surface);
  border-radius: var(--radius-dialog);
  border: 1px solid var(--border-main);
  box-shadow: var(--elevation-dialog);
  padding: var(--space-7) var(--space-7) var(--space-6);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  text-align: center;
  animation: confirmScaleIn 0.26s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
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
  font-size: 1.05rem;
  font-weight: 800;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.confirm-dialog__message {
  margin: 0;
  font-size: 0.84rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.confirm-dialog__actions {
  display: flex;
  gap: 0.65rem;
  width: 100%;
  margin-top: 0.25rem;
}

.confirm-btn {
  flex: 1;
  border-radius: var(--radius-md);
  padding: 0.65rem var(--space-4);
  font-size: 0.86rem;
  font-weight: 700;
  cursor: pointer;
  border: none;
  transition: all 0.2s ease;
}

.confirm-btn--cancel {
  background: var(--bg-hover);
  color: var(--text-primary);
  border: 1px solid var(--bg-hover);
}

.confirm-btn--cancel:hover {
  background: var(--border-light);
}

.confirm-btn--primary {
  background: var(--color-primary);
  color: var(--bg-surface);
  box-shadow: var(--elevation-primary);
}

.confirm-btn--primary:hover {
  background: color-mix(in srgb, var(--color-primary) 85%, var(--text-primary));
  transform: translateY(-1px);
}

.confirm-btn--danger {
  background: var(--danger-text);
  color: var(--bg-surface);
  box-shadow: var(--elevation-danger);
}

.confirm-btn--danger:hover {
  background: var(--danger-text);
  transform: translateY(-1px);
}

/* Transitions */
.confirm-fade-enter-active,
.confirm-fade-leave-active {
  transition: opacity 0.22s ease;
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
