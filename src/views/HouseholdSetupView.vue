<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useAuth, useUser } from '@clerk/vue'
import { useRouter, useRoute } from 'vue-router'
import { useSupabase } from '../supabase'
import { saveActiveHouseholdId } from '../lib/householdCache'
import { deriveProfileFields } from '../lib/userIdentity'
import { upsertOwnProfile } from '../lib/profile'
import AppTopbar from '../components/AppTopbar.vue'
import InputRow from '../components/InputRow.vue'
import ErrorModal from '../components/ErrorModal.vue'
import AppCard from '../components/AppCard.vue'
import AppButton from '../components/AppButton.vue'
import ChoiceButton from '../components/ChoiceButton.vue'
import BackButton from '../components/BackButton.vue'
import ConfirmModal from '../components/ConfirmModal.vue'
import { isOfflineError } from '../lib/offlineQueue'
import { UserFacingError, userMessage } from '../lib/errorMessages'
import { isValidInviteCode, normalizeInviteCode, randomInviteCode } from '../lib/inviteCode'
import { HOUSEHOLD_MEMBERSHIP_CAP, HOUSEHOLD_NAME_MAX_LENGTH } from '../lib/limits'

const OFFLINE_MESSAGE = 'You appear to be offline. Check your connection and try again.'

const { userId } = useAuth()
const { user } = useUser()
const router = useRouter()
const route = useRoute()
const db = useSupabase()

// Reached from the account dialog's "join or create" action while the user already has households
// (vs. a brand-new user with none): offer a way back to their list.
const isAddingHousehold = computed(() => route.query.add === '1')

// Owning is capped at one household (003_households_and_members.sql). Someone adding a household while
// they already own one can only join, so the create option is hidden. A brand-new
// user (not adding) always sees it.
const ownsHousehold = ref(false)
// Only known after the async check below. Until then, in add mode we don't yet
// know whether create is allowed, so we withhold the create option rather than
// flash it and yank it away for an owner.
const ownershipChecked = ref(false)
const showCreate = computed(() => !isAddingHousehold.value || (ownershipChecked.value && !ownsHousehold.value))
onMounted(async () => {
  if (!isAddingHousehold.value || !userId.value) return
  try {
    const { data } = await db
      .from('households')
      .select('id')
      .eq('created_by', userId.value)
      .limit(1)
      .maybeSingle()
    ownsHousehold.value = !!data
  } finally {
    ownershipChecked.value = true
  }
})

// Brand-new users open on a warm welcome before the create/join picker; someone
// adding a household from the account dialog already knows the app, so they skip it.
const welcomed = ref(false)
const showWelcome = computed(() => !welcomed.value && !isAddingHousehold.value)

const mode = ref<'create' | 'join' | null>(null)
const householdName = ref('')
const inviteCode = ref('')
const error = ref('')
const loading = ref(false)
const householdNameLength = computed(() => householdName.value.length)
const householdNameOverLimit = computed(() => householdNameLength.value > HOUSEHOLD_NAME_MAX_LENGTH)
const limitModal = ref({ open: false, title: '', message: '' })

function openLimitModal(message: string) {
  limitModal.value = {
    open: true,
    title: 'Name Too Long',
    message,
  }
}

function closeLimitModal() {
  limitModal.value = { open: false, title: '', message: '' }
}

