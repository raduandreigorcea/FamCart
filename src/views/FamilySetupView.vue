<script setup>
import { ref } from 'vue'
import { useAuth, useUser } from '@clerk/vue'
import { useRouter } from 'vue-router'
import { useSupabase } from '../supabase.js'
import AppTopbar from '../components/AppTopbar.vue'
import InputRow from '../components/InputRow.vue'
import ErrorMessage from '../components/ErrorMessage.vue'
import AppCard from '../components/AppCard.vue'
import ChoiceButton from '../components/ChoiceButton.vue'
import BackButton from '../components/BackButton.vue'

const { userId } = useAuth()
const { user } = useUser()
const router = useRouter()
const db = useSupabase()

const mode = ref(null) // null | 'create' | 'join'
const familyName = ref('')
const inviteCode = ref('')
const error = ref('')
const loading = ref(false)

function randomInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

async function createFamily() {
  if (loading.value || !familyName.value.trim()) return
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
      .insert({ name: familyName.value.trim(), invite_code: code, created_by: userId.value })
      .select('id')
      .single()

    if (familyErr) throw familyErr

    const { error: memberErr } = await db
      .from('family_members')
      .insert({
        family_id: family.id,
        user_id: userId.value,
        role: 'moderator',
        display_name: displayName,
        image_url: imageUrl,
      })

    if (memberErr) throw memberErr

    router.replace('/')
  } catch (e) {
    error.value = e.message ?? 'Failed to create family.'
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
    const displayName = user.value?.fullName
      || user.value?.firstName
      || user.value?.emailAddresses?.[0]?.emailAddress
      || 'Member'
    const imageUrl = user.value?.imageUrl || null

    const { data: family, error: familyErr } = await db
      .from('families')
      .select('id')
      .eq('invite_code', code)
      .single()

    if (familyErr || !family) {
      error.value = 'No family found with that invite code.'
      return
    }

    const { error: memberErr } = await db
      .from('family_members')
      .insert({
        family_id: family.id,
        user_id: userId.value,
        role: 'member',
        display_name: displayName,
        image_url: imageUrl,
      })

    if (memberErr) throw memberErr

    router.replace('/')
  } catch (e) {
    error.value = e.message ?? 'Failed to join family.'
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
          <div class="card-header">
            <p class="card-eyebrow">Welcome aboard 👋</p>
            <h2 class="heading">Set up your <span class="heading--accent">family</span></h2>
            <p class="sub">Create a shared grocery list for your family, or join one using an invite code.</p>
          </div>
          <div class="choice-row">
            <ChoiceButton
              icon="🏠"
              label="Create a family"
              description="Start fresh — you'll get a shareable invite code"
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
          <div class="card-header">
            <p class="card-eyebrow">New family</p>
            <h2 class="heading">What's your family name?</h2>
            <p class="sub">This is how your family list will appear for everyone.</p>
          </div>
          <form @submit.prevent="createFamily" class="input-form">
            <InputRow v-model="familyName" placeholder="e.g. The Smiths" maxlength="40" :loading="loading" required autofocus />
            <ErrorMessage :message="error" />
          </form>
          <BackButton @click="mode = null; error = ''" />
        </template>

        <!-- Join form -->
        <template v-else-if="mode === 'join'">
          <div class="card-header">
            <p class="card-eyebrow">Join a family</p>
            <h2 class="heading">Enter your invite code</h2>
            <p class="sub">Ask a family member for their 8-character code.</p>
          </div>
          <form @submit.prevent="joinFamily" class="input-form">
            <InputRow v-model="inviteCode" placeholder="e.g. AB3K7XYZ" maxlength="8" :loading="loading" :uppercase="true" required autofocus />
            <ErrorMessage :message="error" />
          </form>
          <BackButton @click="mode = null; error = ''" />
        </template>

      </AppCard>
    </main>
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
  padding-top: calc(56px + 2rem);
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
</style>
