<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { useAuth, useUser } from '@clerk/vue'
import { useRouter } from 'vue-router'
import { useSupabase } from '../supabase.js'
import AppTopbar from '../components/AppTopbar.vue'
import ConfirmModal from '../components/ConfirmModal.vue'
import ErrorMessage from '../components/ErrorMessage.vue'
import ShoppingListItem from '../components/ShoppingListItem.vue'
import SkeletonBlock from '../components/SkeletonBlock.vue'
import {
  sumActiveQuantities,
  findActiveItemByName,
  countActiveItemsByMember,
} from '../lib/shoppingList'

const { userId, isLoaded, getToken } = useAuth()
const { user } = useUser()
const router = useRouter()
const db = useSupabase()

const items = ref([])
const familyId = ref(null)
const familyName = ref('')
const familyInviteCode = ref('')
const familyOwnerId = ref('')
const familyItemLimit = ref(50)
const familyMembers = ref([])
const newItem = ref('')
const newQty = ref(1)
const qtyDirection = ref('up')
const loadError = ref('')
const addError = ref('')
const limitReachedPopupOpen = ref(false)
const adding = ref(false)
const realtimeChannels = []
const hasInitialized = ref(false)
const ITEM_NAME_MAX_LENGTH = 120
const realtimeHealthy = ref(false)
const reconnectInProgress = ref(false)
const channelsRefreshing = ref(false)
let reconnectTimeoutId = null
let fallbackRefreshIntervalId = null
let lastReconnectAttemptAt = 0

const RECONNECT_THROTTLE_MS = 1500
const RECONNECT_RETRY_MS = 2500
const FALLBACK_REFRESH_MS = 30000

const uncheckedItems = computed(() => items.value.filter((i) => !i.checked))
const checkedItems = computed(() => items.value.filter((i) => i.checked))
const leftCount = computed(() => sumActiveQuantities(items.value))

// Initial load: nothing fetched yet and no error to show instead. Items arriving
// (realtime or fetch) end the skeleton early even before hasInitialized flips.
const initialLoading = computed(() => !hasInitialized.value && !items.value.length && !loadError.value)
const skeletonNameWidths = ['55%', '38%', '62%', '30%']

function increaseQty() {
  qtyDirection.value = 'up'
  newQty.value = Math.min(99, newQty.value + 1)
}

function decreaseQty() {
  qtyDirection.value = 'down'
  newQty.value = Math.max(1, newQty.value - 1)
}

function handleVisibilityOrOnline() {
  if (!hasInitialized.value) return

  if (document.visibilityState === 'visible') {
    if (navigator.onLine) {
      console.log('App focused or online: refreshing state and reconnecting WebSocket...')
      void loadItems()
      void loadFamilyHeader()
      scheduleRealtimeReconnect('focus/online', 0)
    }
  } else {
    console.log('App backgrounded/unfocused: disconnecting WebSocket to save connection resources...')
    if (db && db.realtime) {
      db.realtime.disconnect()
    }
    realtimeHealthy.value = false
  }
}

function shouldKeepRealtimeActive() {
  return hasInitialized.value
    && !!familyId.value
    && document.visibilityState === 'visible'
    && navigator.onLine
}

function setupFallbackRefresh() {
  if (fallbackRefreshIntervalId) return
  // Watchdog only. When realtime is healthy the WebSocket already delivers every
  // change, so this does nothing and steady-state REST traffic is zero. It only
  // acts when the socket is down: try to reconnect and pull one fresh snapshot to
  // reconcile whatever was missed while disconnected.
  fallbackRefreshIntervalId = window.setInterval(() => {
    if (!shouldKeepRealtimeActive()) return
    if (realtimeHealthy.value) return
    scheduleRealtimeReconnect('watchdog tick', 0)
    void loadItems()
    void loadFamilyHeader()
  }, FALLBACK_REFRESH_MS)
}

function cleanupReconnectResources() {
  if (reconnectTimeoutId) {
    clearTimeout(reconnectTimeoutId)
    reconnectTimeoutId = null
  }
  if (fallbackRefreshIntervalId) {
    clearInterval(fallbackRefreshIntervalId)
    fallbackRefreshIntervalId = null
  }
}

