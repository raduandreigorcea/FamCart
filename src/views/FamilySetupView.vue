<script setup>
import { computed, ref, onMounted } from 'vue'
import { useAuth, useUser } from '@clerk/vue'
import { useRouter, useRoute } from 'vue-router'
import { useSupabase } from '../supabase'
import { saveActiveFamilyId } from '../lib/familyCache'
import AppTopbar from '../components/AppTopbar.vue'
import InputRow from '../components/InputRow.vue'
import ErrorModal from '../components/ErrorModal.vue'
import AppCard from '../components/AppCard.vue'
import ChoiceButton from '../components/ChoiceButton.vue'
import BackButton from '../components/BackButton.vue'
import ConfirmModal from '../components/ConfirmModal.vue'
import { isOfflineError } from '../lib/offlineQueue'

const OFFLINE_MESSAGE = 'You appear to be offline. Check your connection and try again.'

const { userId } = useAuth()
const { user } = useUser()
const router = useRouter()
const route = useRoute()
const db = useSupabase()

// Reached from the switcher's "add" action while the user already has families
// (vs. a brand-new user with none): offer a way back to their list.
const isAddingFamily = computed(() => route.query.add === '1')

// Owning is capped at one family (migration 001). Someone adding a family while
// they already own one can only join, so the create option is hidden. A brand-new
// user (not adding) always sees it.
const ownsFamily = ref(false)
// Only known after the async check below. Until then, in add mode we don't yet
// know whether create is allowed, so we withhold the create option rather than
// flash it and yank it away for an owner.
const ownershipChecked = ref(false)
const showCreate = computed(() => !isAddingFamily.value || (ownershipChecked.value && !ownsFamily.value))
onMounted(async () => {
  if (!isAddingFamily.value || !userId.value) return
  try {
    const { data } = await db
      .from('families')
      .select('id')
      .eq('created_by', userId.value)
      .limit(1)
      .maybeSingle()
    ownsFamily.value = !!data
  } finally {
    ownershipChecked.value = true
  }
})

const mode = ref(null) // null | 'create' | 'join'
const familyName = ref('')
const inviteCode = ref('')
const error = ref('')
const loading = ref(false)
const FAMILY_NAME_MAX_LENGTH = 25
const INVITE_CODE_REGEX = /^[A-HJ-NP-Z2-9]{8}$/
const familyNameLength = computed(() => familyName.value.length)
const familyNameOverLimit = computed(() => familyNameLength.value > FAMILY_NAME_MAX_LENGTH)
const limitModal = ref({ open: false, title: '', message: '' })

function openLimitModal(message) {
  limitModal.value = {
    open: true,
    title: 'Name Too Long',
    message,
  }
}

function closeLimitModal() {
  limitModal.value = { open: false, title: '', message: '' }
}

function randomInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  // Use a CSPRNG, not Math.random(): the code is the only credential guarding
  // family membership. The 32-char alphabet divides 256 evenly, so `byte & 31`
  // maps to a character with no modulo bias.
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (b) => chars[b & 31]).join('')
}

async function createFamily() {
  if (loading.value) return
  if (familyNameOverLimit.value) {
    openLimitModal(`Family name must be ${FAMILY_NAME_MAX_LENGTH} characters or fewer.`)
    return
  }
  const nextFamilyName = familyName.value.trim()
  if (nextFamilyName.length > FAMILY_NAME_MAX_LENGTH) {
    openLimitModal(`Family name must be ${FAMILY_NAME_MAX_LENGTH} characters or fewer.`)
    return
  }
  if (!nextFamilyName) return
  error.value = ''
  loading.value = true
  try {
    const code = randomInviteCode()
    const displayName = user.value?.fullName
      || user.value?.firstName
      || user.value?.emailAddresses?.[0]?.emailAddress
      || 'Member'
    const imageUrl = user.value?.imageUrl || null

    const { data: family, error: familyErr } = await db
      .from('families')
      .insert({ name: nextFamilyName, invite_code: code, created_by: userId.value })
      .select('id')
      .single()

    // A user may own only one family (migration 001). The unique index rejects a
    // second with a 23505; turn that one case into a message that explains it
    // rather than leaking the raw constraint text.
    if (familyErr) {
      if (familyErr.message?.includes('families_one_per_owner')) {
        throw new Error('You can only own one family. Leave or delete your current one before creating another.')
      }
      throw familyErr
    }

    const { error: memberErr } = await db
      .from('family_members')
      .insert({
        family_id: family.id,
        user_id: userId.value,
        role: 'moderator',
        display_name: displayName,
        image_url: imageUrl,
      })

    if (memberErr) {
      // The family row was created but the membership was rejected (e.g. the
      // membership cap, migration 025). Remove the orphan so it can't linger
      // with no members, then explain the one case the user can act on.
      await db.from('families').delete().eq('id', family.id)
      // The sentinel is raised as the exception DETAIL, which supabase-js exposes
      // on error.details, not error.message.
      if ((memberErr.details ?? memberErr.message ?? '').includes('family_membership_limit_exceeded')) {
        throw new Error('You can be part of at most 3 families. Leave one before creating another.')
      }
      throw memberErr
    }

    // Make the new family the active one so HomeView opens straight to it.
    saveActiveFamilyId(localStorage, userId.value, family.id)
    router.replace('/')
  } catch (e) {
    error.value = isOfflineError(e) ? OFFLINE_MESSAGE : (e.message ?? 'Failed to create family.')
  } finally {
    loading.value = false
  }
}

