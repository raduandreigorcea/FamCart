<script setup lang="ts">
import { computed, type PropType } from 'vue'
import AppModal from './AppModal.vue'
import ModalCloseButton from './ModalCloseButton.vue'
import userRoundIconRaw from '../assets/user-round.svg?raw'
import flagIconRaw from '../assets/flag.svg?raw'
// One icon per row, and each one distinct: their job here is to tell four
// near-identically shaped rows apart at a glance, so a repeat would cost more
// than it buys. They name the destination rather than the dialog it opens --
// a house for the household, a gear for the app -- which is also what keeps
// them apart, since both of those dialogs wear the same gear in their headers.
import houseIconRaw from '../assets/house.svg?raw'
import userRoundPlusIconRaw from '../assets/user-round-plus.svg?raw'
import gearIconRaw from '../assets/settings.svg?raw'
import plusIconRaw from '../assets/plus.svg?raw'
import logOutIconRaw from '../assets/log-out.svg?raw'
import { DEFAULT_HOUSEHOLD_EMOJI } from '../lib/householdEmoji'
import { HOUSEHOLD_MEMBERSHIP_CAP } from '../lib/limits'

// Who is signed in, and the ways out of here. Appearance and notifications used
// to live in this dialog; they are settings for the app on this device rather
// than for the person, so they moved to AppSettingsModal and this now offers a
// row leading there.
//
// Switching households lives here too. It used to be the topbar's own popover,
// hung off the household name -- but a user may belong to at most three
// households and may own only one, so most people have exactly one for the life
// of the account. That made the most prominent control in the app a menu whose
// only real content, nearly always, was a single already-ticked row. The name up
// there now opens that household's settings directly, and switching sits in the
// dialog you open when you want to move between things rather than act on the
// one in front of you.
const props = defineProps({
  open: { type: Boolean, default: false },
  loadingSignOut: { type: Boolean, default: false },
  avatarUrl: { type: String, default: '' },
  displayName: { type: String, default: 'Account' },
  email: { type: String, default: '' },
  initial: { type: String, default: '?' },
  householdName: { type: String, default: '' },
  householdMemberCount: { type: Number, default: 0 },
  // Every household the user belongs to, and which one is active.
  households: {
    type: Array as PropType<{ id: string; name: string; emoji?: string | null }[]>,
    default: () => [],
  },
  householdId: { type: String, default: '' },
})

// The household rows below lead somewhere the topbar also reaches directly. That
// is deliberate: people look for the same thing in different places, and a
// second route costs a row here while saving someone a hunt.
const emit = defineEmits([
  'close',
  'edit-account',
  'report-issue',
  'sign-out',
  'manage-household',
  'invite-members',
  'app-settings',
  'switch-household',
  'add-household',
])

// Only worth listing when there is somewhere to go: with one household the rows
// would be a single row you are already on.
const canSwitch = computed(() => props.households.length > 1)
// At the cap there is nowhere to add another.
const canAddHousehold = computed(() => props.households.length < HOUSEHOLD_MEMBERSHIP_CAP)
// The section earns its heading and divider only if it has something in it.
const showHouseholdSection = computed(() => canSwitch.value || canAddHousehold.value)

function switchHousehold(id: string) {
  if (id === props.householdId) {
    emit('close')
    return
  }
  emit('switch-household', id)
}

</script>

