<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { RealtimeChannel } from '@supabase/supabase-js'
import BarcodeScanner from './BarcodeScanner.vue'
import NewProductModal from './NewProductModal.vue'
import ProductSearch from './ProductSearch.vue'
import ShoppingItem from './ShoppingItem.vue'
import { enqueueItemMutation, flushOfflineItemMutations, isOfflineLikeError } from '../lib/offlineItemsQueue'
import { findStoredProductByBarcode, saveProductToCatalog } from '../lib/productCatalog'
import { getProductEmoji } from '../lib/productEmoji'
import { supabase } from '../lib/supabase'
import { addDebugLog, debugOverlayEnabled } from '../lib/debugOverlay'
import type { Family, FamilyMember, ProductSuggestion, ShoppingItem as ShoppingItemModel } from '../types'

const props = defineProps<{
  family: Family
  userId: string
  familyMembers?: FamilyMember[]
}>()

const emit = defineEmits<{
  membershipRevoked: []
}>()

const items = ref<ShoppingItemModel[]>([])
const loadingItems = ref(true)
const listError = ref('')
const draftName = ref('')
const draftQty = ref(1)
const selectedProduct = ref<ProductSuggestion | null>(null)
const isAdding = ref(false)
const pendingItemIds = ref(new Set<string>())
const showScanner = ref(false)
const showNewProductModal = ref(false)
const pendingBarcode = ref('')
const composerHint = ref('Search your catalog, scan a barcode, or type a custom product.')
let itemsChannel: RealtimeChannel | null = null
let itemsReconnectTimer: number | null = null
let syncRecoveryTimer: number | null = null
let lastItemsSyncAt = 0
let syncInFlight: Promise<void> | null = null
let itemsChannelSubscribed = false

type ItemsBroadcastPayload =
  | { type: 'upsert'; item: ShoppingItemModel }
  | { type: 'delete'; itemId: string }
  | { type: 'delete-many'; itemIds: string[] }

type SupabaseLikeError = {
  code?: string
  message?: string
  details?: string
  hint?: string
}

const ITEMS_STALE_AFTER_MS = 20_000
const VISIBILITY_SYNC_THRESHOLD_MS = 5_000
const REALTIME_RESUME_EVENT = 'famcart:realtime-resume'

const canAddItem = computed(() => draftName.value.trim().length > 0 && !isAdding.value)

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

function isItemPending(itemId: string): boolean {
  return pendingItemIds.value.has(itemId)
}

function setItemPending(itemId: string, pending: boolean) {
  const nextPendingItemIds = new Set(pendingItemIds.value)

  if (pending) {
    nextPendingItemIds.add(itemId)
  } else {
    nextPendingItemIds.delete(itemId)
  }

  pendingItemIds.value = nextPendingItemIds
}

function markItemsSynced() {
  lastItemsSyncAt = Date.now()
}

function itemsSyncIsStale(thresholdMs = ITEMS_STALE_AFTER_MS): boolean {
  return Date.now() - lastItemsSyncAt > thresholdMs
}

function formatSupabaseError(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error) {
    addDebugLog('error', '[addItem error]', error.message)
    return error.message
  }

  const supabaseError = error as SupabaseLikeError | null
  const message = supabaseError?.message ?? ''
  const details = supabaseError?.details ?? ''
  const hint = supabaseError?.hint ?? ''
  const code = (supabaseError as Record<string, unknown>)?.code ?? ''
  addDebugLog('error', '[addItem error]', JSON.stringify({ code, message, details, hint }))

  const combined = [message, details, hint].filter(Boolean).join(' ')

  if (
    combined.includes('normalized_brand')
    || combined.includes('no unique or exclusion constraint matching the ON CONFLICT specification')
  ) {
    const rawDetail = [message, details, hint].filter(Boolean).join(' | ')
    return `Schema update needed. Details: ${rawDetail}`
  }

  return message || fallbackMessage
}

function resetComposer() {
  draftName.value = ''
  draftQty.value = 1
  selectedProduct.value = null
  pendingBarcode.value = ''
  composerHint.value = 'Search your catalog, scan a barcode, or type a custom product.'
}