async function joinFamily() {
  if (loading.value || !inviteCode.value.trim()) return
  error.value = ''
  loading.value = true
  try {
    const code = inviteCode.value.trim().toUpperCase()
    if (!INVITE_CODE_REGEX.test(code)) {
      error.value = 'Invite code must be 8 characters using A-Z and 2-9.'
      return
    }
    const displayName = user.value?.fullName
      || user.value?.firstName
      || user.value?.emailAddresses?.[0]?.emailAddress
      || 'Member'
    const imageUrl = user.value?.imageUrl || null

    // The RPC checks the code and inserts the membership in one server-side
    // step; a direct family_members insert would be rejected by RLS, so the
    // code is a real credential (rotating it locks out removed members).
    const { data: family, error: joinErr } = await db
      .rpc('join_family_with_code', {
        p_code: code,
        p_display_name: displayName,
        p_image_url: imageUrl,
      })
      .maybeSingle()

    if (joinErr) {
      // The sentinel is raised as the exception DETAIL (error.details), not message.
      if ((joinErr.details ?? joinErr.message ?? '').includes('family_membership_limit_exceeded')) {
        error.value = 'You can be part of at most 3 families. Leave one before joining another.'
        return
      }
      throw joinErr
    }
    if (!family) {
      error.value = 'No family found with that invite code.'
      return
    }

    // Make the joined family the active one so HomeView opens straight to it.
    saveActiveFamilyId(localStorage, userId.value, family.id)
    router.replace('/')
  } catch (e) {
    error.value = isOfflineError(e) ? OFFLINE_MESSAGE : (e.message ?? 'Failed to join family.')
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

        <!-- Picker -->
        <template v-if="!mode">
          <div v-if="isAddingFamily" class="setup-back">
            <BackButton @click="router.replace('/')" />
          </div>
          <div class="card-header">
            <p class="card-eyebrow">{{ isAddingFamily ? 'Add a family' : 'Welcome aboard 👋' }}</p>
            <h2 class="heading">
              <template v-if="isAddingFamily">Add another <span class="heading--accent">family</span></template>
              <template v-else>Set up your <span class="heading--accent">family</span></template>
            </h2>
            <p class="sub">
              {{ isAddingFamily
                ? 'Join another family with their invite code' + (showCreate ? ', or create a new one.' : '.')
                : 'Create a shared grocery list for your family, or join one using an invite code.' }}
            </p>
          </div>
          <div class="choice-row">
            <ChoiceButton
              v-if="showCreate"
              icon="🏠"
              label="Create a family"
              description="Start fresh and get a shareable invite code"
              @click="mode = 'create'"
            />
            <ChoiceButton
              icon="🔗"
              label="Join a family"
              description="Paste the invite code your family shared with you"
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
            <p class="card-eyebrow">New family</p>
            <h2 class="heading">What's your family name?</h2>
            <p class="sub">This is how your family list will appear for everyone.</p>
          </div>
          <form @submit.prevent="createFamily" class="input-form">
            <InputRow v-model="familyName" placeholder="e.g. The Smiths" :loading="loading" required autofocus />
            <p class="field-counter" :class="{ 'field-counter--danger': familyNameOverLimit }">
              {{ familyNameLength }}/{{ FAMILY_NAME_MAX_LENGTH }}
            </p>          </form>
        </template>

        <!-- Join form -->
        <template v-else-if="mode === 'join'">
          <div class="setup-back">
            <BackButton @click="mode = null; error = ''" />
          </div>
          <div class="card-header">
            <p class="card-eyebrow">Join a family</p>
            <h2 class="heading">Enter your invite code</h2>
            <p class="sub">Ask a family member for their 8-character code.</p>
          </div>
          <form @submit.prevent="joinFamily" class="input-form">
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

/* ── Card header ─────────────────────────────────────────── */
.card-header {
  margin-bottom: 1.75rem;
}

.card-eyebrow {
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-primary);
  margin: 0 0 1.5rem;
}

.heading {
  font-family: inherit;
  font-size: 1.45rem;
  font-weight: 800;
  color: var(--text-primary);
  margin: 0 0 0.5rem;
  line-height: 1.2;
}

.heading--accent {
  color: var(--color-primary);
}

.sub {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.55;
}

/* ── Back to families ────────────────────────────────────── */
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
  font-size: 0.78rem;
  color: var(--text-disabled);
}

.field-counter--danger {
  color: var(--danger-main);
  font-weight: 700;
}
</style>
