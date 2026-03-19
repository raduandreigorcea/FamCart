<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import type { ProductSuggestion } from '../types'

const props = withDefaults(
  defineProps<{
    modelValue: string
    disabled?: boolean
  }>(),
  {
    disabled: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'select-product': [product: ProductSuggestion | null]
}>()

const suggestions = ref<ProductSuggestion[]>([])
const isLoading = ref(false)
const skipNextLookup = ref(false)

let debounceTimer: ReturnType<typeof window.setTimeout> | null = null
let activeRequest: AbortController | null = null

function clearSuggestions() {
  suggestions.value = []
}

function handleInput(event: Event) {
  const nextValue = (event.target as HTMLInputElement).value
  emit('update:modelValue', nextValue)
  emit('select-product', null)
}

function selectSuggestion(product: ProductSuggestion) {
  skipNextLookup.value = true
  clearSuggestions()
  emit('update:modelValue', product.product_name)
  emit('select-product', product)
}

async function fetchSuggestions(query: string) {
  activeRequest?.abort()
  activeRequest = new AbortController()
  isLoading.value = true

  try {
    const response = await fetch(
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1`,
      { signal: activeRequest.signal },
    )

    const payload = (await response.json()) as {
      products?: Array<{
        product_name?: string
        brands?: string
        image_url?: string
      }>
    }

    suggestions.value = (payload.products ?? [])
      .filter((product) => product.product_name?.trim())
      .slice(0, 6)
      .map((product) => ({
        product_name: product.product_name?.trim() ?? '',
        brand: product.brands?.trim() ?? '',
        image_url: product.image_url?.trim() ?? '',
      }))
  } catch (error) {
    if ((error as DOMException).name !== 'AbortError') {
      suggestions.value = []
    }
  } finally {
    isLoading.value = false
  }
}

// Debounce and cancel lookups so the suggestion list stays stable while the user types.
watch(
  () => props.modelValue,
  (nextValue) => {
    if (debounceTimer) {
      window.clearTimeout(debounceTimer)
      debounceTimer = null
    }

    if (skipNextLookup.value) {
      skipNextLookup.value = false
      return
    }

    const trimmedValue = nextValue.trim()

    if (trimmedValue.length < 2) {
      activeRequest?.abort()
      isLoading.value = false
      suggestions.value = []
      return
    }

    debounceTimer = window.setTimeout(() => {
      void fetchSuggestions(trimmedValue)
    }, 250)
  },
)

onBeforeUnmount(() => {
  activeRequest?.abort()

  if (debounceTimer) {
    window.clearTimeout(debounceTimer)
  }
})
</script>

<template>
  <div class="search">
    <div class="search-field">
      <input
        :value="modelValue"
        type="text"
        name="product-search"
        placeholder="Search products..."
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        inputmode="search"
        enterkeyhint="search"
        data-lpignore="true"
        data-1p-ignore="true"
        data-form-type="other"
        :disabled="disabled"
        @input="handleInput"
        @keydown.escape="clearSuggestions"
      />
      <span v-if="isLoading" class="search-spinner">...</span>
    </div>

    <ul v-if="suggestions.length" class="suggestions">
      <li v-for="product in suggestions" :key="`${product.product_name}-${product.brand}`">
        <button type="button" class="suggestion" @click="selectSuggestion(product)">
          <img v-if="product.image_url" :src="product.image_url" :alt="product.product_name" />
          <div class="suggestion-text">
            <strong>{{ product.product_name }}</strong>
            <span>{{ product.brand || 'Unknown brand' }}</span>
          </div>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.search {
  position: relative;
}

.search-field {
  position: relative;
}

.search-field input {
  width: 100%;
  height: 48px;
  padding: 0 14px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid rgba(48, 232, 140, 0.2);
  font-size: 0.9375rem;
}

.search-field input:focus {
  outline: none;
  border-color: #30e88c;
  box-shadow: 0 0 0 3px rgba(48, 232, 140, 0.2);
}

.search-spinner {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: #8e8e93;
  font-size: 0.8125rem;
}

.suggestions {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 100%;
  margin-bottom: 6px;
  max-height: 280px;
  overflow-y: auto;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.12);
  z-index: 30;
}

.suggestion {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 14px;
  text-align: left;
  min-height: 52px;
}

.suggestion + .suggestion,
li + li .suggestion {
  border-top: 0.5px solid rgba(0, 0, 0, 0.06);
}

.suggestion:active {
  background: #f2f2f7;
}

.suggestion img {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  object-fit: cover;
  background: #f2f2f7;
}

.suggestion-text {
  min-width: 0;
}

.suggestion-text strong {
  display: block;
  font-size: 0.875rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.suggestion-text span {
  display: block;
  font-size: 0.75rem;
  color: #8e8e93;
  margin-top: 1px;
}
</style>