async function createHousehold() {
  if (loading.value) return
  const uid = userId.value
  if (!uid) return
  if (householdNameOverLimit.value) {
    openLimitModal(`Household name must be ${HOUSEHOLD_NAME_MAX_LENGTH} characters or fewer.`)
    return
  }
  const nextHouseholdName = householdName.value.trim()
  if (nextHouseholdName.length > HOUSEHOLD_NAME_MAX_LENGTH) {
    openLimitModal(`Household name must be ${HOUSEHOLD_NAME_MAX_LENGTH} characters or fewer.`)
    return
  }
  if (!nextHouseholdName) return
  error.value = ''
  loading.value = true
  try {
    const code = randomInviteCode()

    // Establish the profile first: the membership insert below references it
    // (FK), and this is where the creator's Clerk name/avatar lands.
    const { error: profileErr } = await upsertOwnProfile(db, uid, user.value)
    if (profileErr) throw profileErr

    const { data: household, error: householdErr } = await db
      .from('households')
      .insert({ name: nextHouseholdName, invite_code: code, created_by: uid })
      .select('id')
      .single<{ id: string }>()

    // A user may own only one household (003_households_and_members.sql). The unique index rejects a
    // second with a 23505; turn that one case into a message that explains it
    // rather than leaking the raw constraint text.
    if (householdErr) {
      if (householdErr.message?.includes('households_one_per_owner')) {
        throw new UserFacingError('You can only own one household. Leave or delete your current one before creating another.')
      }
      throw householdErr
    }

    const { error: memberErr } = await db
      .from('household_members')
      .insert({
        household_id: household.id,
        user_id: uid,
        role: 'moderator',
      })

    if (memberErr) {
      // The household row was created but the membership was rejected (e.g. the
      // membership cap, 003_households_and_members.sql). Remove the orphan so it
      // can't linger
      // with no members, then explain the one case the user can act on.
      await db.from('households').delete().eq('id', household.id)
      // The sentinel is raised as the exception DETAIL, which supabase-js exposes
      // on error.details, not error.message.
      if ((memberErr.details ?? memberErr.message ?? '').includes('membership_limit_exceeded')) {
        throw new UserFacingError(
          `You can be part of at most ${HOUSEHOLD_MEMBERSHIP_CAP} households. Leave one before creating another.`,
        )
      }
      throw memberErr
    }

    // Make the new household the active one so HomeView opens straight to it.
    saveActiveHouseholdId(localStorage, uid, household.id)
    router.replace('/')
  } catch (e) {
    error.value = isOfflineError(e) ? OFFLINE_MESSAGE : userMessage(e, 'Failed to create household.')
  } finally {
    loading.value = false
  }
}