async function handleBarcodeScanned(barcode: string) {
  showScanner.value = false
  listError.value = ''
  pendingBarcode.value = barcode

  try {
    const matchedProduct = await findStoredProductByBarcode(barcode)

    if (matchedProduct) {
      selectedProduct.value = matchedProduct
      draftName.value = matchedProduct.product_name
      composerHint.value = `Matched barcode ${barcode} from your catalog.`
      return
    }

    // Product not found — open the new product modal
    showNewProductModal.value = true
  } catch (error) {
    listError.value = error instanceof Error ? error.message : 'Unable to process barcode.'
  }
}

function handleNewProductSaved(product: import('../types').ProductSuggestion) {
  selectedProduct.value = product
  draftName.value = product.product_name
  composerHint.value = `Saved "${product.product_name}" to your catalog.`
  showNewProductModal.value = false
}

function handleNewProductModalClose() {
  showNewProductModal.value = false
  if (!selectedProduct.value) {
    composerHint.value = pendingBarcode.value
      ? `Barcode ${pendingBarcode.value} not saved. Enter a product name manually.`
      : 'Search your catalog, scan a barcode, or type a custom product.'
  }
}

function handleMembershipRevoked() {
  listError.value = 'You were removed from this family.'
  items.value = []
  emit('membershipRevoked')
}

async function ensureMembership(): Promise<boolean> {
  const response = await supabase
    .from('family_members')
    .select('id')
    .eq('family_id', props.family.id)
    .eq('user_id', props.userId)
    .maybeSingle()

  if (response.error) {
    listError.value = response.error.message
    return false
  }

  if (!response.data) {
    handleMembershipRevoked()
    return false
  }

  return true
}

async function pullLatestItemsSilently() {
  if (!props.family?.id) return

  const response = await supabase
    .from('items')
    .select('id, family_id, name, brand, image, quantity, completed, created_by, created_at')
    .eq('family_id', props.family.id)
    .order('created_at', { ascending: false })

  if (!response.error && response.data) {
    items.value = response.data as ShoppingItemModel[]
    markItemsSynced()
  }
}

function scheduleItemsReconnect() {
  if (itemsReconnectTimer !== null) return

  itemsReconnectTimer = window.setTimeout(() => {
    itemsReconnectTimer = null
    startItemsSubscription()
    lastItemsSyncAt = 0
    void pullLatestItemsSilently()
  }, 1500)
}

function handleItemsVisibilityChange() {
  if (document.visibilityState !== 'visible') return

  if (navigator.onLine) {
    void syncOfflineQueueInternal(true)
    return
  }

  if (!itemsSyncIsStale(VISIBILITY_SYNC_THRESHOLD_MS)) return
  void pullLatestItemsSilently()
}

async function stopItemsSubscription() {
  if (!itemsChannel) return
  itemsChannelSubscribed = false
  await supabase.removeChannel(itemsChannel)
  itemsChannel = null
}

async function recoverItemsRealtime() {
  if (!props.family?.id) return

  await stopItemsSubscription()
  startItemsSubscription()
  lastItemsSyncAt = 0

  if (navigator.onLine) {
    await syncOfflineQueueInternal(true)
    return
  }

  await pullLatestItemsSilently()
}

function handleRealtimeResume() {
  void recoverItemsRealtime()
}

function startItemsSubscription() {
  void stopItemsSubscription()
  itemsChannelSubscribed = false

  itemsChannel = supabase
    .channel(`items:${props.family.id}`, {
      config: {
        broadcast: {
          ack: false,
          self: false,
        },
      },
    })
    .on('broadcast', { event: 'items-mutated' }, ({ payload }) => {
      handleItemsBroadcast(payload as ItemsBroadcastPayload)
    })
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'items',
        filter: `family_id=eq.${props.family.id}`,
      },
      (payload) => {
        markItemsSynced()

        if (payload.eventType === 'INSERT') {
          const nextItem = payload.new as ShoppingItemModel
          if (!items.value.some((i) => i.id === nextItem.id)) {
            items.value = [nextItem, ...items.value]
          }
          return
        }

        if (payload.eventType === 'UPDATE') {
          const nextItem = payload.new as ShoppingItemModel
          items.value = items.value.map((item) => (item.id === nextItem.id ? nextItem : item))
          return
        }

        if (payload.eventType === 'DELETE') {
          const removedItem = payload.old as ShoppingItemModel
          items.value = items.value.filter((item) => item.id !== removedItem.id)
        }
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        itemsChannelSubscribed = true
        listError.value = ''

        if (debugOverlayEnabled) {
          addDebugLog('info', 'Items channel subscribed', { familyId: props.family.id })
        }

        void pullLatestItemsSilently()
        return
      }

      itemsChannelSubscribed = false

      if (debugOverlayEnabled) {
        addDebugLog('warn', 'Items channel status', {
          familyId: props.family.id,
          status,
          online: navigator.onLine,
        })
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        scheduleItemsReconnect()
      }
    })
}

