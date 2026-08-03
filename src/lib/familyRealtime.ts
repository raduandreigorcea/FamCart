import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { sortItemsForDisplay, type ShoppingItem } from './shoppingList'
import { captureException } from './errorReporting'
import { isCurrentlyOffline, onReconnect } from './connectivity'

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
  // True while the given item id has a local write in flight; its realtime echo
  // must not be overwritten by an unrelated concurrent update.
  hasPendingWrite?: (id: string) => boolean
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
  hasPendingWrite,
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
      if (!isCurrentlyOffline()) {
        void loadItems()
        void loadFamilyHeader()
        scheduleRealtimeReconnect('focus/online', 0)
      }
    } else {
      // Backgrounded: drop the socket rather than hold a connection nobody is
      // looking at. handleVisibilityOrOnline reconnects on the way back.
      if (db && db.realtime) {
        db.realtime.disconnect()
      }
      realtimeHealthy.value = false
    }
  }

  // Every reconnect path is gated on this, so the connectivity signal it reads
  // decides whether realtime can recover at all. It used to be navigator.onLine,
  // which lib/connectivity exists precisely because of: inside the Android
  // WebView that flag is unreliable and its online/offline events can fail to
  // fire. A WebView wrongly reporting offline therefore pinned this to false and
  // took the watchdog and the user-activity handler down with it — leaving the
  // socket dead on the one platform the Capacitor status was added to serve.
  function shouldKeepRealtimeActive() {
    return hasInitialized.value
      && !!familyId.value
      && document.visibilityState === 'visible'
      && !isCurrentlyOffline()
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
      db.realtime.setAuth()
      db.realtime.connect()
      await setupRealtimeSubscriptions()
      await Promise.all([loadItems(), loadFamilyHeader()])
    } catch (error) {
      // A reconnect that throws is a real fault, unlike the ordinary CLOSED /
      // TIMED_OUT statuses the watchdog already handles by retrying. `reason`
      // is what the removed console.log carried and the one thing that makes
      // these reports separable — a focus reconnect failing is a different
      // problem from the watchdog never getting back on.
      captureException(
        error instanceof Error
          ? Object.assign(error, { famcartReconnectReason: reason })
          : new Error(`Realtime reconnect failed (${reason}): ${String(error)}`),
      )
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

  function handleChannelStatus(channelName: string, status: string) {
    if (status === 'SUBSCRIBED') {
      realtimeHealthy.value = true
      // A channel that has just (re)subscribed may have missed changes while it
      // was down, so each one pulls back whatever it is responsible for.
      if (hasInitialized.value) {
        if (channelName === 'listChannel') void loadItems()
        if (channelName === 'membersChannel' || channelName === 'familyChannel') {
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
            const newRecord = payload.new as ShoppingItemRow
            // A row mid local write owns its state until that write's own echo
            // lands; a concurrent update must not revert the optimistic value.
            if (hasPendingWrite?.(newRecord.id)) return
            const idx = items.value.findIndex((i) => i.id === newRecord.id)
            if (idx !== -1) {
              items.value[idx] = { ...items.value[idx], ...newRecord }
              // Re-assert the canonical order after the merge. A remote tick
              // does not move the row (order is creation time), but the merged
              // record is the authority on created_at.
              items.value = sortItemsForDisplay(items.value)
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
            // Scoped like the INSERT and UPDATE handlers above. This is what
            // 007_realtime.sql set `replica identity full` for — without the full
            // old row a DELETE payload carries only the primary key and the
            // filter cannot match. The members channel below already did this;
            // this one was left unscoped, so a user in several families
            // received every family's item deletions here and discarded them
            // client-side.
            filter: `family_id=eq.${familyId.value}`,
          },
          (payload) => {
            const oldRecord = payload.old as Partial<ShoppingItemRow>
            if (oldRecord?.id) {
              items.value = items.value.filter((i) => i.id !== oldRecord.id)
            } else {
              // Fallback for environments where DELETE payloads are minimal.
              void loadItems()
            }
          },
        )
        .subscribe((status) => {
          handleChannelStatus('listChannel', status)
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
          () => {
            // Refetch rather than patch. The payload is a family_members row,
            // which since the profiles split (003_families_and_members.sql) carries no name or
            // avatar — it could only ever seed a placeholder that the refetch
            // below immediately overwrote a moment later.
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
          () => {
            void loadFamilyHeader()
          },
        )
        .subscribe((status) => {
          handleChannelStatus('membersChannel', status)
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
            if (payload.eventType === 'DELETE') {
              cleanupRealtimeSubscriptions()
              onFamilyDeleted()
              return
            }
            void loadFamilyHeader()
          },
        )
        .subscribe((status) => {
          handleChannelStatus('familyChannel', status)
        })

      realtimeChannels.push(listChannel, membersChannel, familyChannel)
    } finally {
      channelsRefreshing.value = false
    }
  }

  // Unregisters the connectivity subscription below.
  let stopReconnect: (() => void) | null = null

  onMounted(() => {
    window.addEventListener('visibilitychange', handleVisibilityOrOnline)
    // Not window's 'online' event: in a WebView it can simply never fire, which
    // left this the dead half of the recovery path. lib/connectivity fires its
    // handlers off the Capacitor status (with the window events as its own web
    // fallback), so subscribing here covers both platforms through one signal.
    stopReconnect = onReconnect(handleVisibilityOrOnline)
    window.addEventListener('pointerdown', handleUserActivity)
    window.addEventListener('keydown', handleUserActivity)
    window.addEventListener('touchstart', handleUserActivity, { passive: true })
    setupFallbackRefresh()
  })

  onBeforeUnmount(() => {
    cleanupRealtimeSubscriptions()
    cleanupReconnectResources()
    window.removeEventListener('visibilitychange', handleVisibilityOrOnline)
    if (stopReconnect) {
      stopReconnect()
      stopReconnect = null
    }
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
