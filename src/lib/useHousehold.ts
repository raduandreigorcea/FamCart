import { computed, ref, type Ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { HouseholdMemberProfile } from './householdRealtime'
import { captureException } from './errorReporting'
import { clampItemLimit, ITEM_LIMIT_DEFAULT } from './limits'
import { isOfflineError } from './offlineQueue'

// The household the dashboard is showing, and every household the user is in:
// the state, and the two reads that fill it. Moved out of HomeView, which keeps
// what ties this to the rest (switching, reconciling after a removal), because
// those also drive the list, realtime and the suggestions.

// Every household the user belongs to; the account dialog lists them to switch.
export interface HouseholdRow { id: string; name: string; emoji?: string | null }

// PostgREST types an embedded to-one relation as an array, but these selects
// each return a single joined row; the casts at the two call sites say so once.
interface MemberRow {
  user_id: string
  role?: string | null
  profiles?: { display_name?: string | null; image_url?: string | null } | null
}
interface MembershipRow {
  household_id: string
  households?: { name?: string | null; emoji?: string | null } | null
}

export function useHousehold(options: {
  db: SupabaseClient
  /** The Clerk id; memberships are read for this user only. */
  userId: Ref<string | null | undefined>
}) {
  const { db, userId } = options

  // Every household the user belongs to ({ id, name }), listed in the account
  // dialog. householdId below is whichever one is currently active.
  const households = ref<HouseholdRow[]>([])
  const householdId = ref<string | null>(null)
  const householdName = ref('')
  const householdInviteCode = ref('')
  const householdOwnerId = ref('')
  const householdItemLimit = ref(ITEM_LIMIT_DEFAULT)
  const householdEmoji = ref('')
  const householdMembers = ref<HouseholdMemberProfile[]>([])
  // Roster keyed by user id, so a list row can resolve its author's live avatar
  // from added_by (the row no longer carries a copied name/photo).
  const memberProfileMap = computed(
    () => new Map(householdMembers.value.map((m) => [m.user_id, m])),
  )

  async function loadHouseholdHeader() {
    // Which household this answer will be ABOUT, read before the round trip and
    // checked against the live one after it. See the note on the guard below.
    const forHousehold = householdId.value
    const [{ data: household, error: householdErr }, { data: members, error: membersErr }] = await Promise.all([
      db.from('households').select('name, invite_code, created_by, max_items_per_member, emoji').eq('id', forHousehold).single(),
      // Name/avatar live in profiles now; embed them so the roster keeps the same
      // { user_id, display_name, image_url, role } shape every consumer expects.
      db.from('household_members').select('user_id, role, profiles(display_name, image_url)').eq('household_id', forHousehold),
    ])

    // Neither failure reaches the screen, and that is deliberate: this runs from
    // the watchdog every 30 seconds while the socket is down, and a dialog per
    // tick over a header that is merely stale would be worse than the staleness.
    // But silence is not the same as ignoring it — dropped entirely, a household
    // read that has started failing (a revoked membership, a transient 500) leaves
    // a stale header up indefinitely with no trace anywhere. Offline is the
    // expected case and is not a fault.
    for (const err of [householdErr, membersErr]) {
      if (err && !isOfflineError(err)) captureException(err)
    }

    // The household moved on while this was in flight, so this answer describes
    // one the user has left. Reported above regardless — the request was made and
    // a failure in it is still news — but not applied: the name, invite code,
    // owner, item cap and roster below would all be the previous household's,
    // painted over the current household's list.
    //
    // Not a contrived double-tap. This function runs from the reconnect handler,
    // from each realtime subscribe acknowledgement and from the watchdog every 30
    // seconds while the socket is down, so a read already in flight for the
    // household being left is the ordinary case. Whichever answer lands last used
    // to win, which is completion order rather than call order.
    if (householdId.value !== forHousehold) return

    if (!householdErr && household) {
      householdName.value = household.name
      householdInviteCode.value = household.invite_code || ''
      householdOwnerId.value = household.created_by || ''
      householdItemLimit.value = clampItemLimit(household.max_items_per_member)
      householdEmoji.value = household.emoji || ''
    }

    if (!membersErr && Array.isArray(members)) {
      householdMembers.value = (members as unknown as MemberRow[]).map((m) => ({
        user_id: m.user_id,
        role: m.role,
        display_name: m.profiles?.display_name || m.user_id,
        image_url: m.profiles?.image_url || null,
      }))
    }
  }

  // Every household the user belongs to, with names for the account dialog's list.
  // Only refreshes the roster; the active household is chosen by the caller.
  async function loadHouseholds() {
    const { data, error } = await db
      .from('household_members')
      .select('household_id, households(name, emoji)')
      .eq('user_id', userId.value)
    if (error) return { error }
    // A household row renders an emoji tile, a name and a marker, so that is all it
    // carries, and the embed brings all of it back in this one query. It used to
    // fetch every household's full roster here to draw composite member avatars;
    // those are gone, and so is the extra round trip.
    const list = ((data ?? []) as unknown as MembershipRow[]).map((row) => ({
      id: row.household_id,
      name: row.households?.name ?? '',
      emoji: row.households?.emoji ?? '',
    }))

    // Stable, name-ordered so the list never reshuffles between loads.
    // Pinned to 'en' so the household switcher lists in the same order on
    // every device, whatever language each member is reading it in.
    households.value = list.sort(
      (a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id, 'en'),
    )
    return { error: null }
  }

  // A household setting changed (name, item limit, emoji): refresh the active household's
  // header and the household list together, so a new name or emoji shows up
  // everywhere right away rather than only after the next reload.
  async function refreshHouseholdAfterSettingsChange() {
    await loadHouseholdHeader()
    await loadHouseholds()
  }

  return {
    households,
    householdId,
    householdName,
    householdInviteCode,
    householdOwnerId,
    householdItemLimit,
    householdEmoji,
    householdMembers,
    memberProfileMap,
    loadHouseholdHeader,
    loadHouseholds,
    refreshHouseholdAfterSettingsChange,
  }
}