function handleUserActivity() {
  if (!shouldKeepRealtimeActive()) return
  if (realtimeHealthy.value) return
  scheduleRealtimeReconnect('user activity', 0)
}

async function reconnectRealtime(reason) {
  if (reconnectInProgress.value || !shouldKeepRealtimeActive()) return

  const now = Date.now()
  if (now - lastReconnectAttemptAt < RECONNECT_THROTTLE_MS) return
  lastReconnectAttemptAt = now

  reconnectInProgress.value = true
  try {
    console.log(`Attempting realtime reconnect (${reason})...`)
    db.realtime.setAuth()
    db.realtime.connect()
    await setupRealtimeSubscriptions()
    await Promise.all([loadItems(), loadFamilyHeader()])
  } catch (error) {
    console.error('Realtime reconnect failed:', error)
    scheduleRealtimeReconnect('retry after failure', RECONNECT_RETRY_MS)
  } finally {
    reconnectInProgress.value = false
  }
}

function scheduleRealtimeReconnect(reason, delayMs = RECONNECT_THROTTLE_MS) {
  if (!shouldKeepRealtimeActive()) return
  if (reconnectTimeoutId || reconnectInProgress.value) return

  reconnectTimeoutId = window.setTimeout(() => {
    reconnectTimeoutId = null
    void reconnectRealtime(reason)
  }, delayMs)
}

function handleChannelStatus(channelName, status, err) {
  console.log(`${channelName} subscription status: ${status}`, err || '')

  if (status === 'SUBSCRIBED') {
    realtimeHealthy.value = true
    if (hasInitialized.value) {
      if (channelName === 'listChannel') {
        console.log('listChannel reconnected: fetching active items')
        void loadItems()
      }
      if (channelName === 'membersChannel') {
        console.log('membersChannel reconnected: fetching members')
        void loadFamilyHeader()
      }
      if (channelName === 'familyChannel') {
        console.log('familyChannel reconnected: fetching family header')
        void loadFamilyHeader()
      }
    }
    return
  }

  if (channelsRefreshing.value) return

  if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
    realtimeHealthy.value = false
    scheduleRealtimeReconnect(`${channelName}:${status}`, 0)
  }
}

onMounted(() => {
  void initializeHome()
  window.addEventListener('visibilitychange', handleVisibilityOrOnline)
  window.addEventListener('online', handleVisibilityOrOnline)
  window.addEventListener('pointerdown', handleUserActivity)
  window.addEventListener('keydown', handleUserActivity)
  window.addEventListener('touchstart', handleUserActivity, { passive: true })
  setupFallbackRefresh()
})

watch([isLoaded, userId], () => {
  void initializeHome()
})

onBeforeUnmount(() => {
  cleanupRealtimeSubscriptions()
  cleanupReconnectResources()
  window.removeEventListener('visibilitychange', handleVisibilityOrOnline)
  window.removeEventListener('online', handleVisibilityOrOnline)
  window.removeEventListener('pointerdown', handleUserActivity)
  window.removeEventListener('keydown', handleUserActivity)
  window.removeEventListener('touchstart', handleUserActivity)
})

async function initializeHome() {
  if (hasInitialized.value || !isLoaded.value || !userId.value) return

  sanitizeAuthCallbackUrl()

  // Fetch the user's family only after Clerk has finished loading.
  const { data: membership, error: mErr } = await db
    .from('family_members')
    .select('family_id')
    .eq('user_id', userId.value)
    .limit(1)
    .maybeSingle()

  if (mErr) {
    loadError.value = 'Could not load your family.'
    return
  }

  if (!membership?.family_id) {
    router.replace('/family-setup')
    return
  }

  familyId.value = membership.family_id
  await loadFamilyHeader()
  await loadItems()
  await setupRealtimeSubscriptions()
  hasInitialized.value = true
}

