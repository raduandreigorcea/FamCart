<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { saveProductToCatalog } from '../lib/productCatalog'
import type { ProductSuggestion } from '../types'

const props = defineProps<{
  barcode: string
  userId: string
}>()

const emit = defineEmits<{
  close: []
  saved: [product: ProductSuggestion]
}>()

const isOpen = ref(false)
const nameInputRef = ref<HTMLInputElement | null>(null)

onMounted(() => {
  requestAnimationFrame(() => {
    isOpen.value = true
    void nextTick(() => {
      nameInputRef.value?.focus()
    })
  })
})

const productName = ref('')
const brand = ref('')
const imageUrl = ref('')
const saving = ref(false)
const error = ref('')

function requestClose() {
  isOpen.value = false
}

function onModalAfterLeave() {
  emit('close')
}

function sanitizeUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
  } catch {
    return ''
  }
  return trimmed
}

async function save() {
  const name = productName.value.trim()
  if (!name) {
    error.value = 'Product name is required.'
    return
  }

  const safeImageUrl = sanitizeUrl(imageUrl.value)
  if (imageUrl.value.trim() && !safeImageUrl) {
    error.value = 'Image URL must be a valid http or https URL.'
    return
  }

  saving.value = true
  error.value = ''

  try {
    await saveProductToCatalog({
      product_name: name,
      brand: brand.value.trim(),
      image_url: safeImageUrl,
      barcode: props.barcode,
      created_by: props.userId,
    })

    const savedProduct: ProductSuggestion = {
      id: 0,
      product_name: name,
      brand: brand.value.trim(),
      image_url: safeImageUrl,
      usage_count: 1,
      barcode: props.barcode,
    }

    emit('saved', savedProduct)
    isOpen.value = false
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Unable to save product.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal" @after-leave="onModalAfterLeave">
      <div v-if="isOpen" class="overlay" @click.self="requestClose">
        <div class="sheet">
          <div class="sheet-handle" />

          <div class="sheet-header">
            <h2>New Product</h2>
            <button type="button" class="close-btn" :disabled="saving" @click="requestClose">Cancel</button>
          </div>

          <p class="barcode-label">
            Barcode <span class="barcode-value">{{ barcode }}</span> wasn't found in your catalog. Fill in the details to save it.
          </p>

          <form class="form" @submit.prevent="save">
            <div class="field">
              <label class="field-label" for="np-name">Name <span class="required">*</span></label>
              <input
                id="np-name"
                ref="nameInputRef"
                v-model="productName"
                class="field-input"
                type="text"
                placeholder="e.g. Whole Milk"
                maxlength="200"
                autocomplete="off"
                :disabled="saving"
              />
            </div>

            <div class="field">
              <label class="field-label" for="np-brand">Brand <span class="optional">(optional)</span></label>
              <input
                id="np-brand"
                v-model="brand"
                class="field-input"
                type="text"
                placeholder="e.g. Organic Valley"
                maxlength="100"
                autocomplete="off"
                :disabled="saving"
              />
            </div>

            <div class="field">
              <label class="field-label" for="np-image">Image URL <span class="optional">(optional)</span></label>
              <input
                id="np-image"
                v-model="imageUrl"
                class="field-input"
                type="url"
                placeholder="https://example.com/image.jpg"
                autocomplete="off"
                :disabled="saving"
              />
            </div>

            <p v-if="error" class="form-error">{{ error }}</p>

            <div class="form-actions">
              <button
                type="submit"
                class="btn btn--primary"
                :disabled="saving || !productName.trim()"
              >
                {{ saving ? 'Saving...' : 'Save to Catalog' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: flex-end;
  background: rgba(0, 0, 0, 0.4);
}

.sheet {
  width: 100%;
  max-height: 90dvh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  background: #f6f8f7;
  border-radius: 16px 16px 0 0;
  padding: 0 16px calc(var(--safe-bottom, 0px) + 24px);
}

.sheet-handle {
  width: 36px;
  height: 4px;
  margin: 8px auto 4px;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.15);
}

.sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0 16px;
}

.sheet-header h2 {
  font-size: 1.125rem;
  font-weight: 700;
}

.close-btn {
  font-size: 0.9375rem;
  font-weight: 600;
  color: #8e8e93;
  padding: 4px 0;
}

.close-btn:active {
  opacity: 0.5;
}

.close-btn:disabled {
  opacity: 0.4;
}

.barcode-label {
  font-size: 0.875rem;
  color: #6b7280;
  margin-bottom: 20px;
  line-height: 1.4;
}

.barcode-value {
  font-weight: 600;
  color: #1c1c1e;
  font-variant-numeric: tabular-nums;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #8e8e93;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding-left: 4px;
}

.required {
  color: #ff3b30;
}

.optional {
  color: #aeaeb2;
  text-transform: none;
  font-weight: 400;
  letter-spacing: 0;
  font-size: 0.75rem;
}

.field-input {
  width: 100%;
  padding: 12px 14px;
  font-size: 0.9375rem;
  border: 1.5px solid #d1d5db;
  border-radius: 10px;
  outline: none;
  font-family: inherit;
  background: #fff;
  color: #1c1c1e;
  box-sizing: border-box;
}

.field-input:focus {
  border-color: #30e88c;
}

.field-input:disabled {
  opacity: 0.5;
}

.form-error {
  font-size: 0.8125rem;
  color: #ff3b30;
  padding-left: 4px;
}

.form-actions {
  margin-top: 8px;
}

.btn {
  width: 100%;
  padding: 14px;
  border-radius: 12px;
  font-size: 1rem;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  border: none;
}

.btn--primary {
  background: #1a7a48;
  color: #fff;
}

.btn--primary:active {
  opacity: 0.85;
}

.btn--primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Modal transition */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-active .sheet {
  animation: modalSheetUp 0.32s cubic-bezier(0.32, 0.72, 0, 1) both;
}

.modal-leave-active .sheet {
  animation: modalSheetUp 0.24s ease-in reverse both;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

@keyframes modalSheetUp {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}
</style>