<template>
  <AppModal
    :open="open"
    overlay-class="account-overlay"
    transition="modal-fade"
    @close="emit('close')"
  >
      <div class="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-modal-title">
        <div class="account-dialog__header">
          <div class="account-dialog__title-wrap">
            <div class="account-dialog__icon-bg">
              <span class="account-header-icon" aria-hidden="true" v-html="userRoundIconRaw"></span>
            </div>
            <div>
              <h3 id="account-modal-title">Account Settings</h3>
              <p class="account-dialog__subtitle">Manage your profile and preferences</p>
            </div>
          </div>
          <ModalCloseButton aria-label="Close account modal" @click="emit('close')" />
        </div>

        <div class="account-dialog__body">
          <div class="account-user-card">
            <div class="account-user-card__avatar-wrap">
              <img v-if="avatarUrl" :src="avatarUrl" alt="Profile picture" class="account-user-card__avatar" />
              <span v-else class="account-user-card__avatar account-user-card__avatar--fallback">{{ initial }}</span>
            </div>
            <div class="account-user-card__identity">
              <h4>{{ displayName }}</h4>
              <p>{{ email || 'No email available' }}</p>
            </div>
          </div>

          <div class="account-section">
            <button class="account-menu-item" type="button" @click="emit('edit-account')">
              <span class="account-menu-item__label">
                <span class="account-item-icon" aria-hidden="true" v-html="userRoundIconRaw"></span>
                <span>Profile</span>
              </span>
              <span class="account-menu-item__hint">Name, photo, password</span>
            </button>
            <button class="account-menu-item" type="button" @click="emit('manage-household')">
              <span class="account-menu-item__label">
                <span class="account-item-icon" aria-hidden="true" v-html="houseIconRaw"></span>
                <span>Manage household</span>
              </span>
              <span class="account-menu-item__hint">{{ householdName || 'Household' }}</span>
            </button>
            <button class="account-menu-item" type="button" @click="emit('invite-members')">
              <span class="account-menu-item__label">
                <span class="account-item-icon" aria-hidden="true" v-html="userRoundPlusIconRaw"></span>
                <span>Invite people</span>
              </span>
              <span class="account-menu-item__hint">
                {{ householdMemberCount }} {{ householdMemberCount === 1 ? 'member' : 'members' }}
              </span>
            </button>

            <button class="account-menu-item" type="button" @click="emit('app-settings')">
              <span class="account-menu-item__label">
                <span class="account-item-icon" aria-hidden="true" v-html="gearIconRaw"></span>
                <span>App settings</span>
              </span>
              <span class="account-menu-item__hint">Appearance, notifications, about</span>
            </button>

            <!-- Households you can move to, and the way to gain another. Absent
                 entirely for someone with one household and no room for more,
                 which is the only state where neither row has anything to do. -->
            <template v-if="showHouseholdSection">
              <div class="account-divider"></div>

              <button
                v-for="household in (canSwitch ? households : [])"
                :key="household.id"
                class="account-menu-item account-household-item"
                type="button"
                role="menuitemradio"
                :aria-checked="household.id === householdId"
                @click="switchHousehold(household.id)"
              >
                <span class="account-menu-item__label">
                  <span class="account-household-emoji" aria-hidden="true">
                    {{ household.emoji || DEFAULT_HOUSEHOLD_EMOJI }}
                  </span>
                  <span class="account-household-name">{{ household.name || 'Household' }}</span>
                </span>
                <span v-if="household.id === householdId" class="account-menu-item__hint">Current</span>
              </button>

              <button
                v-if="canAddHousehold"
                class="account-menu-item account-household-add"
                type="button"
                @click="emit('add-household')"
              >
                <span class="account-menu-item__label">
                  <span class="account-item-icon" aria-hidden="true" v-html="plusIconRaw"></span>
                  <span>Join or create a household</span>
                </span>
              </button>
            </template>

            <div class="account-divider"></div>

            <!-- Sits with sign out rather than with the rows above it: those
                 four lead further into the app, these two are the ways of
                 stepping outside it. -->
            <button
              class="account-menu-item account-report-item"
              type="button"
              @click="emit('report-issue')"
            >
              <span class="account-menu-item__label">
                <span class="account-item-icon" aria-hidden="true" v-html="flagIconRaw"></span>
                <span>Report an issue</span>
              </span>
              <span class="account-menu-item__hint">Bugs and feedback</span>
            </button>

            <button
              class="account-menu-item account-menu-item--danger"
              type="button"
              :disabled="loadingSignOut"
              @click="emit('sign-out')"
            >
              <!-- The spinner takes the icon's place rather than the whole
                   label's: signing out is the one action here that can hang on
                   the network, and the row that used to empty to a bare spinner
                   stopped saying which action was in flight. The name carries
                   through instead. -->
              <span class="account-menu-item__label account-menu-item__label--danger">
                <span v-if="loadingSignOut" class="account-spinner" aria-hidden="true"></span>
                <span v-else class="account-item-icon" aria-hidden="true" v-html="logOutIconRaw"></span>
                <span>{{ loadingSignOut ? 'Signing out' : 'Sign out' }}</span>
              </span>
            </button>
          </div>
        </div>
      </div>
  </AppModal>
</template>

<style scoped>
.account-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-dark);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
  padding: calc(var(--space-4) + var(--safe-top)) var(--space-4) calc(var(--space-4) + var(--safe-bottom));
}

.account-dialog {
  width: 100%;
  /* Wider than the 360px it opened at. Every row now spends 24px of its width on
     an icon and its gap before the label starts, while the hint still holds the
     right edge — so the two were meeting in the middle on the longest rows
     ("App settings" against "Appearance, notifications, about"). The sheet below
     520px is unaffected; it has been full-width all along. */
  max-width: 420px;
  background: var(--bg-surface);
  border: none;
  border-radius: var(--radius-dialog);
  box-shadow: var(--elevation-modal);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.account-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--bg-surface);
}

.account-dialog__title-wrap {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.account-dialog__icon-bg {
  width: 38px;
  height: 38px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-primary) 10%, var(--bg-surface));
  color: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.account-header-icon {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.account-header-icon :deep(svg) {
  width: 100%;
  height: 100%;
  stroke: currentColor;
  stroke-width: 2;
  fill: none;
}

.account-dialog__header h3 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--weight-extrabold);
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.account-dialog__subtitle {
  margin: 0.1rem 0 0;
  font-size: var(--text-xs);
  color: var(--text-secondary);
  font-weight: var(--weight-medium);
}

