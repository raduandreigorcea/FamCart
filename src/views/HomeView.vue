<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { useAuth, useUser } from '@clerk/vue'
import { useRouter } from 'vue-router'
import { useSupabase } from '../supabase.js'
import AppTopbar from '../components/AppTopbar.vue'
import ConfirmModal from '../components/ConfirmModal.vue'
import ErrorMessage from '../components/ErrorMessage.vue'
import ShoppingListItem from '../components/ShoppingListItem.vue'

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

const uncheckedItems = computed(() => items.value.filter((i) => !i.checked))
const checkedItems = computed(() => items.value.filter((i) => i.checked))
const leftCount = computed(() => uncheckedItems.value.length)

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
      if (db && db.realtime) {
        db.realtime.connect()
      }
    }
  } else {
    console.log('App backgrounded/unfocused: disconnecting WebSocket to save connection resources...')
    if (db && db.realtime) {
      db.realtime.disconnect()
    }
  }
}

onMounted(() => {
  void initializeHome()
  window.addEventListener('visibilitychange', handleVisibilityOrOnline)
  window.addEventListener('online', handleVisibilityOrOnline)
})

watch([isLoaded, userId], () => {
  void initializeHome()
})

onBeforeUnmount(() => {
  cleanupRealtimeSubscriptions()
  window.removeEventListener('visibilitychange', handleVisibilityOrOnline)
  window.removeEventListener('online', handleVisibilityOrOnline)
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

  cleanupRealtimeSubscriptions()

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
      console.log(`listChannel subscription status: ${status}`, err || '')
      if (status === 'SUBSCRIBED' && hasInitialized.value) {
        console.log('listChannel reconnected: fetching active items')
        void loadItems()
      }
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
      console.log(`membersChannel subscription status: ${status}`, err || '')
      if (status === 'SUBSCRIBED' && hasInitialized.value) {
        console.log('membersChannel reconnected: fetching members')
        void loadFamilyHeader()
      }
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
      console.log(`familyChannel subscription status: ${status}`, err || '')
      if (status === 'SUBSCRIBED' && hasInitialized.value) {
        console.log('familyChannel reconnected: fetching family header')
        void loadFamilyHeader()
      }
    })

  realtimeChannels.push(listChannel, membersChannel, familyChannel)
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
  addError.value = ''
  adding.value = true
  try {
    const { count: currentUserActiveItemCount, error: countError } = await db
      .from('shopping_list_items')
      .select('id', { count: 'exact', head: true })
      .eq('family_id', familyId.value)
      .eq('added_by', userId.value)
      .eq('checked', false)

    if (countError) throw countError

    if ((currentUserActiveItemCount || 0) >= familyItemLimit.value) {
      limitReachedPopupOpen.value = true
      return
    }

    const creatorName = user.value?.fullName
      || user.value?.firstName
      || user.value?.emailAddresses?.[0]?.emailAddress
      || 'Unknown'
    const creatorImageUrl = user.value?.imageUrl || null

    const { data, error } = await db
      .from('shopping_list_items')
      .insert({
        family_id: familyId.value,
        name,
        quantity: newQty.value,
        added_by: userId.value,
        added_by_name: creatorName,
        added_by_image_url: creatorImageUrl,
      })
      .select()
      .single()

    if (error) throw error
    items.value.push(data)
    newItem.value = ''
    newQty.value = 1
  } catch (e) {
    addError.value = e.message ?? 'Failed to add item.'
  } finally {
    adding.value = false
  }
}

function closeLimitReachedPopup() {
  limitReachedPopupOpen.value = false
}

async function toggleItem(item) {
  const { error } = await db
    .from('shopping_list_items')
    .update({ checked: !item.checked })
    .eq('id', item.id)

  if (!error) item.checked = !item.checked
}

async function deleteItem(item) {
  const { error } = await db
    .from('shopping_list_items')
    .delete()
    .eq('id', item.id)

  if (!error) items.value = items.value.filter(i => i.id !== item.id)
}
</script>

<template>
  <div class="dashboard">
    <AppTopbar
      :family-id="familyId || ''"
      :family-name="familyName"
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

        <p v-if="!items.length && !loadError" class="empty-state">
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
  color: var(--bg-surface);
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
  background-color: var(--bg-surface);
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
  border-top-color: var(--bg-surface);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>

