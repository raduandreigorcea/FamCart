<script setup lang="ts">
import { ref } from 'vue'
import { useAuth, getUserDisplayName, getUserAvatarUrl } from '../lib/auth'
import { supabase } from '../lib/supabase'
import type { Family } from '../types'

const props = defineProps<{
  userId: string
}>()

const emit = defineEmits<{
  familyReady: [family: Family]
}>()

const { user } = useAuth()

const mode = ref<'create' | 'join' | null>(null)
const familyName = ref('')
const inviteCode = ref('')
const errorMessage = ref('')
const isSubmitting = ref(false)

function resetForm() {
  errorMessage.value = ''
}

function getProfileDefaults() {
  const displayName =
    getUserDisplayName(user.value)
    ?? props.userId.slice(0, 14)

  const imageUrl = getUserAvatarUrl(user.value)

  return { displayName, imageUrl }
}

function createInviteCode() {
  // Some Android WebViews do not implement crypto.randomUUID().
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  // RFC4122-ish fallback for environments without randomUUID support.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16)
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

async function insertMemberWithProfile(
  familyId: string,
  role: 'admin' | 'member',
) {
  const { displayName, imageUrl } = getProfileDefaults()

  const profileInsert = await supabase.from('family_members').insert({
    family_id: familyId,
    user_id: props.userId,
    role,
    display_name: displayName,
    image_url: imageUrl,
  })

  if (!profileInsert.error) return

  // Backward compatibility for schemas that do not have profile columns yet.
  if (/display_name|image_url/i.test(profileInsert.error.message)) {
    const legacyInsert = await supabase.from('family_members').insert({
      family_id: familyId,
      user_id: props.userId,
      role,
    })

    if (legacyInsert.error) throw legacyInsert.error
    return
  }

  throw profileInsert.error
}

async function createFamily() {
  const trimmedName = familyName.value.trim().slice(0, 100)

  if (!trimmedName) {
    errorMessage.value = 'Enter a family name.'
    return
  }

  isSubmitting.value = true
  errorMessage.value = ''

  try {
    const nextInviteCode = createInviteCode()

    // Keep the create flow client-side and sequential since this project intentionally has no custom backend.
    const familyResponse = await supabase
      .from('families')
      .insert({ name: trimmedName, invite_code: nextInviteCode })
      .select('id, name, invite_code, created_at')
      .single()

    if (familyResponse.error || !familyResponse.data) {
      throw familyResponse.error ?? new Error('Unable to create family.')
    }

    const family = familyResponse.data as Family

    try {
      await insertMemberWithProfile(family.id, 'admin')
    } catch (memberError) {
      await supabase.from('families').delete().eq('id', family.id)
      throw memberError
    }

    emit('familyReady', family)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to create family.'
  } finally {
    isSubmitting.value = false
  }
}

async function joinFamily() {
  const normalizedInviteCode = inviteCode.value.trim().toLowerCase()

  if (!normalizedInviteCode) {
    errorMessage.value = 'Enter an invite code.'
    return
  }

  isSubmitting.value = true
  errorMessage.value = ''

  try {
    const familyResponse = await supabase
      .from('families')
      .select('id, name, invite_code, created_at')
      .eq('invite_code', normalizedInviteCode)
      .maybeSingle()

    if (familyResponse.error) {
      throw familyResponse.error
    }

    const family = familyResponse.data as Family | null

    if (!family) {
      throw new Error('No family found for that invite code.')
    }

    await insertMemberWithProfile(family.id, 'member')

    emit('familyReady', family)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to join family.'
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="setup">
    <div class="setup-hero">
      <span class="setup-icon">👨‍👩‍👧‍👦</span>
      <h2>Set up your family</h2>
      <p>Create a new family or join one with an invite code. Everyone shares the same shopping list.</p>
    </div>

    <div v-if="mode === null" class="setup-choices">
      <button type="button" class="btn btn--primary btn--full" @click="mode = 'create'; resetForm()">
        Create Family
      </button>
      <button type="button" class="btn btn--secondary btn--full" @click="mode = 'join'; resetForm()">
        Join Family
      </button>
    </div>

    <form v-else class="setup-form" @submit.prevent="mode === 'create' ? createFamily() : joinFamily()">
      <div class="input-group">
        <label>{{ mode === 'create' ? 'Family name' : 'Invite code' }}</label>
        <input
          v-if="mode === 'create'"
          v-model="familyName"
          type="text"
          placeholder="The Smiths"
          maxlength="100"
          :disabled="isSubmitting"
        />
        <input
          v-else
          v-model="inviteCode"
          type="text"
          placeholder="Paste invite code"
          :disabled="isSubmitting"
        />
      </div>

      <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>

      <div class="setup-choices">
        <button type="submit" class="btn btn--primary btn--full" :disabled="isSubmitting">
          {{ isSubmitting ? 'Saving...' : mode === 'create' ? 'Create' : 'Join' }}
        </button>
        <button
          type="button"
          class="btn btn--secondary btn--full"
          :disabled="isSubmitting"
          @click="mode = null; resetForm()"
        >
          Back
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.setup {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px 24px calc(var(--safe-bottom) + 12px);
  text-align: center;
}

.setup-hero {
  max-width: 300px;
  margin-bottom: 32px;
}

.setup-icon {
  display: block;
  font-size: 2.5rem;
  margin-bottom: 16px;
}

.setup-hero h2 {
  font-size: 1.375rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.setup-hero p {
  margin-top: 8px;
  color: #8e8e93;
  font-size: 0.9375rem;
  line-height: 1.45;
}

.setup-choices,
.setup-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  max-width: 340px;
}

.input-group {
  text-align: left;
}

.input-group label {
  display: block;
  margin-bottom: 6px;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #8e8e93;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.input-group input {
  width: 100%;
  height: 48px;
  padding: 0 14px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid rgba(48, 232, 140, 0.2);
  font-size: 1rem;
}

.input-group input:focus {
  outline: none;
  border-color: #30e88c;
  box-shadow: 0 0 0 3px rgba(48, 232, 140, 0.2);
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 50px;
  border-radius: 12px;
  font-size: 1rem;
  font-weight: 600;
}

.btn--full { width: 100%; }

.btn--primary {
  background: #30e88c;
  color: #112119;
  box-shadow: 0 4px 12px rgba(48, 232, 140, 0.25);
}

.btn--primary:active { background: #22c974; }

.btn--secondary {
  background: rgba(48, 232, 140, 0.1);
  color: #1a7a48;
}

.btn--secondary:active { background: rgba(48, 232, 140, 0.2); }

.btn:disabled {
  opacity: 0.45;
  pointer-events: none;
}

.error-text {
  color: #ff3b30;
  font-size: 0.875rem;
  text-align: left;
}
</style>