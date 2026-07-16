<script setup>
// Add a product the catalog doesn't have. The catalog is global and read-only to
// clients by design (migration 022), so this never writes to it — it only builds
// a product for the caller to add to their own list. That is also the only way
// to give a hand-typed item a maker, which otherwise arrives solely from a
// catalog pick.
import { ref, computed, watch, nextTick } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  // What was already typed into the add form, so the modal continues that
  // thought instead of making the user type it a second time.
  initialName: { type: String, default: '' },
  // Mirror the DB's length checks (migrations 010 and 023) so the form rejects
  // what the row would reject anyway.
  nameMaxLength: { type: Number, default: 120 },
  makerMaxLength: { type: Number, default: 60 },
})

const emit = defineEmits(['submit', 'cancel'])

const name = ref('')
const maker = ref('')
const nameInput = ref(null)

// Every open starts from the add form's text with a blank maker, so a previous
// visit can never leave a stale manufacturer attached to a different product.
watch(
  () => props.open,
  async (open) => {
    if (!open) return
    name.value = props.initialName
    maker.value = ''
    await nextTick()
    nameInput.value?.focus()
    nameInput.value?.select()
  },
)

const canSubmit = computed(() => name.value.trim().length > 0)

function submit() {
  const productName = name.value.trim()
  if (!productName) return
  emit('submit', { name: productName, maker: maker.value.trim() || null })
}
</script>

<template>
  <Transition name="custom-product-fade">
    <div v-if="open" class="custom-product-overlay" @click.self="emit('cancel')">
      <div
        class="custom-product-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="custom-product-title"
      >
        <div class="custom-product-dialog__icon-wrap">
          <span class="custom-product-dialog__icon" aria-hidden="true"></span>
        </div>

        <div class="custom-product-dialog__body">
          <h4 id="custom-product-title" class="custom-product-dialog__title">Add your own</h4>
          <p class="custom-product-dialog__message">
            Describe it and it goes straight on your list.
          </p>
        </div>

        <form class="custom-product-form" @submit.prevent="submit" @keydown.esc="emit('cancel')">
          <label class="custom-product-field">
            <span class="custom-product-label">Product</span>
            <input
              ref="nameInput"
              v-model="name"
              type="text"
              placeholder="Olive Oil 500ml"
              :maxlength="nameMaxLength"
              autocomplete="off"
            />
          </label>

          <label class="custom-product-field">
            <span class="custom-product-label">
              Manufacturer
              <span class="custom-product-optional">optional</span>
            </span>
            <input
              v-model="maker"
              type="text"
              placeholder="Bertolli"
              :maxlength="makerMaxLength"
              autocomplete="off"
            />
          </label>

          <div class="custom-product-dialog__actions">
            <button class="custom-product-btn custom-product-btn--cancel" type="button" @click="emit('cancel')">
              Cancel
            </button>
            <button class="custom-product-btn custom-product-btn--primary" type="submit" :disabled="!canSubmit">
              Add to list
            </button>
          </div>
        </form>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.custom-product-overlay {
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

.custom-product-dialog {
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
  animation: customProductScaleIn 0.26s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

.custom-product-dialog__icon-wrap {
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

/* Masked rather than inlined, so the icon is the asset on disk and takes the
   wrap's colour (the same pattern as .add-icon in AddItemForm). */
.custom-product-dialog__icon {
  width: 26px;
  height: 26px;
  background-color: currentColor;
  mask: url('../assets/package-search.svg') no-repeat center / contain;
  -webkit-mask: url('../assets/package-search.svg') no-repeat center / contain;
}

.custom-product-dialog__body {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.custom-product-dialog__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 800;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.custom-product-dialog__message {
  margin: 0;
  font-size: 0.84rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.custom-product-form {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  width: 100%;
}

.custom-product-field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  text-align: left;
}

.custom-product-label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-secondary);
  letter-spacing: 0.01em;
}

.custom-product-optional {
  font-weight: 600;
  color: var(--text-disabled);
  text-transform: lowercase;
  letter-spacing: 0;
}

.custom-product-field input {
  width: 100%;
  padding: 0.7rem 0.85rem;
  background: var(--bg-surface);
  border: 1.5px solid var(--border-main);
  border-radius: var(--radius-lg);
  font-family: inherit;
  font-size: 0.92rem;
  color: var(--text-primary);
  outline: none;
  transition: border-color 0.15s;
}

.custom-product-field input:focus {
  border-color: var(--color-primary);
}

.custom-product-field input::placeholder {
  color: var(--text-disabled);
}

.custom-product-dialog__actions {
  display: flex;
  gap: 0.65rem;
  width: 100%;
  margin-top: 0.25rem;
}

.custom-product-btn {
  flex: 1;
  border-radius: var(--radius-md);
  padding: 0.65rem var(--space-4);
  font-size: 0.86rem;
  font-weight: 700;
  cursor: pointer;
  border: none;
  font-family: inherit;
  transition: all 0.2s ease;
}

.custom-product-btn--cancel {
  background: var(--bg-hover);
  color: var(--text-primary);
  border: 1px solid var(--bg-hover);
}

.custom-product-btn--cancel:hover {
  background: var(--border-light);
}

.custom-product-btn--primary {
  background: var(--color-primary);
  color: var(--text-inverse);
  box-shadow: var(--elevation-primary);
}

.custom-product-btn--primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-primary) 85%, var(--text-primary));
  transform: translateY(-1px);
}

.custom-product-btn--primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.custom-product-fade-enter-active,
.custom-product-fade-leave-active {
  transition: opacity 0.22s ease;
}

.custom-product-fade-enter-from,
.custom-product-fade-leave-to {
  opacity: 0;
}

@keyframes customProductScaleIn {
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
