import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { sortItemsForDisplay, type ShoppingItem } from './shoppingList'

// A shopping_list_items row as held in view state: the pure-helper shape plus
// the DB columns the realtime handlers touch.
export interface ShoppingItemRow extends ShoppingItem {
  created_at: string
  [key: string]: unknown
}

export interface FamilyMemberProfile {
  user_id: string
  display_name?: string | null
  image_url?: string | null
  role?: string | null
}

export interface UseFamilyRealtimeOptions {
  db: SupabaseClient
  familyId: Ref<string | null>
  hasInitialized: Ref<boolean>
  items: Ref<ShoppingItemRow[]>
  familyMembers: Ref<FamilyMemberProfile[]>
  loadItems: () => Promise<void>
  loadFamilyHeader: () => Promise<void>
  refreshMembershipOrRedirect: () => Promise<void>
  onFamilyDeleted: () => void
}

// Owns the realtime lifecycle for the family dashboard: the three Postgres
// change channels (items, members, family), reconnect scheduling with
// throttling, the visibility/online/user-activity wake-ups, and the watchdog
// interval that reconciles state whenever the socket is down.
//
// The caller keeps ownership of the data (items/familyMembers refs and the
// load/refresh callbacks); this composable decides when to call them.
export function useFamilyRealtime({
  db,
  familyId,
  hasInitialized,
  items,
  familyMembers,
  loadItems,
  loadFamilyHeader,
  refreshMembershipOrRedirect,
  onFamilyDeleted,
}: UseFamilyRealtimeOptions) {
  const realtimeHealthy = ref(false)
  const reconnectInProgress = ref(false)
  const channelsRefreshing = ref(false)
  const realtimeChannels: RealtimeChannel[] = []
  let reconnectTimeoutId: number | null = null
  let fallbackRefreshIntervalId: number | null = null
  let lastReconnectAttemptAt = 0

  const RECONNECT_THROTTLE_MS = 1500
  const RECONNECT_RETRY_MS = 2500
  const FALLBACK_REFRESH_MS = 30000

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

  async function reconnectRealtime(reason: string) {
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

  function scheduleRealtimeReconnect(reason: string, delayMs = RECONNECT_THROTTLE_MS) {
    if (!shouldKeepRealtimeActive()) return
    if (reconnectTimeoutId || reconnectInProgress.value) return

    reconnectTimeoutId = window.setTimeout(() => {
      reconnectTimeoutId = null
      void reconnectRealtime(reason)
    }, delayMs)
  }

  function handleChannelStatus(channelName: string, status: string, err?: Error) {
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

  function cleanupRealtimeSubscriptions() {
    realtimeHealthy.value = false
    while (realtimeChannels.length) {
      const channel = realtimeChannels.pop()
      if (channel) db.removeChannel(channel)
    }
  }

  async function setupRealtimeSubscriptions() {
    if (!familyId.value) return

    // Revert Realtime auth to use the dynamic accessToken callback function configured in supabase.ts,
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
            const newRecord = payload.new as ShoppingItemRow

            if (!items.value.some((i) => i.id === newRecord.id)) {
              // Same canonical order as loadItems, so the echo of an insert
              // lands exactly where the next refetch would put it.
              items.value = sortItemsForDisplay([...items.value, newRecord])
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
            const newRecord = payload.new as ShoppingItemRow
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
            const oldRecord = payload.old as Partial<ShoppingItemRow>
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
            const newMember = payload.new as FamilyMemberProfile | null
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
            const removedUserId = (payload.old as Partial<FamilyMemberProfile>)?.user_id
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
              onFamilyDeleted()
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

  onMounted(() => {
    window.addEventListener('visibilitychange', handleVisibilityOrOnline)
    window.addEventListener('online', handleVisibilityOrOnline)
    window.addEventListener('pointerdown', handleUserActivity)
    window.addEventListener('keydown', handleUserActivity)
    window.addEventListener('touchstart', handleUserActivity, { passive: true })
    setupFallbackRefresh()
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

  return {
    realtimeHealthy,
    setupRealtimeSubscriptions,
    cleanupRealtimeSubscriptions,
  }
}
