<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { useAuth, useUser } from '@clerk/vue'
import { useRouter } from 'vue-router'
import { useSupabase } from '../supabase.js'
import AppTopbar from '../components/AppTopbar.vue'
import ErrorMessage from '../components/ErrorMessage.vue'

const { userId, isLoaded, getToken } = useAuth()
const { user } = useUser()
const router = useRouter()
const db = useSupabase()

const items = ref([])
const familyId = ref(null)
const familyName = ref('')
const familyInviteCode = ref('')
const familyOwnerId = ref('')
const familyMembers = ref([])
const newItem = ref('')
const newQty = ref(1)
const qtyDirection = ref('up')
const loadError = ref('')
const addError = ref('')
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
    db.from('families').select('name, invite_code, created_by').eq('id', familyId.value).single(),
    db.from('family_members').select('user_id, display_name, image_url').eq('family_id', familyId.value),
  ])

  if (!familyErr && family) {
    familyName.value = family.name
    familyInviteCode.value = family.invite_code || ''
    familyOwnerId.value = family.created_by || ''
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
        event: '*',
        schema: 'public',
        table: 'shopping_list_items',
        filter: `family_id=eq.${familyId.value}`,
      },
      (payload) => {
        console.log('listChannel event received:', payload)
        const { eventType, new: newRecord, old: oldRecord } = payload

        if (eventType === 'INSERT') {
          if (!items.value.some((i) => i.id === newRecord.id)) {
            items.value.push(newRecord)
            items.value.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
          }
        } else if (eventType === 'UPDATE') {
          const idx = items.value.findIndex((i) => i.id === newRecord.id)
          if (idx !== -1) {
            items.value[idx] = { ...items.value[idx], ...newRecord }
          }
        } else if (eventType === 'DELETE') {
          items.value = items.value.filter((i) => i.id !== oldRecord.id)
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
                +
              </button>
              <button
                type="button"
                class="qty-btn"
                @click="decreaseQty"
                :disabled="newQty <= 1 || adding"
                aria-label="Decrease quantity"
              >
                -
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
              <svg v-else viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2"
                  stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          </div>
          <ErrorMessage :message="addError" />
        </form>

        <div class="list-meta" v-if="items.length">
          {{ leftCount }} left
        </div>

        <!-- List -->
        <ul v-if="uncheckedItems.length" class="item-list">
          <li
            v-for="item in uncheckedItems"
            :key="item.id"
            class="item"
            :class="{ 'item--checked': item.checked }"
          >
            <button class="item-check" @click="toggleItem(item)" :aria-label="item.checked ? 'Uncheck' : 'Check'">
              <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="10" cy="10" r="8.25" stroke="currentColor" stroke-width="1.5"/>
                <path v-if="item.checked" d="M6.5 10.5l2.5 2.5 4.5-5" stroke="currentColor" stroke-width="1.75"
                  stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <img
              v-if="item.added_by_image_url"
              :src="item.added_by_image_url"
              :alt="(item.added_by_name || 'Member') + ' avatar'"
              class="item-avatar"
            />
            <span v-else class="item-avatar item-avatar--fallback" :title="item.added_by_name || 'Member'">
              {{ (item.added_by_name || '?').slice(0, 1).toUpperCase() }}
            </span>
            <span v-if="item.quantity > 1" class="item-qty">x{{ item.quantity }}</span>
            <span class="item-name">{{ item.name }}</span>
            <button class="item-delete" @click="deleteItem(item)" aria-label="Delete">
              <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" stroke-width="1.5"
                  stroke-linecap="round"/>
              </svg>
            </button>
          </li>
        </ul>

        <p v-if="checkedItems.length" class="section-label">Checked</p>

        <ul v-if="checkedItems.length" class="item-list item-list--checked">
          <li
            v-for="item in checkedItems"
            :key="item.id"
            class="item item--checked"
          >
            <button class="item-check" @click="toggleItem(item)" :aria-label="item.checked ? 'Uncheck' : 'Check'">
              <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="10" cy="10" r="8.25" stroke="currentColor" stroke-width="1.5"/>
                <path v-if="item.checked" d="M6.5 10.5l2.5 2.5 4.5-5" stroke="currentColor" stroke-width="1.75"
                  stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <img
              v-if="item.added_by_image_url"
              :src="item.added_by_image_url"
              :alt="(item.added_by_name || 'Member') + ' avatar'"
              class="item-avatar"
            />
            <span v-else class="item-avatar item-avatar--fallback" :title="item.added_by_name || 'Member'">
              {{ (item.added_by_name || '?').slice(0, 1).toUpperCase() }}
            </span>
            <span v-if="item.quantity > 1" class="item-qty">x{{ item.quantity }}</span>
            <span class="item-name">{{ item.name }}</span>
            <button class="item-delete" @click="deleteItem(item)" aria-label="Delete">
              <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" stroke-width="1.5"
                  stroke-linecap="round"/>
              </svg>
            </button>
          </li>
        </ul>

        <p v-if="!items.length && !loadError" class="empty-state">
          Nothing here yet — add your first item above!
        </p>

      </div>
    </main>
  </div>
</template>

<style scoped>
.dashboard {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: #f0f4f1;
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
  color: #9ca3af;
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
  background: #fff;
  border: 1.5px solid #e4e4e4;
  border-radius: 16px;
  overflow: hidden;
  transition: border-color 0.15s;
}

.add-row:focus-within {
  border-color: var(--green);
}

.add-row input {
  flex: 1;
  padding: 0.85rem 1rem;
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: 0.95rem;
  color: #1a1a1a;
  outline: none;
  min-width: 0;
}

.add-row input::placeholder {
  color: #b0b8b0;
}

.qty-picker {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  border-right: 1px solid #ececec;
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
  border: 1px solid #e4e4e4;
  background: #fff;
  color: #6b7280;
  border-radius: 6px;
  cursor: pointer;
  line-height: 1;
  padding: 0;
  font-size: 0.95rem;
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
  color: #374151;
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
  background: var(--green);
  color: #fff;
  border: none;
  border-radius: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.15s;
  padding: 0;
}

.add-btn svg {
  width: 18px;
  height: 18px;
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
}

.item-list--checked {
  margin-top: 0.4rem;
}

.section-label {
  margin: 1rem 0 0.45rem;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #9ca3af;
}

.item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: #fff;
  border-radius: 14px;
  padding: 0.875rem 0.875rem 0.875rem 0.75rem;
  border: 1.5px solid #ebebeb;
  transition: opacity 0.2s;
}

.item--checked {
  opacity: 0.5;
}

.item--checked .item-name {
  text-decoration: line-through;
  color: #9ca3af;
}

.item-check {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: #d1d5db;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s;
}

.item--checked .item-check {
  color: var(--green);
}

.item-check:hover {
  color: var(--green);
}

.item-check svg {
  width: 22px;
  height: 22px;
}

.item-avatar {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid #e5e7eb;
}

.item-avatar--fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #f3f4f6;
  color: #6b7280;
  font-size: 0.8rem;
  font-weight: 700;
}

.item-name {
  flex: 1;
  font-size: 0.95rem;
  color: #1a1a1a;
  line-height: 1.4;
  word-break: break-word;
}

.item-qty {
  flex-shrink: 0;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--green);
  background: color-mix(in srgb, var(--green) 10%, white);
  border: 1px solid color-mix(in srgb, var(--green) 28%, white);
  border-radius: 999px;
  padding: 0.15rem 0.45rem;
}

.item-delete {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: #d1d5db;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s;
  border-radius: 6px;
}

.item-delete:hover {
  color: #ef4444;
}

.item-delete svg {
  width: 16px;
  height: 16px;
}

/* Empty state */
.empty-state {
  text-align: center;
  font-size: 0.875rem;
  color: #9ca3af;
  margin: 2.5rem 0;
  line-height: 1.5;
}

/* Spinner */
.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>

