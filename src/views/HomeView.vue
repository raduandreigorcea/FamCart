<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useAuth, useUser } from '@clerk/vue'
import { useRouter } from 'vue-router'
import { useSupabase } from '../supabase.js'
import AppTopbar from '../components/AppTopbar.vue'
import ConfirmModal from '../components/ConfirmModal.vue'
import ErrorMessage from '../components/ErrorMessage.vue'
import ShoppingList from '../components/ShoppingList.vue'
import AddItemForm from '../components/AddItemForm.vue'
import { useFamilyRealtime } from '../lib/familyRealtime'
import {
  findActiveItemByName,
  countActiveItemsByMember,
} from '../lib/shoppingList'
import { getUserDisplayName, getUserPrimaryEmail } from '../lib/userIdentity'
import { cleanAuthCallbackUrl } from '../lib/authCallbackUrl'

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
const loadError = ref('')
const addError = ref('')
const limitReachedPopupOpen = ref(false)
const adding = ref(false)
const hasInitialized = ref(false)
const ITEM_NAME_MAX_LENGTH = 120

// Realtime sync (channels, reconnects, watchdog) lives in the composable; it
// registers its own lifecycle listeners and calls back into the loaders below.
const { setupRealtimeSubscriptions, cleanupRealtimeSubscriptions } = useFamilyRealtime({
  db,
  familyId,
  hasInitialized,
  items,
  familyMembers,
  loadItems,
  loadFamilyHeader,
  refreshMembershipOrRedirect,
  onFamilyDeleted: () => router.replace('/family-setup'),
})

// Initial load: nothing fetched yet and no error to show instead. Items arriving
// (realtime or fetch) end the skeleton early even before hasInitialized flips.
const initialLoading = computed(() => !hasInitialized.value && !items.value.length && !loadError.value)

onMounted(() => {
  void initializeHome()
})

watch([isLoaded, userId], () => {
  void initializeHome()
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
  const cleanedUrl = cleanAuthCallbackUrl(window.location.href)
  if (cleanedUrl) window.history.replaceState({}, '', cleanedUrl)
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
  const creatorName = getUserDisplayName(user.value) || getUserPrimaryEmail(user.value) || 'Unknown'
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
        <AddItemForm
          v-model:name="newItem"
          v-model:quantity="newQty"
          :adding="adding"
          :error="addError"
          :max-length="ITEM_NAME_MAX_LENGTH"
          @submit="addItem"
        />

        <ShoppingList
          :items="items"
          :loading="initialLoading"
          :show-empty="hasInitialized && !items.length && !loadError"
          @toggle="toggleItem"
          @delete="deleteItem"
        />

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
</style>