async function loadItems() {
  loadingItems.value = true
  listError.value = ''

  if (navigator.onLine) {
    await syncOfflineQueue()
  }

  const hasMembership = await ensureMembership()
  if (!hasMembership) {
    loadingItems.value = false
    return
  }

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
  markItemsSynced()
  loadingItems.value = false
}

function applyLocalAddOrIncrement(name: string, qty: number, brand: string, image: string) {
  const normalizedName = name.trim().toLowerCase()
  const normalizedBrand = brand.trim().toLowerCase()
  const existing = items.value.find(
    (item) =>
      !item.completed
      && item.name.trim().toLowerCase() === normalizedName
      && (item.brand ?? '').trim().toLowerCase() === normalizedBrand,
  )

  if (existing) {
    const nextQty = Math.min(existing.quantity + qty, 99)
    items.value = items.value.map((item) =>
      item.id === existing.id
        ? {
          ...item,
          quantity: nextQty,
          brand: item.brand || brand,
          image: item.image || image,
        }
        : item,
    )
    return
  }

  const optimisticItem: ShoppingItemModel = {
    id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    family_id: props.family.id,
    name,
    brand,
    image,
    quantity: Math.min(Math.max(qty, 1), 99),
    completed: false,
    created_by: props.userId,
    created_at: new Date().toISOString(),
  }

  items.value = [optimisticItem, ...items.value]
}

function applyServerItem(serverItem: ShoppingItemModel) {
  const normalizedName = serverItem.name.trim().toLowerCase()
  const normalizedBrand = (serverItem.brand ?? '').trim().toLowerCase()
  const withoutOptimisticDuplicate = items.value.filter(
    (item) => !(
      item.id.startsWith('offline-')
      && !item.completed
      && item.name.trim().toLowerCase() === normalizedName
      && (item.brand ?? '').trim().toLowerCase() === normalizedBrand
    ),
  )

  if (withoutOptimisticDuplicate.some((item) => item.id === serverItem.id)) {
    items.value = withoutOptimisticDuplicate.map((item) => (item.id === serverItem.id ? serverItem : item))
    return
  }

  items.value = [serverItem, ...withoutOptimisticDuplicate]
}

function applyDeletedItem(itemId: string) {
  items.value = items.value.filter((item) => item.id !== itemId)
}

function applyDeletedItems(itemIds: string[]) {
  if (!itemIds.length) return

  const deletedIds = new Set(itemIds)
  items.value = items.value.filter((item) => !deletedIds.has(item.id))
}

function handleItemsBroadcast(payload: ItemsBroadcastPayload) {
  markItemsSynced()

  if (payload.type === 'upsert') {
    applyServerItem(payload.item)
    return
  }

  if (payload.type === 'delete') {
    applyDeletedItem(payload.itemId)
    return
  }

  applyDeletedItems(payload.itemIds)
}

async function broadcastItemsMutation(payload: ItemsBroadcastPayload) {
  if (!itemsChannel || !itemsChannelSubscribed) {
    if (debugOverlayEnabled) {
      addDebugLog('warn', 'Skipped fast item broadcast', {
        familyId: props.family.id,
        subscribed: itemsChannelSubscribed,
        hasChannel: Boolean(itemsChannel),
        online: navigator.onLine,
        type: payload.type,
      })
    }

    return
  }

  try {
    await itemsChannel.send({
      type: 'broadcast',
      event: 'items-mutated',
      payload,
    })
  } catch (error) {
    if (debugOverlayEnabled) {
      addDebugLog('warn', 'Fast item broadcast failed', error)
    }

    // Postgres realtime remains the fallback when the fast broadcast misses.
  }
}

async function syncOfflineQueue() {
  await syncOfflineQueueInternal(false)
}

async function syncOfflineQueueInternal(forceRefresh: boolean) {
  if (syncInFlight) {
    await syncInFlight
    return
  }

  syncInFlight = (async () => {
    const result = await flushOfflineItemMutations()
    if (result.applied > 0 || forceRefresh) {
      await pullLatestItemsSilently()
    }
  })()

  try {
    await syncInFlight
  } finally {
    syncInFlight = null
  }
}