async function joinHousehold() {
  if (loading.value || !inviteCode.value.trim()) return
  const uid = userId.value
  if (!uid) return
  error.value = ''
  loading.value = true
  try {
    const code = normalizeInviteCode(inviteCode.value)
    if (!isValidInviteCode(code)) {
      error.value = 'Invite code must be 8 characters, letters and numbers only.'
      return
    }
    const { display_name, image_url } = deriveProfileFields(user.value)

    // The RPC checks the code, upserts the joiner's profile, and inserts the
    // membership in one server-side step; a direct household_members insert would
    // be rejected by RLS, so the code is a real credential (rotating it locks
    // out removed members).
    const { data: household, error: joinErr } = await db
      .rpc('join_household_with_code', {
        p_code: code,
        p_display_name: display_name,
        p_image_url: image_url,
      })
      .maybeSingle<{ id: string; name: string }>()

    if (joinErr) {
      // The sentinel is raised as the exception DETAIL (error.details), not message.
      if ((joinErr.details ?? joinErr.message ?? '').includes('membership_limit_exceeded')) {
        error.value = `You can be part of at most ${HOUSEHOLD_MEMBERSHIP_CAP} households. Leave one before joining another.`
        return
      }
      throw joinErr
    }
    if (!household) {
      error.value = 'No household found with that invite code.'
      return
    }

    // Make the joined household the active one so HomeView opens straight to it.
    saveActiveHouseholdId(localStorage, uid, household.id)
    router.replace('/')
  } catch (e) {
    error.value = isOfflineError(e) ? OFFLINE_MESSAGE : userMessage(e, 'Failed to join household.')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="setup-page">
    <!-- Top bar -->
    <AppTopbar />

    <!-- Content -->
    <main class="setup-main">
      <AppCard>

        <!-- Welcome (brand-new users only) -->
        <template v-if="showWelcome">
          <!-- A shared list caught mid-use: three items, three different people,
               one of them just done. Real names rather than grey bars, because a
               row of placeholder bars is the visual language of content that
               failed to load, and this is the first thing a new user ever sees.
               The finished row plays once on arrival and then rests. Looping it
               meant a completed item repeatedly un-completing itself, which reads
               as a glitch rather than as the live update it is meant to show. -->
          <div class="welcome-hero" aria-hidden="true">
            <ul class="wl-card">
              <li class="wl-row">
                <span class="wl-emoji">🥑</span>
                <span class="wl-name">Avocado</span>
                <span class="wl-who wl-who--a">🧑</span>
              </li>
              <li class="wl-row wl-row--done">
                <span class="wl-emoji">🥛</span>
                <span class="wl-name">Lapte</span>
                <span class="wl-who wl-who--b">👩</span>
              </li>
              <li class="wl-row">
                <span class="wl-emoji">🍞</span>
                <span class="wl-name">Pâine</span>
                <span class="wl-who wl-who--c">🧒</span>
              </li>
            </ul>
          </div>
          <div class="card-header card-header--welcome">
            <p class="card-eyebrow">Welcome to FamCart 🛒</p>
            <h2 class="heading">The list your whole <span class="heading--accent">household</span> shares</h2>
            <p class="sub">
              Everyone adds, everyone checks off, and it all updates for the whole
              household the moment it happens, so nothing gets forgotten at the store.
            </p>
          </div>
          <AppButton variant="primary" block @click="welcomed = true">Get started</AppButton>
        </template>

        <!-- Picker -->
        <template v-else-if="!mode">
          <div v-if="isAddingHousehold" class="setup-back">
            <BackButton @click="router.replace('/')" />
          </div>
          <div class="card-header">
            <p class="card-eyebrow">{{ isAddingHousehold ? 'Add a household' : 'Welcome aboard 👋' }}</p>
            <h2 class="heading">
              <template v-if="isAddingHousehold">Add another <span class="heading--accent">household</span></template>
              <template v-else>Set up your <span class="heading--accent">household</span></template>
            </h2>
            <p class="sub">
              {{ isAddingHousehold
                ? 'Join another household with their invite code' + (showCreate ? ', or create a new one.' : '.')
                : 'Create a shared grocery list for your household, or join one using an invite code.' }}
            </p>
          </div>
          <div class="choice-row">
            <ChoiceButton
              v-if="showCreate"
              icon="🏠"
              label="Create a household"
              description="Start a new list and get a shareable invite code"
              @click="mode = 'create'"
            />
            <ChoiceButton
              icon="🔗"
              label="Join a household"
              description="Paste the invite code your household shared with you"
              @click="mode = 'join'"
            />
          </div>
        </template>

        <!-- Create form -->
        <template v-else-if="mode === 'create'">
          <div class="setup-back">
            <BackButton @click="mode = null; error = ''" />
          </div>
          <div class="card-header">
            <p class="card-eyebrow">New household</p>
            <h2 class="heading">What's your household name?</h2>
            <p class="sub">This is how your household list will appear for everyone.</p>
          </div>
          <form @submit.prevent="createHousehold" class="input-form">
            <InputRow v-model="householdName" placeholder="e.g. The Smiths" :loading="loading" required autofocus />
            <p class="field-counter" :class="{ 'field-counter--danger': householdNameOverLimit }">
              {{ householdNameLength }}/{{ HOUSEHOLD_NAME_MAX_LENGTH }}
            </p>          </form>
        </template>

        <!-- Join form -->
        <template v-else-if="mode === 'join'">
          <div class="setup-back">
            <BackButton @click="mode = null; error = ''" />
          </div>
          <div class="card-header">
            <p class="card-eyebrow">Join a household</p>
            <h2 class="heading">Enter your invite code</h2>
            <p class="sub">Ask a household member for their invite code.</p>
          </div>
          <form @submit.prevent="joinHousehold" class="input-form">
            <InputRow v-model="inviteCode" placeholder="e.g. AB3K7XYZ" maxlength="8" :loading="loading" :uppercase="true" required autofocus />          </form>
        </template>

      </AppCard>
    </main>

    <ConfirmModal
      :open="limitModal.open"
      :title="limitModal.title"
      :message="limitModal.message"
      :danger="true"
      confirm-text="OK"
      :show-cancel="false"
      @confirm="closeLimitModal"
      @cancel="closeLimitModal"
    />

    <ErrorModal :message="error" @dismiss="error = ''" />
  </div>
</template>

<style scoped>
/* ── Layout ─────────────────────────────────────────────── */
.setup-page {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--color-primary-bg);
}

/* ── Main content ────────────────────────────────────────── */
.setup-main {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem 1rem;
  padding-top: calc(56px + 2rem + var(--safe-top));
  padding-bottom: calc(2rem + var(--safe-bottom));
}

/* ── Welcome hero ────────────────────────────────────────── */
/* The hero is the thesis: a shared list with one item already ticked off, and
   two people beside it — FamCart in a single glance. */
.welcome-hero {
  display: flex;
  justify-content: center;
  margin: var(--space-1) 0 var(--space-7);
}

/* The list itself, sitting on the card the way it sits on the app background.
   Fixed width rather than fluid: it is a picture of a list, and a picture that
   restretches with the viewport stops reading as one. */
.wl-card {
  width: 100%;
  max-width: 272px;
  margin: 0;
  padding: var(--space-2);
  list-style: none;
  background: var(--bg-main);
  border: var(--border-width-thin) solid var(--border-main);
  border-radius: var(--radius-2xl);
  box-shadow: var(--elevation-card);
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
}

.wl-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  background: var(--bg-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--elevation-soft);
}