.account-dialog__body {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.account-user-card {
  display: flex;
  align-items: flex-start;
  gap: 0.8rem;
  background: var(--bg-surface-alt);
  border-radius: var(--radius-lg);
  padding: 0.9rem 0.9rem 0.65rem;
}

.account-user-card__avatar-wrap {
  position: relative;
}

.account-user-card__avatar {
  width: 52px;
  height: 52px;
  border-radius: var(--radius-pill);
  object-fit: cover;
  border: var(--border-width-base) solid var(--bg-surface);
  box-shadow: var(--elevation-soft);
  flex-shrink: 0;
}

.account-user-card__avatar--fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-lg);
  font-weight: var(--weight-extrabold);
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 16%, var(--bg-surface));
}

.account-user-card__identity {
  min-width: 0;
}

.account-user-card__identity h4 {
  margin: 0;
  font-size: var(--text-md);
  font-weight: var(--weight-extrabold);
  color: var(--text-primary);
  letter-spacing: -0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.account-user-card__identity p {
  margin: 0.12rem 0 0;
  font-size: var(--text-xs);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}


.account-divider {
  height: 1px;
  background: var(--border-main);
  margin-block: var(--space-2);
}

.account-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.account-menu-item {
  width: 100%;
  border: var(--border-width-thin) solid var(--border-main);
  background: var(--bg-surface);
  border-radius: var(--radius-md);
  padding: 0.65rem 0.75rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
  text-align: left;
  cursor: pointer;
  transition: background var(--transition-base) ease, border-color var(--transition-base) ease;
}

.account-menu-item:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: color-mix(in srgb, var(--color-primary) 45%, var(--bg-surface));
}

.account-menu-item:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

/* Every row leads with an icon now, so the row/icon layout lives here rather
   than being re-declared per row. min-width:0 is what lets a long household
   name ellipsize inside it. */
.account-menu-item__label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  color: var(--text-primary);
}

.account-item-icon {
  width: 16px;
  height: 16px;
  color: var(--text-secondary);
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.account-item-icon :deep(svg) {
  width: 100%;
  height: 100%;
  stroke: currentColor;
  /* The assets ship at mixed stroke widths — flag.svg at 1 reads as a hairline
     next to the bold row labels — so the weight is set here for all of them. */
  stroke-width: 2;
  fill: none;
}

/* The icon warms with the row, so the whole row answers a hover as one thing
   rather than the border moving while the mark stays grey. */
.account-menu-item:hover:not(:disabled) .account-item-icon {
  color: var(--color-primary);
}

.account-menu-item__label--danger {
  color: var(--text-inverse);
}

.account-menu-item__hint {
  font-size: var(--text-xs);
  color: var(--text-secondary);
  flex-shrink: 0;
}

/* A household wears its own emoji where the other rows wear an icon — same slot,
   same gap, but a bigger tile, because it identifies one particular household
   rather than naming a kind of destination. */
.account-household-emoji {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-lg);
  line-height: 1;
  background: var(--bg-surface-alt);
}

.account-household-item:hover .account-household-emoji {
  background: var(--bg-surface);
}

/* Names run to 25 characters and "Current" must survive beside them. */
.account-household-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Gaining a household is not one of the households, so the row is quieter than
   the ones above it -- the same distinction the panel it replaces drew with a
   dashed tile. */
.account-household-add .account-menu-item__label {
  color: var(--text-secondary);
  font-weight: var(--weight-semibold);
}

.account-menu-item--danger {
  border: none;
  background: var(--danger-solid);
  color: var(--text-inverse);
  box-shadow: var(--elevation-danger-subtle);
}

.account-menu-item--danger:hover:not(:disabled) {
  background: var(--danger-solid-hover);
  border-color: transparent;
  box-shadow: var(--elevation-danger-hover);
}

.account-menu-item--danger:disabled {
  opacity: 0.5;
}

/* The mark rides on the solid fill here, so it takes the label's inverse colour
   instead of the muted grey the pale rows use — and it must not warm to green
   on hover the way they do, which is why the hover state is restated. */
.account-menu-item--danger .account-item-icon,
.account-menu-item--danger:hover:not(:disabled) .account-item-icon {
  color: var(--text-inverse);
}












.account-spinner {
  /* Same box as .account-item-icon, which it stands in for: at 14px the label
     shifted two pixels left the moment sign-out started. */
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border: var(--border-width-thick) solid color-mix(in srgb, var(--text-inverse) 45%, transparent);
  border-top-color: var(--text-inverse);
  border-radius: 50%;
  display: inline-block;
  animation: account-spin 0.7s linear infinite;
}

@keyframes account-spin {
  to {
    transform: rotate(360deg);
  }
}

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity var(--transition-base) ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-fade-enter-active .account-dialog {
  animation: modal-rise-in var(--transition-slow) var(--ease-rise) forwards;
}

.modal-fade-leave-active .account-dialog {
  animation: modal-rise-out var(--transition-base) var(--ease-fall) forwards;
}

@media (max-width: 520px) {
  .account-overlay {
    align-items: flex-end;
    padding: 0;
  }

  .account-dialog {
    max-width: none;
    border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
    padding-bottom: calc(1rem + env(safe-area-inset-bottom));
    /* Flush with the bottom edge, so it can travel its full height and start
       off screen rather than merely nudging up. */
    --modal-rise: 100%;
  }
}
</style>