function handleOnlineSync() {
  void syncOfflineQueueInternal(true)
}

async function addItem() {
  const nextName = draftName.value.trim()

  if (!nextName) {
    listError.value = 'Enter an item name before adding it.'
    return
  }

  isAdding.value = true
  listError.value = ''

  const nextBrand = selectedProduct.value?.brand || ''
  const nextImage = selectedProduct.value?.image_url || ''
  const nextBarcode = selectedProduct.value?.barcode || pendingBarcode.value

  try {
    const response = await supabase.rpc('add_or_increment_item', {
      p_family_id: props.family.id,
      p_name: nextName,
      p_brand: nextBrand,
      p_image: nextImage,
      p_quantity: draftQty.value,
      p_created_by: props.userId,
    })

    if (response.error) {
      throw response.error
    }

    if (response.data) {
      const serverItem = response.data as unknown as ShoppingItemModel
      applyServerItem(serverItem)
      markItemsSynced()
      void broadcastItemsMutation({ type: 'upsert', item: serverItem })
    }

    void saveProductToCatalog({
      product_name: nextName,
      brand: nextBrand,
      image_url: nextImage,
      barcode: nextBarcode,
      created_by: props.userId,
    })

    resetComposer()
  } catch (error) {
    if (isOfflineLikeError(error)) {
      applyLocalAddOrIncrement(nextName, draftQty.value, nextBrand, nextImage)
      enqueueItemMutation({
        type: 'add-or-increment',
        payload: {
          familyId: props.family.id,
          name: nextName,
          brand: nextBrand,
          image: nextImage,
          quantity: draftQty.value,
          createdBy: props.userId,
        },
      })
      listError.value = 'You are offline. Item queued and will sync automatically.'
      resetComposer()
    } else {
      listError.value = formatSupabaseError(error, 'Unable to add item.')
    }
  } finally {
    isAdding.value = false
  }
}

async function toggleItem(item: ShoppingItemModel) {
  if (isItemPending(item.id)) return

  listError.value = ''
  setItemPending(item.id, true)

  const nextCompleted = !item.completed
  items.value = items.value.map((currentItem) =>
    currentItem.id === item.id ? { ...currentItem, completed: nextCompleted } : currentItem,
  )

  const response = await supabase
    .from('items')
    .update({ completed: nextCompleted })
    .eq('id', item.id)
    .select('id, family_id, name, brand, image, quantity, completed, created_by, created_at')
    .single()

  if (response.error) {
    if (isOfflineLikeError(response.error)) {
      enqueueItemMutation({
        type: 'toggle',
        payload: { itemId: item.id, completed: nextCompleted },
      })
      listError.value = 'You are offline. Change queued and will sync automatically.'
      setItemPending(item.id, false)
      return
    }

    listError.value = response.error.message
    items.value = items.value.map((currentItem) =>
      currentItem.id === item.id ? { ...currentItem, completed: item.completed } : currentItem,
    )
    setItemPending(item.id, false)
    return
  }

  if (response.data) {
    const serverItem = response.data as ShoppingItemModel
    applyServerItem(serverItem)
    markItemsSynced()
    void broadcastItemsMutation({ type: 'upsert', item: serverItem })
  }

  setItemPending(item.id, false)
}

async function deleteItem(itemId: string) {
  if (isItemPending(itemId)) return

  listError.value = ''
  setItemPending(itemId, true)

  const previousItems = items.value
  applyDeletedItem(itemId)

  const response = await supabase.from('items').delete().eq('id', itemId)

  if (response.error) {
    if (isOfflineLikeError(response.error)) {
      enqueueItemMutation({
        type: 'delete',
        payload: { itemId },
      })
      listError.value = 'You are offline. Deletion queued and will sync automatically.'
      setItemPending(itemId, false)
      return
    }

    listError.value = response.error.message
    items.value = previousItems
    setItemPending(itemId, false)
    return
  }

  markItemsSynced()
  void broadcastItemsMutation({ type: 'delete', itemId })
  setItemPending(itemId, false)
}

const isCheckingOut = ref(false)