.wl-emoji {
  flex-shrink: 0;
  width: 1.9rem;
  height: 1.9rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-base);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-primary) 10%, var(--bg-surface));
}

.wl-name {
  flex: 1;
  text-align: left;
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
}

/* Who put it there. The real list resolves this avatar from the row's author,
   so three different faces is the least abstract way to say "shared". */
.wl-who {
  position: relative;
  flex-shrink: 0;
  width: 1.7rem;
  height: 1.7rem;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-sm);
  border: var(--border-width-thin) solid var(--border-main);
}

.wl-who--a { background: color-mix(in srgb, var(--color-primary) 18%, var(--bg-surface)); }
.wl-who--b { background: color-mix(in srgb, var(--warning-bg) 70%, var(--bg-surface)); }
.wl-who--c { background: color-mix(in srgb, var(--danger-bg) 80%, var(--bg-surface)); }

/* ── The one finished row ────────────────────────────────────────────────────
   Exactly what the real list does to a checked row, and nothing invented on top:
   the row drops to opacity 0.55 and the name takes a line-through in the
   disabled colour. See ShoppingListItem, .item--checked.

   An earlier attempt drew its own rule as an absolutely positioned ::after
   spanning left:0 to right:0 of the name. The name is a flex:1 child, so that
   line ran the full width of the row — past the end of the word and on through
   the empty space beside it, which read as the row being sliced rather than the
   word being crossed out. line-through hugs the glyphs, which is the whole
   reason the app uses it.

   It cycles: checked, held, unchecked, held. Both directions are real — swiping
   a row right checks it and swiping again unchecks it — so neither half of the
   loop shows something the app cannot do. The strike fades rather than retracts,
   because a line withdrawing along its own length reads as a redraw glitch where
   a fade reads as state leaving. The row stays visible throughout.

   The two keyframes share a duration and start together, which is what keeps the
   strike and the dimming in step. */
.wl-row--done {
  animation: wl-cycle 7s var(--ease-rise) infinite;
}

.wl-row--done .wl-name {
  text-decoration: line-through;
  /* Animatable, unlike the text-decoration shorthand. Transparent until the
     strike is drawn, so it arrives rather than being there all along. */
  text-decoration-color: transparent;
  animation: wl-cross 7s var(--ease-rise) infinite;
}

@keyframes wl-cycle {
  0%, 12% { opacity: 1; }
  22%, 70% { opacity: 0.55; }
  80%, 100% { opacity: 1; }
}

@keyframes wl-cross {
  0%, 12% {
    color: var(--text-primary);
    text-decoration-color: transparent;
  }
  22%, 70% {
    color: var(--text-disabled);
    text-decoration-color: var(--text-disabled);
  }
  80%, 100% {
    color: var(--text-primary);
    text-decoration-color: transparent;
  }
}

/* Asked for stillness, the row is simply already done. Same picture, no motion. */
@media (prefers-reduced-motion: reduce) {
  .wl-row--done {
    animation: none;
    opacity: 0.55;
  }
  .wl-row--done .wl-name {
    animation: none;
    color: var(--text-disabled);
    text-decoration-color: var(--text-disabled);
  }
}

.card-header--welcome {
  text-align: center;
  margin-bottom: 1.5rem;
}

/* ── Card header ─────────────────────────────────────────── */
.card-header {
  margin-bottom: 1.75rem;
}

.card-eyebrow {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-primary);
  margin: 0 0 1.5rem;
}

.heading {
  font-family: inherit;
  font-size: var(--text-xl);
  font-weight: var(--weight-extrabold);
  color: var(--text-primary);
  margin: 0 0 0.5rem;
  line-height: 1.2;
}

.heading--accent {
  color: var(--color-primary);
}

.sub {
  font-size: var(--text-base);
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.55;
}

/* ── Back to households ────────────────────────────────────── */
.setup-back {
  /* Pull the button up so its own padding lines it up with the card edge,
     then leave clear space before the heading below. */
  margin: -0.35rem 0 0.85rem -0.4rem;
}

/* ── Choice list ─────────────────────────────────────────── */
.choice-row {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}

/* ── Input form ──────────────────────────────────────────── */
.input-form {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin-bottom: 0.875rem;
}

.field-counter {
  margin: -0.15rem 0 0;
  text-align: right;
  font-size: var(--text-xs);
  color: var(--text-disabled);
}

.field-counter--danger {
  color: var(--danger-main);
  font-weight: var(--weight-bold);
}
</style>