function sanitizeAuthCallbackUrl() {
  const current = new URL(window.location.href)
  const normalizedPath = `/${current.pathname.replace(/^\/+/, '')}`
  let changed = normalizedPath !== current.pathname

  const clerkParamKeys = []
  current.searchParams.forEach((_, key) => {
    if (key.startsWith('__clerk_')) clerkParamKeys.push(key)
  })

  if (clerkParamKeys.length) {
    clerkParamKeys.forEach((key) => current.searchParams.delete(key))
    changed = true
  }

  if (!changed) return

  const nextSearch = current.searchParams.toString()
  const nextUrl = `${normalizedPath}${nextSearch ? `?${nextSearch}` : ''}${current.hash}`
  window.history.replaceState({}, '', nextUrl)
}

async function loadFamilyHeader() {
  const [{ data: family, error: familyErr }, { data: members, error: membersErr }] = await Promise.all([
    db.from('families').select('name, invite_code, created_by, max_items_per_member').eq('id', familyId.value).single(),
    db.from('family_members').select('user_id, display_name, image_url, role').eq('family_id', familyId.value),
  ])

  let resolvedFamily = family
  let resolvedFamilyErr = familyErr

  // Backward-compatible fallback for environments where the new column is not migrated yet.
  if (resolvedFamilyErr?.message?.includes('max_items_per_member')) {
    const { data: legacyFamily, error: legacyFamilyErr } = await db
      .from('families')
      .select('name, invite_code, created_by')
      .eq('id', familyId.value)
      .single()

    resolvedFamily = legacyFamily
    resolvedFamilyErr = legacyFamilyErr
  }

  if (!resolvedFamilyErr && resolvedFamily) {
    familyName.value = resolvedFamily.name
    familyInviteCode.value = resolvedFamily.invite_code || ''
    familyOwnerId.value = resolvedFamily.created_by || ''
    familyItemLimit.value = Math.min(50, Math.max(1, Number(resolvedFamily.max_items_per_member) || 50))
  }

  if (!membersErr && Array.isArray(members)) {
    familyMembers.value = members
    return
  }

  // Backward-compatible fallback when profile columns are missing.
  const { data: legacyMembers, error: legacyMembersErr } = await db
    .from('family_members')
    .select('user_id')
    .eq('family_id', familyId.value)

  if (!legacyMembersErr && Array.isArray(legacyMembers)) {
    familyMembers.value = legacyMembers.map((m) => ({
      user_id: m.user_id,
      display_name: m.user_id,
      image_url: null,
      role: 'member',
    }))
  }
}

function cleanupRealtimeSubscriptions() {
  realtimeHealthy.value = false
  while (realtimeChannels.length) {
    const channel = realtimeChannels.pop()
    db.removeChannel(channel)
  }
}

async function refreshMembershipOrRedirect() {
  const { data: membership } = await db
    .from('family_members')
    .select('family_id')
    .eq('user_id', userId.value)
    .limit(1)
    .maybeSingle()

  if (!membership?.family_id) {
    cleanupRealtimeSubscriptions()
    router.replace('/family-setup')
    return
  }

  if (membership.family_id !== familyId.value) {
    familyId.value = membership.family_id
    await loadFamilyHeader()
    await loadItems()
    await setupRealtimeSubscriptions()
  }
}

