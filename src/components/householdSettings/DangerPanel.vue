<script setup lang="ts">
import { onBeforeUnmount, ref, type PropType } from 'vue'
import { useAuth } from '@clerk/vue'
import { useSupabase } from '../../supabase'
import { userMessage } from '../../lib/errorMessages'
import { randomInviteCode } from '../../lib/inviteCode'
import type { ConfirmOptions } from '../../lib/useConfirm'
import checkIcon from '../../assets/check.svg?raw'

// The actions that cannot be undone: rotating the invite code, leaving, and
// deleting the household. An owner sees delete, everyone else sees leave — the
// owner cannot leave a household they still own.
const props = defineProps({
  householdId: { type: String, default: '' },
  householdName: { type: String, default: '' },
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
  (e: 'refresh-household'): void
  (e: 'household-deleted'): void
  (e: 'household-left'): void
  (e: 'error', message: string, title?: string): void
}>()

const { userId } = useAuth()
const db = useSupabase()

const regenerating = ref(false)
const codeRegenerated = ref(false)
const leavingHousehold = ref(false)
const deletingHousehold = ref(false)

let regeneratedTimer: ReturnType<typeof setTimeout> | null = null
onBeforeUnmount(() => {
  if (regeneratedTimer) clearTimeout(regeneratedTimer)
})

async function regenerateInviteCode() {
  if (!props.householdId || regenerating.value) return
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
      .from('households')
      .update({ invite_code: randomInviteCode() })
      .eq('id', props.householdId)
    if (error) {
      // Includes the rare unique-index collision on the new code; retrying
      // draws a different one, which is what the message asks for.
      emit('error', userMessage(error, 'Could not regenerate the invite code. Please try again.'))
      return
    }
    emit('refresh-household')
    codeRegenerated.value = true
    if (regeneratedTimer) clearTimeout(regeneratedTimer)
    regeneratedTimer = setTimeout(() => {
      codeRegenerated.value = false
    }, 2000)
  } finally {
    regenerating.value = false
  }
}

async function leaveHousehold() {
  if (!props.householdId || leavingHousehold.value) return
  const confirmed = await props.confirm({
    title: 'Leave Household?',
    message: 'You will lose access to the shopping list and will need a new invite code to rejoin.',
    danger: true,
  })
  if (!confirmed) return
  leavingHousehold.value = true
  try {
    const { error } = await db
      .from('household_members')
      .delete()
      .eq('household_id', props.householdId)
      .eq('user_id', userId.value)
    if (error) {
      emit('error', userMessage(error, 'Could not leave the household.'))
      return
    }
    // HomeView moves to another household, or to setup if none remain.
    emit('household-left')
  } finally {
    leavingHousehold.value = false
  }
}

async function deleteHousehold() {
  if (!props.householdId || deletingHousehold.value) return
  const confirmed = await props.confirm({
    title: 'Delete Household?',
    message: `Deleting "${props.householdName}" will permanently remove all members, shopping list items, and history. This action cannot be undone.`,
    danger: true,
  })
  if (!confirmed) return
  deletingHousehold.value = true
  try {
    const { error } = await db.from('households').delete().eq('id', props.householdId)
    if (error) {
      emit('error', userMessage(error, 'Could not delete the household.'))
      return
    }
    // HomeView reconciles: switch to another household, or setup if none remain.
    emit('household-deleted')
  } finally {
    deletingHousehold.value = false
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
      <h4 class="panel-section-title text-danger">Leave Household</h4>
      <div class="card-item card-item--action">
        <div class="card-item__info">
          <p>This will remove you from the household. You will no longer have access to the shopping list.</p>
        </div>
        <button class="danger-action-btn" type="button" :disabled="leavingHousehold" @click="leaveHousehold">Leave Household</button>
      </div>
    </div>

    <!-- Delete (owner only) -->
    <div class="panel-section" v-if="isOwner">
      <h4 class="panel-section-title text-danger">Delete Household</h4>
      <div class="card-item card-item--action card-item--danger">
        <div class="card-item__info">
          <p>Permanently deletes <strong>{{ householdName }}</strong>, removes all members, and erases all shopping list data. This cannot be undone.</p>
        </div>
        <button
          class="danger-action-btn danger-action-btn--delete"
          type="button"
          :disabled="deletingHousehold"
          @click="deleteHousehold"
        >
          <span v-if="deletingHousehold" class="btn-spinner btn-spinner--light"></span>
          <span v-else>Delete Household</span>
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
  color: var(--text-primary);
}

.card-item__info p {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-secondary);
  line-height: 1.45;
}

.panel-action-btn {
  background: var(--bg-surface);
  color: var(--text-primary);
  border: var(--border-width-thin) solid var(--border-main);
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
  /* Same reason as .danger-action-btn below: nowrap without flex-shrink:0 spills
     rather than wraps. "Regenerated" is wider than "Regenerate", so this one can
     overflow at the moment it succeeds. */
  flex-shrink: 0;
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
  /* Pairs with white-space:nowrap. Without it this is an ordinary flex item and
     will shrink under its own label, which nowrap then spills outside the button
     rather than wrapping. The paragraph beside it is the part meant to give way.
     Latent until "Delete Family" became "Delete Household" and the label got
     wide enough to cross the threshold. */
  flex-shrink: 0;
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