async function checkoutCompleted() {
  if (isCheckingOut.value) return

  const ids = doneItems.value.map((item) => item.id)
  if (!ids.length) return

  isCheckingOut.value = true
  listError.value = ''

  const previousItems = items.value
  applyDeletedItems(ids)

  const response = await supabase.from('items').delete().in('id', ids)

  if (response.error) {
    if (isOfflineLikeError(response.error)) {
      enqueueItemMutation({
        type: 'checkout',
        payload: { itemIds: ids },
      })
      listError.value = 'You are offline. Checkout queued and will sync automatically.'
      isCheckingOut.value = false
      return
    }

    listError.value = response.error.message
    items.value = previousItems
    isCheckingOut.value = false
    return
  }

  markItemsSynced()
  void broadcastItemsMutation({ type: 'delete-many', itemIds: ids })
  isCheckingOut.value = false
}

watch(
  () => props.family.id,
  () => {
    startItemsSubscription()
    void loadItems()
  },
  { immediate: true },
)

onMounted(() => {
  // Heartbeat fallback for cases where a mobile websocket silently stalls.
  syncRecoveryTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible' && itemsSyncIsStale()) {
      if (navigator.onLine) {
        void syncOfflineQueueInternal(true)
      } else {
        void pullLatestItemsSilently()
      }
    }
  }, 20000)

  document.addEventListener('visibilitychange', handleItemsVisibilityChange)
  window.addEventListener('online', handleOnlineSync)
  window.addEventListener(REALTIME_RESUME_EVENT, handleRealtimeResume)

  if (navigator.onLine) {
    void syncOfflineQueue()
  }
})

onBeforeUnmount(() => {
  void stopItemsSubscription()

  if (itemsReconnectTimer !== null) {
    window.clearTimeout(itemsReconnectTimer)
    itemsReconnectTimer = null
  }

  if (syncRecoveryTimer !== null) {
    window.clearInterval(syncRecoveryTimer)
    syncRecoveryTimer = null
  }

  document.removeEventListener('visibilitychange', handleItemsVisibilityChange)
  window.removeEventListener('online', handleOnlineSync)
  window.removeEventListener(REALTIME_RESUME_EVENT, handleRealtimeResume)
})
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
          <TransitionGroup v-if="pendingItems.length" name="items-stagger" tag="div" class="group">
            <ShoppingItem
              v-for="item in pendingItems"
              :key="item.id"
              :item="item"
              :added-by-avatar="getMemberAvatar(item.created_by)"
              :added-by-name="getMemberName(item.created_by)"
              :disabled="isItemPending(item.id)"
              @toggle="toggleItem"
              @remove="deleteItem"
            />
          </TransitionGroup>

          <!-- Done items -->
          <template v-if="doneItems.length">
            <div class="section-header section-header--sub">
              <span class="section-label">Done ({{ doneItems.length }})</span>
              <button type="button" class="checkout-btn" :disabled="isCheckingOut" @click="checkoutCompleted">
                {{ isCheckingOut ? 'Clearing...' : 'Checkout' }}
              </button>
            </div>
            <TransitionGroup name="items-stagger" tag="div" class="group group--done">
              <ShoppingItem
                v-for="item in doneItems"
                :key="item.id"
                :item="item"
                :added-by-avatar="getMemberAvatar(item.created_by)"
                :added-by-name="getMemberName(item.created_by)"
                :disabled="isItemPending(item.id)"
                @toggle="toggleItem"
                @remove="deleteItem"
              />
            </TransitionGroup>
          </template>
        </template>
      </section>
    </div>

    <!-- Bottom composer bar -->
    <div class="composer">
      <div class="composer-card">
        <div class="composer-header"></div>

        <div class="composer-input-row">
          <ProductSearch
            v-model="draftName"
            :family-id="props.family.id"
            :disabled="isAdding"
            @select-product="selectedProduct = $event"
          />
          <button
            type="button"
            class="scan-icon-btn"
            :disabled="isAdding"
            title="Scan barcode"
            aria-label="Scan barcode"
            @click="showScanner = true"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 7V5a2 2 0 0 1 2-2h2" />
              <path d="M21 7V5a2 2 0 0 0-2-2h-2" />
              <path d="M3 17v2a2 2 0 0 0 2 2h2" />
              <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
              <path d="M8 7v10" />
              <path d="M12 7v10" />
              <path d="M16 7v10" />
            </svg>
          </button>
        </div>

        <div v-if="selectedProduct" class="composer-preview">
          <img
            v-if="selectedProduct.image_url"
            :src="selectedProduct.image_url"
            :alt="selectedProduct.product_name"
          />
          <div v-else class="composer-preview-emoji">
            {{ getProductEmoji(selectedProduct.product_name, selectedProduct.brand) }}
          </div>
          <div>
            <strong>{{ selectedProduct.product_name }}</strong>
            <p class="meta">{{ selectedProduct.brand || 'Unknown brand' }}</p>
          </div>
        </div>

        <div class="composer-actions">
          <div class="qty-stepper">
            <button type="button" class="qty-btn" :disabled="draftQty <= 1 || isAdding" @click="draftQty--">−</button>
            <span class="qty-value">{{ draftQty }}</span>
            <button type="button" class="qty-btn" :disabled="draftQty >= 99 || isAdding" @click="draftQty++">+</button>
          </div>

          <button type="button" class="btn btn--primary composer-add-btn" :disabled="!canAddItem" @click="addItem">
            {{ isAdding ? 'Adding...' : 'Add Item' }}
          </button>
        </div>
      </div>

      <p v-if="listError" class="section-error">{{ listError }}</p>
    </div>

    <BarcodeScanner :open="showScanner" @close="showScanner = false" @scanned="handleBarcodeScanned" />

    <NewProductModal
      v-if="showNewProductModal"
      :barcode="pendingBarcode"
      :user-id="props.userId"
      @saved="handleNewProductSaved"
      @close="handleNewProductModalClose"
    />
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
  animation: screen-fade-in 340ms cubic-bezier(0.22, 1, 0.36, 1);
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
  position: relative;
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

