<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ProductSearch from './ProductSearch.vue'
import ShoppingItem from './ShoppingItem.vue'
import { supabase } from '../lib/supabase.js'
import type { Family, FamilyMember, ProductSuggestion, ShoppingItem as ShoppingItemModel } from '../types'

const props = defineProps<{
  family: Family
  userId: string
  familyMembers?: FamilyMember[]
}>()

const items = ref<ShoppingItemModel[]>([])
const loadingItems = ref(true)
const listError = ref('')
const draftName = ref('')
const draftQty = ref(1)
const selectedProduct = ref<ProductSuggestion | null>(null)
const isAdding = ref(false)
const activeItemId = ref<string | null>(null)

function getMemberName(userId: string): string {
  const member = props.familyMembers?.find((m) => m.user_id === userId)
  return member?.display_name?.trim() || userId.slice(0, 10) + '...'
}

function getMemberAvatar(userId: string): string | undefined {
  const member = props.familyMembers?.find((m) => m.user_id === userId)
  if (member?.image_url) return member.image_url
  return `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(userId)}`
}

const remainingCount = computed(() => items.value.filter((item) => !item.completed).length)
const hasItems = computed(() => items.value.length > 0)
const pendingItems = computed(() => items.value.filter((i) => !i.completed))
const doneItems = computed(() => items.value.filter((i) => i.completed))

function resetComposer() {
  draftName.value = ''
  draftQty.value = 1
  selectedProduct.value = null
}

async function loadItems() {
  loadingItems.value = true
  listError.value = ''

  const response = await supabase
    .from('items')
    .select('id, family_id, name, brand, image, quantity, completed, created_by, created_at')
    .eq('family_id', props.family.id)
    .order('created_at', { ascending: false })

  if (response.error) {
    listError.value = response.error.message
    items.value = []
    loadingItems.value = false
    return
  }

  items.value = (response.data as ShoppingItemModel[] | null) ?? []
  loadingItems.value = false
}

async function addItem() {
  const nextName = draftName.value.trim()

  if (!nextName) {
    listError.value = 'Enter an item name before adding it.'
    return
  }

  isAdding.value = true
  listError.value = ''

  try {
    // Insert directly from the client because Supabase is the only backend layer in this app.
    const response = await supabase
      .from('items')
      .insert({
        family_id: props.family.id,
        name: nextName,
        brand: selectedProduct.value?.brand || '',
        image: selectedProduct.value?.image_url || '',
        quantity: draftQty.value,
        completed: false,
        created_by: props.userId,
        created_at: new Date().toISOString(),
      })
      .select('id, family_id, name, brand, image, quantity, completed, created_by, created_at')
      .single()

    if (response.error || !response.data) {
      throw response.error ?? new Error('Unable to add item.')
    }

    items.value = [response.data as ShoppingItemModel, ...items.value]
    resetComposer()
  } catch (error) {
    listError.value = error instanceof Error ? error.message : 'Unable to add item.'
  } finally {
    isAdding.value = false
  }
}

async function toggleItem(item: ShoppingItemModel) {
  activeItemId.value = item.id
  listError.value = ''

  const response = await supabase
    .from('items')
    .update({ completed: !item.completed })
    .eq('id', item.id)

  if (response.error) {
    listError.value = response.error.message
    activeItemId.value = null
    return
  }

  items.value = items.value.map((currentItem) =>
    currentItem.id === item.id ? { ...currentItem, completed: !currentItem.completed } : currentItem,
  )

  activeItemId.value = null
}

async function deleteItem(itemId: string) {
  activeItemId.value = itemId
  listError.value = ''

  const response = await supabase.from('items').delete().eq('id', itemId)

  if (response.error) {
    listError.value = response.error.message
    activeItemId.value = null
    return
  }

  items.value = items.value.filter((item) => item.id !== itemId)
  activeItemId.value = null
}

watch(
  () => props.family.id,
  () => {
    void loadItems()
  },
  { immediate: true },
)
</script>

