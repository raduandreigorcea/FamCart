<script setup lang="ts">
import { onBeforeUnmount, ref, type PropType } from 'vue'
import { useAuth } from '@clerk/vue'
import { useSupabase } from '../../supabase'
import { userMessage } from '../../lib/errorMessages'
import { randomInviteCode } from '../../lib/inviteCode'
import type { ConfirmOptions } from '../../lib/useConfirm'
import checkIcon from '../../assets/check.svg?raw'

// The actions that cannot be undone: rotating the invite code, leaving, and
// deleting the family. An owner sees delete, everyone else sees leave — the
// owner cannot leave a family they still own.
const props = defineProps({
  familyId: { type: String, default: '' },
  familyName: { type: String, default: '' },
  isOwner: { type: Boolean, default: false },
  isOwnerOrModerator: { type: Boolean, default: false },
  // The modal's own confirm dialog, handed down so every destructive action in
  // the settings shares one dialog instead of each panel mounting its own.
  confirm: {
    type: Function as PropType<(options: ConfirmOptions) => Promise<boolean>>,
    required: true,
  },
})

const emit = defineEmits<{
  (e: 'refresh-family'): void
  (e: 'family-deleted'): void
  (e: 'family-left'): void
  (e: 'error', message: string, title?: string): void
}>()

const { userId } = useAuth()
const db = useSupabase()

const regenerating = ref(false)
const codeRegenerated = ref(false)
const leavingFamily = ref(false)
const deletingFamily = ref(false)

let regeneratedTimer: ReturnType<typeof setTimeout> | null = null
onBeforeUnmount(() => {
  if (regeneratedTimer) clearTimeout(regeneratedTimer)
})

async function regenerateInviteCode() {
  if (!props.familyId || regenerating.value) return
  const confirmed = await props.confirm({
    title: 'Regenerate Invite Code?',
    message:
      'This will immediately invalidate the current invite code. Existing members are unaffected, but anyone with the old code will no longer be able to join.',
    danger: false,
  })
  if (!confirmed) return
  regenerating.value = true
  try {
    const { error } = await db
      .from('families')
      .update({ invite_code: randomInviteCode() })
      .eq('id', props.familyId)
    if (error) {
      // Includes the rare unique-index collision on the new code; retrying
      // draws a different one, which is what the message asks for.
      emit('error', userMessage(error, 'Could not regenerate the invite code. Please try again.'))
      return
    }
    emit('refresh-family')
    codeRegenerated.value = true
    if (regeneratedTimer) clearTimeout(regeneratedTimer)
    regeneratedTimer = setTimeout(() => {
      codeRegenerated.value = false
    }, 2000)
  } finally {
    regenerating.value = false
  }
}

async function leaveFamily() {
  if (!props.familyId || leavingFamily.value) return
  const confirmed = await props.confirm({
    title: 'Leave Family?',
    message: 'You will lose access to the shopping list and will need a new invite code to rejoin.',
    danger: true,
  })
  if (!confirmed) return
  leavingFamily.value = true
  try {
    const { error } = await db
      .from('family_members')
      .delete()
      .eq('family_id', props.familyId)
      .eq('user_id', userId.value)
    if (error) {
      emit('error', userMessage(error, 'Could not leave the family.'))
      return
    }
    // HomeView moves to another family, or to setup if none remain.
    emit('family-left')
  } finally {
    leavingFamily.value = false
  }
}

async function deleteFamily() {
  if (!props.familyId || deletingFamily.value) return
  const confirmed = await props.confirm({
    title: 'Delete Family Group?',
    message: `Deleting "${props.familyName}" will permanently remove all members, shopping list items, and history. This action cannot be undone.`,
    danger: true,
  })
  if (!confirmed) return
  deletingFamily.value = true
  try {
    const { error } = await db.from('families').delete().eq('id', props.familyId)
    if (error) {
      emit('error', userMessage(error, 'Could not delete the family.'))
      return
    }
    // HomeView reconciles: switch to another family, or setup if none remain.
    emit('family-deleted')
  } finally {
    deletingFamily.value = false
  }
}
</script>