.checkout-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  background: #1a7a48;
  color: #ffffff;
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  overflow: hidden;
  box-shadow: 0 6px 14px rgba(26, 122, 72, 0.28);
  transition: transform 180ms ease, box-shadow 180ms ease, opacity 180ms ease;
}

.checkout-btn::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(110deg, transparent 30%, rgba(255, 255, 255, 0.35) 50%, transparent 70%);
  transform: translateX(-120%);
  transition: transform 520ms ease;
}

.checkout-btn:hover::after {
  transform: translateX(120%);
}

.checkout-btn:active {
  transform: translateY(1px) scale(0.98);
  box-shadow: 0 3px 8px rgba(26, 122, 72, 0.22);
}

.checkout-btn:disabled {
  opacity: 0.45;
  pointer-events: none;
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

.composer-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #ffffff;
  border-radius: 14px;
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.05);
  animation: composer-rise 420ms cubic-bezier(0.2, 0.7, 0.2, 1);
}

.composer-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.composer-header p {
  margin-top: 0;
  font-size: 0.8125rem;
  color: #64748b;
}


.composer-field-label {
  font-size: 0.8125rem;
  font-weight: 700;
  color: #334155;
}

.composer-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.composer-input-row :deep(.search) {
  flex: 1;
}

.scan-icon-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.06);
  color: #1a7a48;
}

.scan-icon-btn svg {
  width: 18px;
  height: 18px;
}

.scan-icon-btn:active {
  background: rgba(15, 23, 42, 0.1);
}

.scan-icon-btn:hover {
  transform: translateY(-1px);
}

.scan-icon-btn:disabled {
  opacity: 0.35;
  pointer-events: none;
}

.composer-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.composer-add-btn {
  flex: 1;
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

.composer-preview-emoji {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: #f2f2f7;
  font-size: 1.25rem;
}

.composer-preview strong,
.composer-preview p {
  display: block;
}

.items-stagger-enter-active,
.items-stagger-leave-active {
  transition: transform 260ms cubic-bezier(0.2, 0.7, 0.2, 1), opacity 220ms ease;
}

.items-stagger-move {
  transition: transform 260ms cubic-bezier(0.2, 0.7, 0.2, 1);
}

.items-stagger-enter-from {
  opacity: 0;
  transform: translateY(12px) scale(0.985);
}

.items-stagger-leave-to {
  opacity: 0;
  transform: translateX(18px) scale(0.98);
}

.items-stagger-leave-active {
  position: absolute;
  width: 100%;
}

@keyframes composer-rise {
  from {
    opacity: 0;
    transform: translateY(14px) scale(0.99);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes screen-fade-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .list-scroll,
  .composer-card {
    animation: none;
  }

  .items-stagger-enter-active,
  .items-stagger-leave-active,
  .items-stagger-move,
  .checkout-btn,
  .checkout-btn::after,
  .scan-icon-btn {
    transition: none;
  }

  .checkout-btn::after {
    display: none;
  }
}
</style>