<template>
  <div class="list-view">
    <!-- Scrollable content area -->
    <div class="list-scroll">

      <!-- Items section -->
      <section class="section">
        <div v-if="hasItems" class="section-header">
          <span class="section-label">{{ remainingCount }} item{{ remainingCount === 1 ? '' : 's' }} left</span>
          <button type="button" class="link-btn" :disabled="loadingItems" @click="loadItems">
            <svg class="refresh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <polyline points="21 3 21 9 15 9" />
            </svg>
            Refresh
          </button>
        </div>

        <div v-if="loadingItems" class="empty-state">
          <p>Loading items...</p>
        </div>

        <div v-else-if="items.length === 0" class="empty-state">
          <span class="empty-icon">🛒</span>
          <p>Your list is empty</p>
          <p class="meta">Search for a product below to add one.</p>
        </div>

        <template v-else>
          <!-- Items to buy -->
          <div v-if="pendingItems.length" class="group">
            <ShoppingItem
              v-for="item in pendingItems"
              :key="item.id"
              :item="item"
              :added-by-avatar="getMemberAvatar(item.created_by)"
              :added-by-name="getMemberName(item.created_by)"
              :disabled="activeItemId === item.id"
              @toggle="toggleItem"
              @remove="deleteItem"
            />
          </div>

          <!-- Done items -->
          <template v-if="doneItems.length">
            <div class="section-header section-header--sub">
              <span class="section-label">Done ({{ doneItems.length }})</span>
            </div>
            <div class="group group--done">
              <ShoppingItem
                v-for="item in doneItems"
                :key="item.id"
                :item="item"
                :added-by-avatar="getMemberAvatar(item.created_by)"
                :added-by-name="getMemberName(item.created_by)"
                :disabled="activeItemId === item.id"
                @toggle="toggleItem"
                @remove="deleteItem"
              />
            </div>
          </template>
        </template>
      </section>
    </div>

    <!-- Bottom composer bar -->
    <div class="composer">
      <ProductSearch v-model="draftName" :disabled="isAdding" @select-product="selectedProduct = $event" />

      <div v-if="selectedProduct" class="composer-preview">
        <img
          v-if="selectedProduct.image_url"
          :src="selectedProduct.image_url"
          :alt="selectedProduct.product_name"
        />
        <div>
          <strong>{{ selectedProduct.product_name }}</strong>
          <p class="meta">{{ selectedProduct.brand || 'Unknown brand' }}</p>
        </div>
      </div>

      <div class="qty-row">
        <span class="qty-label">Quantity</span>
        <div class="qty-stepper">
          <button type="button" class="qty-btn" :disabled="draftQty <= 1 || isAdding" @click="draftQty--">−</button>
          <span class="qty-value">{{ draftQty }}</span>
          <button type="button" class="qty-btn" :disabled="draftQty >= 99 || isAdding" @click="draftQty++">+</button>
        </div>
      </div>

      <button type="button" class="btn btn--primary btn--full" :disabled="isAdding" @click="addItem">
        {{ isAdding ? 'Adding...' : 'Add Item' }}
      </button>

      <p v-if="listError" class="section-error">{{ listError }}</p>
    </div>
  </div>
</template>

<style scoped>
.list-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.list-scroll {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 0 16px;
}

/* --- Section --- */
.section {
  margin-top: 24px;
}

.section:first-child {
  margin-top: 16px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px 8px;
}

.section-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #8e8e93;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.section-error {
  padding: 8px 4px 0;
  font-size: 0.8125rem;
  color: #ff3b30;
}

/* --- iOS-style grouped rows --- */
.group {
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
}

.group--done {
  opacity: 0.7;
}

.section-header--sub {
  margin-top: 16px;
}

.group-row {
  padding: 14px 16px;
}

.group-row + .group-row {
  border-top: 0.5px solid rgba(0, 0, 0, 0.08);
}

.group-row--between {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.group-row--actions {
  display: flex;
  gap: 24px;
}

.meta {
  color: #8e8e93;
  font-size: 0.8125rem;
  margin-top: 2px;
}

.badge {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  padding: 0 12px;
  border-radius: 14px;
  background: #30e88c;
  color: #112119;
  font-size: 0.8125rem;
  font-weight: 700;
}

/* --- Buttons --- */
.link-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  font-size: 0.9375rem;
  color: #1a7a48;
  font-weight: 500;
}

.refresh-icon {
  width: 14px;
  height: 14px;
}

.link-btn:active { opacity: 0.5; }
.link-btn:disabled { opacity: 0.35; pointer-events: none; }

.link-btn--danger {
  color: #ff3b30;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 50px;
  border-radius: 12px;
  font-size: 1rem;
  font-weight: 600;
}

.btn--full { width: 100%; }

.btn--primary {
  background: #30e88c;
  color: #112119;
  font-weight: 700;
  box-shadow: 0 4px 12px rgba(48, 232, 140, 0.25);
}

.btn--primary:active { background: #22c974; }
.btn:disabled { opacity: 0.45; pointer-events: none; }

/* --- Quantity stepper --- */
.qty-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 4px;
}

.qty-label {
  font-size: 0.9375rem;
  color: #1c1c1e;
  font-weight: 500;
}

.qty-stepper {
  display: flex;
  align-items: center;
  gap: 0;
  background: #fff;
  border: 1px solid rgba(0,0,0,0.1);
  border-radius: 10px;
  overflow: hidden;
}

.qty-btn {
  width: 36px;
  height: 36px;
  font-size: 1.25rem;
  color: #1a7a48;
  font-weight: 500;
}

.qty-btn:active { background: rgba(0,0,0,0.04); }
.qty-btn:disabled { opacity: 0.35; pointer-events: none; }

.qty-value {
  min-width: 32px;
  text-align: center;
  font-size: 0.9375rem;
  font-weight: 600;
  color: #1c1c1e;
  border-left: 1px solid rgba(0,0,0,0.07);
  border-right: 1px solid rgba(0,0,0,0.07);
  padding: 0 4px;
  line-height: 36px;
}

/* --- Empty state --- */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 16px;
  text-align: center;
  color: #8e8e93;
  background: #fff;
  border-radius: 12px;
}

.empty-icon {
  font-size: 2rem;
  margin-bottom: 12px;
}

/* --- Bottom composer --- */
.composer {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 16px calc(var(--safe-bottom) + 12px);
  background: rgba(246, 248, 247, 0.92);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-top: 0.5px solid rgba(0, 0, 0, 0.08);
}

.composer-preview {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: #fff;
  border-radius: 10px;
}

.composer-preview img {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  object-fit: cover;
  background: #f2f2f7;
}

.composer-preview strong,
.composer-preview p {
  display: block;
}
</style>