<template>
  <div class="tab-panel tab-panel--overlay">
    <!-- Invite code rotation -->
    <div class="panel-section" v-if="isOwnerOrModerator">
      <h4 class="panel-section-title">Invite Code Administration</h4>
      <div class="card-item card-item--action">
        <div class="card-item__info">
          <p>Immediately invalidates the current invite code. Existing members are unaffected, but future members must use the new code.</p>
        </div>
        <button
          class="panel-action-btn"
          type="button"
          :disabled="regenerating"
          @click="regenerateInviteCode"
        >
          <span v-if="regenerating" class="btn-spinner"></span>
          <span v-else-if="codeRegenerated" class="success-state animate-pop">
            <span class="success-icon-wrap" aria-hidden="true" v-html="checkIcon"></span>
            Regenerated
          </span>
          <span v-else>Regenerate</span>
        </button>
      </div>
    </div>

    <!-- Leave (non-owners) -->
    <div class="panel-section" v-if="!isOwner">
      <h4 class="panel-section-title text-danger">Leave Family</h4>
      <div class="card-item card-item--action">
        <div class="card-item__info">
          <p>This will remove you from the family group. You will no longer have access to the shopping list.</p>
        </div>
        <button class="danger-action-btn" type="button" :disabled="leavingFamily" @click="leaveFamily">Leave Family</button>
      </div>
    </div>

    <!-- Delete (owner only) -->
    <div class="panel-section" v-if="isOwner">
      <h4 class="panel-section-title text-danger">Delete Family Group</h4>
      <div class="card-item card-item--action card-item--danger">
        <div class="card-item__info">
          <p>Permanently deletes <strong>{{ familyName }}</strong>, removes all members, and erases all shopping list data. This cannot be undone.</p>
        </div>
        <button
          class="danger-action-btn danger-action-btn--delete"
          type="button"
          :disabled="deletingFamily"
          @click="deleteFamily"
        >
          <span v-if="deletingFamily" class="btn-spinner btn-spinner--light"></span>
          <span v-else>Delete Family</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Card Action (Regenerate code) */
.card-item--action {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1.5rem;
  background: var(--bg-surface);
}

@media (max-width: 480px) {
  .card-item--action {
    flex-direction: column;
    gap: 0.75rem;
  }
  .card-item--action .panel-action-btn {
    width: auto;
    align-self: flex-start;
    justify-content: flex-start;
  }
}

.card-item__info h5 {
  margin: 0 0 0.2rem 0;
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
  color: var(--ui-text-strong);
}

.card-item__info p {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--ui-text-muted);
  line-height: 1.45;
}

.panel-action-btn {
  background: var(--bg-surface);
  color: var(--ui-text-strong);
  border: var(--border-width-thin) solid var(--ui-border);
  border-radius: var(--radius-md);
  padding: 0.55rem 0.9rem;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  cursor: pointer;
  transition: all var(--transition-base) ease;
  white-space: nowrap;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 100px;
}

.panel-action-btn:hover:not(:disabled) {
  background: var(--bg-surface-alt);
  border-color: var(--border-dark);
}

.panel-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Danger zone card modifier */
.card-item--danger {
  border-color: var(--danger-border);
  background: var(--danger-bg);
}

.danger-action-btn {
  background: var(--danger-solid);
  color: var(--text-inverse);
  border: none;
  border-radius: var(--radius-md);
  padding: 0.6rem 1.25rem;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  cursor: pointer;
  transition: all var(--transition-base) ease;
  box-shadow: var(--elevation-danger-subtle);
  white-space: nowrap;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 100px;
}

.danger-action-btn:hover:not(:disabled) {
  background: var(--danger-solid-hover);
  transform: translateY(-1px);
  box-shadow: var(--elevation-danger-hover);
}

.danger-action-btn--delete:hover:not(:disabled) {
  transform: none;
}

.danger-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