async function setupRealtimeSubscriptions() {
  if (!familyId.value) return

  // Revert Realtime auth to use the dynamic accessToken callback function configured in supabase.js,
  // preventing static token expiration during automatic WebSocket reconnects.
  db.realtime.setAuth()

  channelsRefreshing.value = true
  cleanupRealtimeSubscriptions()

  try {
    const listChannel = db
    .channel(`shopping-list:${familyId.value}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'shopping_list_items',
        filter: `family_id=eq.${familyId.value}`,
      },
      (payload) => {
        console.log('listChannel event received:', payload)
        const newRecord = payload.new

        if (!items.value.some((i) => i.id === newRecord.id)) {
          items.value.push(newRecord)
          items.value.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        }
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'shopping_list_items',
        filter: `family_id=eq.${familyId.value}`,
      },
      (payload) => {
        console.log('listChannel event received:', payload)
        const newRecord = payload.new
        const idx = items.value.findIndex((i) => i.id === newRecord.id)
        if (idx !== -1) {
          items.value[idx] = { ...items.value[idx], ...newRecord }
        } else {
          void loadItems()
        }
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'shopping_list_items',
      },
      (payload) => {
        console.log('listChannel event received:', payload)
        const oldRecord = payload.old
        if (oldRecord?.id) {
          items.value = items.value.filter((i) => i.id !== oldRecord.id)
        } else {
          // Fallback for environments where DELETE payloads are minimal.
          void loadItems()
        }
      },
    )
    .subscribe((status, err) => {
      handleChannelStatus('listChannel', status, err)
    })

    const membersChannel = db
    .channel(`family-members:${familyId.value}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'family_members',
        filter: `family_id=eq.${familyId.value}`,
      },
      (payload) => {
        console.log('membersChannel INSERT received:', payload)
        const newMember = payload.new
        if (newMember && !familyMembers.value.some((m) => m.user_id === newMember.user_id)) {
          familyMembers.value = [
            ...familyMembers.value,
            {
              user_id: newMember.user_id,
              display_name: newMember.display_name || newMember.user_id,
              image_url: newMember.image_url || null,
              role: newMember.role || 'member',
            },
          ]
        }
        // Full refresh to get accurate profile data
        void loadFamilyHeader()
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'family_members',
        filter: `family_id=eq.${familyId.value}`,
      },
      (payload) => {
        console.log('membersChannel DELETE received:', payload)
        const removedUserId = payload.old?.user_id
        if (removedUserId) {
          familyMembers.value = familyMembers.value.filter((m) => m.user_id !== removedUserId)
        }
        void refreshMembershipOrRedirect()
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'family_members',
        filter: `family_id=eq.${familyId.value}`,
      },
      (payload) => {
        console.log('membersChannel UPDATE received:', payload)
        void loadFamilyHeader()
      },
    )
    .subscribe((status, err) => {
      handleChannelStatus('membersChannel', status, err)
    })

    const familyChannel = db
    .channel(`family:${familyId.value}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'families',
        filter: `id=eq.${familyId.value}`,
      },
      (payload) => {
        console.log('familyChannel event received:', payload)
        if (payload.eventType === 'DELETE') {
          cleanupRealtimeSubscriptions()
          router.replace('/family-setup')
          return
        }
        void loadFamilyHeader()
      },
    )
    .subscribe((status, err) => {
      handleChannelStatus('familyChannel', status, err)
    })

    realtimeChannels.push(listChannel, membersChannel, familyChannel)
  } finally {
    channelsRefreshing.value = false
  }
}

async function loadItems() {
  const [uncheckedRes, checkedRes] = await Promise.all([
    db
      .from('shopping_list_items')
      .select('*')
      .eq('family_id', familyId.value)
      .eq('checked', false)
      .order('created_at', { ascending: true }),
    db
      .from('shopping_list_items')
      .select('*')
      .eq('family_id', familyId.value)
      .eq('checked', true)
      .order('created_at', { ascending: false })
      .limit(30)
  ])

  if (uncheckedRes.error) { loadError.value = uncheckedRes.error.message; return }
  if (checkedRes.error) { loadError.value = checkedRes.error.message; return }

  // Merge the two lists (checkedRes.data is sorted descending, but we preserve it in items state)
  // We reverse the checked items so they display in creation order if needed, 
  // or simply keep them as is. Let's sort the merged items to match how they were displayed.
  items.value = [...uncheckedRes.data, ...checkedRes.data]
}

async function addItem() {
  const name = newItem.value.trim()
  if (!name || adding.value) return
  if (name.length > ITEM_NAME_MAX_LENGTH) {
    addError.value = `Item name must be ${ITEM_NAME_MAX_LENGTH} characters or fewer.`
    return
  }
  addError.value = ''

  const quantity = newQty.value

  // If an unchecked item with the same name already exists, bump its quantity
  // instead of adding a duplicate row. Checked (already-bought) items are left
  // alone so re-adding them starts a fresh active item.
  const existing = findActiveItemByName(items.value, name)
  if (existing) {
    newItem.value = ''
    newQty.value = 1
    const previousQty = Number(existing.quantity) || 1
    existing.quantity = previousQty + quantity // optimistic
    const { error } = await db
      .from('shopping_list_items')
      .update({ quantity: existing.quantity })
      .eq('id', existing.id)
    if (error) {
      existing.quantity = previousQty // rollback
      addError.value = error.message ?? 'Could not update that item.'
    }
    return
  }

  // Guard the per-member active-item cap locally so we never flash an optimistic
  // row that the DB trigger would reject. The trigger (migration 010) stays the
  // authoritative backstop for races or stale local state.
  const activeCount = countActiveItemsByMember(items.value, userId.value)
  if (activeCount >= familyItemLimit.value) {
    limitReachedPopupOpen.value = true
    return
  }
  const creatorName = user.value?.fullName
    || user.value?.firstName
    || user.value?.emailAddresses?.[0]?.emailAddress
    || 'Unknown'
  const creatorImageUrl = user.value?.imageUrl || null

  // Optimistic: show the item instantly and clear the form. The per-member cap
  // is enforced authoritatively by the DB trigger (migration 010), so we don't
  // pre-count here — a rejection rolls the row back below.
  //
  // Generate the id client-side and reuse it as the row's primary key so the
  // optimistic row and the real row share the same TransitionGroup key. If the
  // key changed when the insert echoed back, Vue would remount the element and
  // restart the add animation mid-flight.
  const id = crypto.randomUUID()
  items.value.push({
    id,
    family_id: familyId.value,
    name,
    quantity,
    checked: false,
    added_by: userId.value,
    added_by_name: creatorName,
    added_by_image_url: creatorImageUrl,
    created_at: new Date().toISOString(),
  })
  newItem.value = ''
  newQty.value = 1

  const { data, error } = await db
    .from('shopping_list_items')
    .insert({
      id,
      family_id: familyId.value,
      name,
      quantity,
      added_by: userId.value,
      added_by_name: creatorName,
      added_by_image_url: creatorImageUrl,
    })
    .select()
    .single()

  if (error) {
    // Lost a race: the DB already has an unchecked item with this name (our local
    // check missed it). Fold this quantity into that row instead of erroring.
    if (error.code === '23505') {
      await incrementActiveItemByName(name, quantity, id)
      return
    }
    // Roll back the optimistic row and surface the reason.
    items.value = items.value.filter((i) => i.id !== id)
    if (error.message?.includes('member_active_item_limit_exceeded')
      || error.message?.includes('limit of')) {
      limitReachedPopupOpen.value = true
    } else {
      addError.value = error.message ?? 'Failed to add item.'
      newItem.value = name
      newQty.value = quantity
    }
    return
  }

  // Refresh the row with server-authoritative fields. The id is unchanged, so no
  // remount; the realtime INSERT echo dedupes on this same id and is a no-op.
  const index = items.value.findIndex((i) => i.id === id)
  if (index !== -1) items.value[index] = data
}

// Increment the existing active row with this name (used when a concurrent add
// beat us to it). Looks locally first, then fetches to reconcile stale state.
async function incrementActiveItemByName(name, quantity, optimisticId) {
  items.value = items.value.filter((i) => i.id !== optimisticId)

  let target = findActiveItemByName(items.value, name)
  if (!target) {
    const { data } = await db
      .from('shopping_list_items')
      .select('*')
      .eq('family_id', familyId.value)
      .eq('checked', false)
    target = findActiveItemByName(data || [], name)
    if (target && !items.value.some((i) => i.id === target.id)) items.value.push(target)
  }
  if (!target) {
    addError.value = 'Could not add that item.'
    return
  }

  const previousQty = Number(target.quantity) || 1
  target.quantity = previousQty + quantity
  const { error } = await db
    .from('shopping_list_items')
    .update({ quantity: target.quantity })
    .eq('id', target.id)
  if (error) {
    target.quantity = previousQty
    addError.value = error.message ?? 'Could not update that item.'
  }
}

function closeLimitReachedPopup() {
  limitReachedPopupOpen.value = false
}

async function toggleItem(item) {
  const previous = item.checked
  const nextChecked = !previous

  // Unchecking: if another unchecked item with the same name already exists,
  // fold this one into it instead of leaving two active rows — same merge rule
  // as adding.
  if (!nextChecked) {
    const target = findActiveItemByName(items.value, item.name, { excludeId: item.id })
    if (target) {
      await mergeItemInto(item, target)
      return
    }
  }

  // Optimistic: flip immediately, roll back if the write fails.
  item.checked = nextChecked

  const { error } = await db
    .from('shopping_list_items')
    .update({ checked: nextChecked })
    .eq('id', item.id)

  if (error) {
    item.checked = previous
    // Unique-violation while unchecking: an active same-name row appeared (race).
    // Merge into it rather than surfacing an error.
    if (!nextChecked && error.code === '23505') {
      let target = findActiveItemByName(items.value, item.name, { excludeId: item.id })
      if (!target) {
        const { data } = await db
          .from('shopping_list_items')
          .select('*')
          .eq('family_id', familyId.value)
          .eq('checked', false)
        target = findActiveItemByName(data || [], item.name, { excludeId: item.id })
        if (target && !items.value.some((i) => i.id === target.id)) items.value.push(target)
      }
      if (target) {
        await mergeItemInto(item, target)
        return
      }
    }
    loadError.value = error.message ?? 'Could not update that item.'
  }
}

// Fold `source`'s quantity into `target` (same-name unchecked row) and remove
// `source`. Optimistic, with rollback if either write fails.
async function mergeItemInto(source, target) {
  const sourceIndex = items.value.findIndex((i) => i.id === source.id)
  const previousTargetQty = Number(target.quantity) || 1
  const addedQty = Number(source.quantity) || 1

  target.quantity = previousTargetQty + addedQty
  const removedSource = sourceIndex !== -1 ? items.value.splice(sourceIndex, 1)[0] : source

  const rollback = (message) => {
    target.quantity = previousTargetQty
    if (sourceIndex !== -1) items.value.splice(sourceIndex, 0, removedSource)
    loadError.value = message
  }

  const { error: updateErr } = await db
    .from('shopping_list_items')
    .update({ quantity: target.quantity })
    .eq('id', target.id)
  if (updateErr) {
    rollback(updateErr.message ?? 'Could not merge those items.')
    return
  }

  const { error: deleteErr } = await db
    .from('shopping_list_items')
    .delete()
    .eq('id', source.id)
  if (deleteErr) {
    // Undo the quantity bump we already committed, then restore the row.
    await db.from('shopping_list_items').update({ quantity: previousTargetQty }).eq('id', target.id)
    rollback(deleteErr.message ?? 'Could not merge those items.')
  }
}

async function deleteItem(item) {
  // Optimistic: remove immediately, restore at its original position on failure.
  const index = items.value.findIndex((i) => i.id === item.id)
  if (index === -1) return
  const [removed] = items.value.splice(index, 1)

  const { error } = await db
    .from('shopping_list_items')
    .delete()
    .eq('id', item.id)

  if (error) {
    items.value.splice(index, 0, removed)
    loadError.value = error.message ?? 'Could not delete that item.'
  }
}
</script>

<template>
  <div class="dashboard">
    <AppTopbar
      :family-id="familyId || ''"
      :family-name="familyName"
      :loading="initialLoading"
      :invite-code="familyInviteCode"
      :family-item-limit="familyItemLimit"
      :owner-user-id="familyOwnerId"
      :member-profiles="familyMembers"
      @refresh-family="loadFamilyHeader"
    />

    <main class="dashboard-main">
      <div class="dashboard-content">

        <ErrorMessage :message="loadError" />

        <!-- Add item form -->
        <form class="add-form" @submit.prevent="addItem">
          <div class="add-row">
            <div class="qty-picker" aria-label="Item quantity">
              <div class="qty-value-wrap" aria-live="polite">
                <Transition :name="qtyDirection === 'up' ? 'qty-slide-up' : 'qty-slide-down'" mode="out-in">
                  <span :key="newQty" class="qty-value">{{ newQty }}</span>
                </Transition>
              </div>
              <div class="qty-buttons">
              <button
                type="button"
                class="qty-btn"
                @click="increaseQty"
                :disabled="newQty >= 99 || adding"
                aria-label="Increase quantity"
              >
                <span class="qty-icon qty-icon--plus"></span>
              </button>
              <button
                type="button"
                class="qty-btn"
                @click="decreaseQty"
                :disabled="newQty <= 1 || adding"
                aria-label="Decrease quantity"
              >
                <span class="qty-icon qty-icon--minus"></span>
              </button>
              </div>
            </div>
            <input
              v-model="newItem"
              type="text"
              placeholder="Add an item…"
              maxlength="120"
              autocomplete="off"
            />
            <button type="submit" class="add-btn" :disabled="adding || !newItem.trim()" aria-label="Add">
              <span v-if="adding" class="spinner"></span>
              <span v-else class="add-icon"></span>
            </button>
          </div>
          <ErrorMessage :message="addError" />
        </form>

        <div class="list-meta" v-if="items.length">
          {{ leftCount }} left
        </div>

        <!-- Skeleton rows while the first fetch is in flight -->
        <ul v-if="initialLoading" class="item-list" aria-hidden="true">
          <li v-for="(nameWidth, idx) in skeletonNameWidths" :key="idx" class="skeleton-item">
            <SkeletonBlock width="24px" height="24px" radius="50%" />
            <SkeletonBlock width="2.05rem" height="2.05rem" radius="0.65rem" />
            <SkeletonBlock class="skeleton-item__name" :width="nameWidth" height="0.95rem" />
            <SkeletonBlock width="var(--size-avatar-sm)" height="var(--size-avatar-sm)" radius="var(--radius-pill)" />
          </li>
        </ul>

        <!-- List -->
        <TransitionGroup tag="ul" name="unchecked" class="item-list">
          <ShoppingListItem
            v-for="item in uncheckedItems"
            :key="item.id"
            :item="item"
            @toggle="toggleItem"
            @delete="deleteItem"
          />
        </TransitionGroup>

        <Transition name="section-fade">
          <p v-if="checkedItems.length" class="section-label">Checked</p>
        </Transition>

        <TransitionGroup tag="ul" name="checked" class="item-list" :class="{ 'item-list--checked': checkedItems.length }">
          <ShoppingListItem
            v-for="item in checkedItems"
            :key="item.id"
            :item="item"
            @toggle="toggleItem"
            @delete="deleteItem"
          />
        </TransitionGroup>

        <p v-if="hasInitialized && !items.length && !loadError" class="empty-state">
          Nothing here yet — add your first item above!
        </p>

      </div>
    </main>

    <ConfirmModal
      :open="limitReachedPopupOpen"
      title="Limit reached"
      :message="`You reached your limit of ${familyItemLimit} active items. Check or delete items before adding more.`"
      confirm-text="Got it"
      :show-cancel="false"
      @confirm="closeLimitReachedPopup"
      @cancel="closeLimitReachedPopup"
    />
  </div>
</template>

<style scoped>
.dashboard {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--color-primary-bg);
}

/* Mirrors ShoppingListItem's .item card so rows swap in without layout shift */
.skeleton-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: var(--bg-surface);
  border-radius: var(--radius-xl);
  padding: 0.875rem 0.875rem 0.875rem 0.75rem;
  border: 1.5px solid var(--border-main);
}

.skeleton-item__name {
  margin-right: auto;
}

.dashboard-main {
  flex: 1;
  display: flex;
  justify-content: center;
  padding: 2rem 1rem;
  padding-top: calc(72px + 2rem);
}

.dashboard-content {
  width: 100%;
  max-width: 480px;
}

/* Meta */
.list-meta {
  text-align: right;
  margin-top: 0.15rem;
  margin-bottom: 0.9rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-disabled);
}

/* Add form */
.add-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1.25rem;
}

.add-row {
  display: flex;
  align-items: center;
  background: var(--bg-surface);
  border: 1.5px solid var(--border-main);
  border-radius: var(--radius-2xl);
  overflow: hidden;
  transition: border-color 0.15s;
}

.add-row:focus-within {
  border-color: var(--color-primary);
}

.add-row input {
  flex: 1;
  padding: 0.85rem 1rem;
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: 0.95rem;
  color: var(--text-primary);
  outline: none;
  min-width: 0;
}

.add-row input::placeholder {
  color: var(--text-disabled);
}

.qty-picker {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  border-right: 1px solid var(--border-main);
  padding: 0.2rem 0.5rem;
  margin-right: 0.2rem;
}

.qty-buttons {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
}

.qty-btn {
  width: 24px;
  height: 24px;
  border: 1px solid var(--border-main);
  background: var(--bg-surface);
  color: var(--text-secondary);
  border-radius: var(--radius-xs);
  cursor: pointer;
  line-height: 1;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.qty-icon {
  width: var(--size-icon-sm);
  height: var(--size-icon-sm);
  background-color: var(--text-secondary);
}

.qty-icon--plus {
  mask: url('../assets/plus.svg') no-repeat center / contain;
  -webkit-mask: url('../assets/plus.svg') no-repeat center / contain;
}

.qty-icon--minus {
  mask: url('../assets/minus.svg') no-repeat center / contain;
  -webkit-mask: url('../assets/minus.svg') no-repeat center / contain;
}

.qty-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.qty-value-wrap {
  min-width: 1.8rem;
  height: 1.1rem;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.qty-value {
  min-width: 1.6rem;
  text-align: center;
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--text-primary);
}

.qty-slide-up-enter-active,
.qty-slide-up-leave-active,
.qty-slide-down-enter-active,
.qty-slide-down-leave-active {
  transition: transform 0.11s ease, opacity 0.11s ease;
}

.qty-slide-up-enter-from {
  transform: translateY(10px);
  opacity: 0;
}

.qty-slide-up-leave-to {
  transform: translateY(-10px);
  opacity: 0;
}

.qty-slide-down-enter-from {
  transform: translateY(-10px);
  opacity: 0;
}

.qty-slide-down-leave-to {
  transform: translateY(10px);
  opacity: 0;
}

.add-btn {
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  margin: 4px;
  margin-right: 8px;
  background: var(--color-primary);
  color: var(--text-inverse);
  border: none;
  border-radius: var(--radius-lg);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.15s;
  padding: 0;
}

.add-icon {
  width: var(--size-icon-lg);
  height: var(--size-icon-lg);
  background-color: var(--text-inverse);
  mask: url('../assets/add.svg') no-repeat center / contain;
  -webkit-mask: url('../assets/add.svg') no-repeat center / contain;
}

.add-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* List */
.item-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  position: relative;
}

.item-list--checked {
  margin-top: 0.4rem;
}

.unchecked-move,
.checked-move {
  transition: transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}

.unchecked-enter-active,
.checked-enter-active {
  transition: opacity 0.32s ease, transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
}

.unchecked-leave-active,
.checked-leave-active {
  transition: opacity 0.24s ease, transform 0.24s ease;
  position: absolute;
  width: 100%;
  pointer-events: none;
  z-index: 2;
}

.unchecked-enter-from {
  opacity: 0;
  transform: translateY(-8px) scale(0.995);
}

.unchecked-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.995);
}

.checked-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(0.995);
}

.checked-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.995);
}

.section-fade-enter-active,
.section-fade-leave-active {
  transition: opacity 0.18s ease;
}

.section-fade-enter-from,
.section-fade-leave-to {
  opacity: 0;
}

.section-label {
  margin: 1rem 0 0.45rem;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-disabled);
}

/* Empty state */
.empty-state {
  text-align: center;
  font-size: 0.875rem;
  color: var(--text-disabled);
  margin: 2.5rem 0;
  line-height: 1.5;
}

/* Spinner */
.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--spinner-stroke);
  border-top-color: var(--text-inverse);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>

