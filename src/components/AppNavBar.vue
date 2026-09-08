<script setup lang="ts">
import { computed, defineAsyncComponent, ref, type PropType } from 'vue'
import { useClerk, useUser } from '@clerk/vue'
import AccountActionModal from './AccountActionModal.vue'
import AppIcon from './AppIcon.vue'
import MemberAvatarStack from './MemberAvatarStack.vue'
import SkeletonBlock from './SkeletonBlock.vue'
import { sortMembersSelfFirst } from '../lib/memberRoles'
import type { HouseholdMemberProfile } from '../lib/householdRealtime'
import { DEFAULT_HOUSEHOLD_EMOJI } from '../lib/householdEmoji'
import { ITEM_LIMIT_DEFAULT } from '../lib/limits'
import { getUserDisplayName, getUserInitial, getUserPrimaryEmail } from '../lib/userIdentity'
import { forgetLocalUserState } from '../lib/session'
import { logoutPushUser } from '../lib/pushNotifications'
import { captureException, identifyUser } from '../lib/errorReporting'
import { shareInvite } from '../lib/inviteShare'

// The settings modal is by far the heaviest part of the topbar; load its chunk
// only when someone actually opens it.
//
// The loaders are named rather than inlined so the press handlers below can call
// them directly. Fetching the chunk at click time meant the first tap on either
// of these opened nothing at all until the request came back -- the button had
// been pressed, the dialog was mounted with open:true, and the screen sat there.
// Starting on pointerdown buys the whole press-and-release, and on a phone that
// is most of the round trip.
const loadHouseholdSettingsModal = () => import('./HouseholdSettingsModal.vue')
const HouseholdSettingsModal = defineAsyncComponent(loadHouseholdSettingsModal)
// Same treatment for the purchase-history modal: fetched and rendered on demand.
const loadPurchaseHistoryModal = () => import('./PurchaseHistoryModal.vue')
const PurchaseHistoryModal = defineAsyncComponent(loadPurchaseHistoryModal)
// Reporting is rare and its chunk pulls in the report library, so it stays out
// of the initial download like the two above.
const ReportIssueModal = defineAsyncComponent(() => import('./ReportIssueModal.vue'))

// Warm a modal's chunk ahead of the click. The bundler dedupes the dynamic
// import, so the real open reuses this request instead of starting a second one.
// Rejections are swallowed: a prefetch that fails must not surface as an
// unhandled rejection, and the open path re-runs the import and reports properly.
function prefetch(load: () => Promise<unknown>) {
  void load().catch(() => {})
}
// App settings is NOT lazy. It owns the theme, which has to be applied on boot
// rather than the first time someone opens the dialog — deferring the chunk
// would leave the app in the wrong theme until then.
import AppSettingsModal from './AppSettingsModal.vue'
import { t } from '../lib/i18n'
import { IS_NIGHTLY } from '../lib/appChannel'

const props = defineProps({
  // Which of this component's two shells to draw.
  //
  // 'bar' is the list screen: a fixed bottom action bar on a phone, and the
  // header below at 900px and up. 'header' is the header at every width, which
  // is what HouseholdSetupView wants — there is no household there yet, so a bar
  // offering household settings, checkout history and an add button would be
  // four controls with nothing behind them.
  //
  // Both shells live in one component because the five dialogs do. Splitting the
  // markup into two components would mean either two copies of that state or a
  // third component holding it, and the dialogs are most of this file.
  layout: { type: String as PropType<'bar' | 'header'>, default: 'header' },
  householdId: { type: String, default: '' },
  householdName: { type: String, default: '' },
  // Every household the user belongs to ({ id, name }); the account dialog lists
  // them so you can move between them.
  households: {
    type: Array as PropType<{ id: string; name: string; emoji?: string | null }[]>,
    default: () => [],
  },
  loading: { type: Boolean, default: false },
  // True mid household-switch: the name is already known, but the roster isn't yet,
  // so the avatar stack under it shows a skeleton rather than a stale set of
  // faces from the household being switched away from.
  membersLoading: { type: Boolean, default: false },
  inviteCode: { type: String, default: '' },
  householdItemLimit: { type: Number, default: ITEM_LIMIT_DEFAULT },
  householdEmoji: { type: String, default: '' },
  ownerUserId: { type: String, default: '' },
  currentUserId: { type: String, default: '' },
  memberProfiles: {
    type: Array as PropType<HouseholdMemberProfile[]>,
    default: () => [],
  },
})

const emit = defineEmits([
  'refresh-household',
  'household-deleted',
  'household-left',
  'switch-household',
  'add-household',
  // The bar's centre button. The search itself belongs to AddItemForm and its
  // open state is HomeView's `searchExpanded`, so the bar only says it was
  // pressed rather than owning anything.
  'add',
])

function selectHousehold(id: string) {
  accountMenuOpen.value = false
  if (id !== props.householdId) emit('switch-household', id)
}
function addHousehold() {
  accountMenuOpen.value = false
  emit('add-household')
}

const clerk = useClerk()
const { user } = useUser()

const accountMenuOpen = ref(false)
const signingOut = ref(false)

const settingsOpen = ref(false)
// Stays true after the first open so the async chunk keeps its close transition.
const settingsEverOpened = ref(false)

const appSettingsOpen = ref(false)

const historyOpen = ref(false)
const historyEverOpened = ref(false)

const reportOpen = ref(false)
const reportEverOpened = ref(false)

function openAppSettings() {
  accountMenuOpen.value = false
  appSettingsOpen.value = true
}

function openHistory() {
  historyEverOpened.value = true
  historyOpen.value = true
}

function openAccountMenu() {
  accountMenuOpen.value = true
}

function openAccountSettings() {
  accountMenuOpen.value = false
  clerk.value?.openUserProfile()
}

function openReportIssue() {
  accountMenuOpen.value = false
  reportEverOpened.value = true
  reportOpen.value = true
}

// Two doors lead here — the household block in the bar and the account dialog —
// because people reach for different ones. They both land on the same dialog, so
// each just closes whatever it was opened from.
function openHouseholdSettings() {
  accountMenuOpen.value = false
  settingsEverOpened.value = true
  settingsOpen.value = true
}

// Hands the invite to whatever the device sends things with: the share sheet on
// a phone, the clipboard on a desktop. See lib/inviteShare for why that is three
// paths rather than one.
//
// Not awaited before the call — the web share sheet only opens inside the user
// activation from the tap, and an await here would spend it.
function inviteMembersFromAccountMenu() {
  if (!props.inviteCode) {
    // No code to send yet. The overview panel is where one is minted, so that is
    // where this has to end up.
    openHouseholdSettings()
    return
  }

  void shareInvite(props.householdName, props.inviteCode).then((outcome) => {
    // Backing out of the sheet is an answer, not a failure: stay exactly where
    // they were so a second try is one tap away.
    if (outcome === 'cancelled') return
    if (outcome === 'unavailable') {
      openHouseholdSettings()
      return
    }
    accountMenuOpen.value = false
  })
}

async function handleSignOut() {
  if (signingOut.value) return
  signingOut.value = true
  try {
    // Drop the cached session and local data so the offline-boot path and the
    // snapshot can't resurrect this account after signing out. The list of what
    // that means lives in lib/session, next to the thing that writes the first
    // entry — spelled out here, it was one key short.
    //
    // Scoped to this account where the topbar knows it. On the setup screen it
    // renders without props and currentUserId is '', which clears every FamCart
    // queue and snapshot on the device instead — the safer answer when we cannot
    // say whose this is.
    forgetLocalUserState(localStorage, props.currentUserId || undefined)
    // Detach the account from error reporting for the same reason. Sentry's
    // setUser is sticky module state, not per-event, so anything raised after
    // this point would still be filed under the person who just left. The
    // redirect below usually tears the page down before that can happen -- but
    // it is a redirect Clerk performs, and the catch below exists precisely
    // because it does not always get there.
    identifyUser(null)
    // Unlink this device in OneSignal so the next account's pushes don't land
    // on top of the old one's. Best-effort; sign-out must not wait on the CDN.
    void logoutPushUser()
    await clerk.value?.signOut({ redirectUrl: `${window.location.origin}/login` })
    accountMenuOpen.value = false
  } catch (error) {
    // The local data is already cleared by this point, so the session is
    // effectively over either way; what failed is Clerk's own teardown, which
    // is worth knowing about but not worth a dialog on the way out.
    captureException(error)
  } finally {
    signingOut.value = false
  }
}

// Offline (cold-booted from cache) Clerk can't load, so `user` is null. The
// cached household roster still holds this user's profile, so fall back to it for
// the account button and menu rather than showing an empty "Account".
const cachedProfile = computed(() =>
  props.currentUserId
    ? props.memberProfiles.find((m) => m.user_id === props.currentUserId) || null
    : null,
)

const userAvatarUrl = computed(() => user.value?.imageUrl || cachedProfile.value?.image_url || '')
const userDisplayName = computed(
  () => getUserDisplayName(user.value) || cachedProfile.value?.display_name || t('account.fallbackName'),
)
const userEmail = computed(() => getUserPrimaryEmail(user.value))
const userInitial = computed(() => {
  const clerkInitial = user.value ? getUserInitial(user.value) : ''
  if (clerkInitial && clerkInitial !== '?') return clerkInitial
  const name = cachedProfile.value?.display_name
  return name ? name.slice(0, 1).toUpperCase() : '?'
})

const memberCount = computed(() => props.memberProfiles.length)

// The emoji the owner picked for this household. It already identifies each row
// inside the panel; showing it on the bar too means the thing you tap and the
// row you land on are the same object, and gives the left-hand block a fixed
// anchor to start from instead of beginning with ragged text.
const activeHouseholdEmoji = computed(() => props.householdEmoji || DEFAULT_HOUSEHOLD_EMOJI)

// The active household's members, ordered for the stack that sits under the name.
const orderedActiveMembers = computed(() =>
  sortMembersSelfFirst(props.memberProfiles || [], props.ownerUserId, props.currentUserId),
)
</script>

<template>
  <!-- The list screen's shell on a phone. Five slots, and none of them is ever
       the current one: there is a single route behind all of this, so a
       selected state would be pointing at the page you are already on. It is an
       action bar wearing a tab bar's shape, and the shape is where the
       resemblance stops.

       Two of the five marks are the user's own things rather than icons — the
       household's emoji and their avatar — which is also what makes the first
       slot answer "which household" for somebody in more than one. -->
  <nav v-if="layout === 'bar'" class="navbar" :aria-label="t('nav.label')">
    <button
      class="nav-slot"
      type="button"
      aria-haspopup="dialog"
      :aria-expanded="settingsOpen"
      @pointerdown="prefetch(loadHouseholdSettingsModal)"
      @click="openHouseholdSettings"
    >
      <span class="nav-slot__mark nav-slot__mark--emoji" aria-hidden="true">
        {{ activeHouseholdEmoji }}
      </span>
      <span class="nav-slot__label">{{ t('nav.household') }}</span>
    </button>

    <button
      class="nav-slot"
      type="button"
      aria-haspopup="dialog"
      :aria-expanded="historyOpen"
      @pointerdown="prefetch(loadPurchaseHistoryModal)"
      @click="openHistory"
    >
      <span class="nav-slot__mark">
        <AppIcon name="history" />
      </span>
      <span class="nav-slot__label">{{ t('nav.history') }}</span>
    </button>

    <!-- The disc stays inside the bar's top edge. A notched, protruding FAB is
         the default here and it would have collided with the checkout slider,
         which is the one thing on this screen with a stronger claim to the
         bottom edge. A solid green knob riding a neutral track is already this
         app's vocabulary — see .buy-bar__thumb — so the bar borrows from the
         slider rather than from Material.

         aria-label carries the full sentence; the visible label is only the
         verb, because it has to fit under a 44px disc in six languages. -->
    <button
      class="nav-slot nav-slot--add"
      type="button"
      :aria-label="t('nav.addLabel')"
      @click="emit('add')"
    >
      <span class="nav-add__disc" aria-hidden="true">
        <AppIcon name="add" />
      </span>
      <span class="nav-slot__label">{{ t('nav.add') }}</span>
    </button>

    <!-- Holds the fifth column's width so the four real slots sit where they
         will still sit once something fills it. An empty cell rather than a
         disabled button: a disabled control promises something is coming, and
         nothing is, yet.

         Until then it carries the nightly stamp, which needs somewhere that is
         on screen whatever you are doing and lost its old home when the topbar
         became desktop-only. A build channel has to be obvious in a screenshot
         with no chrome in it, so that nobody debugs the wrong database for an
         hour. Untranslated on purpose, like the manifest: it names a build
         channel, not anything the app does. -->
    <span class="nav-slot nav-slot--empty">
      <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- build channel, the same word in every language -->
      <span v-if="IS_NIGHTLY" class="nav-channel">NIGHTLY</span>
    </span>

    <button
      class="nav-slot"
      type="button"
      aria-haspopup="dialog"
      :aria-expanded="accountMenuOpen"
      @click="openAccountMenu"
    >
      <span class="nav-slot__mark nav-slot__mark--avatar">
        <img
          v-if="userAvatarUrl"
          :src="userAvatarUrl"
          :alt="t('topbar.avatarAlt')"
          class="nav-avatar-img"
        />
        <span v-else class="nav-avatar-fallback" aria-hidden="true">{{ userInitial }}</span>
      </span>
      <span class="nav-slot__label">{{ t('nav.you') }}</span>
    </button>
  </nav>

  <header class="topbar" :class="{ 'topbar--desktop-only': layout === 'bar' }">
    <div class="topbar-left">
      <template v-if="householdName">
        <!-- The household you are looking at, and the way into its settings. One
             destination, not a menu: with at most three households and only one
             ownable, nearly every account has exactly one, so a menu here spent
             the bar's best position on a list of one. Switching moved to the
             account dialog, where it only appears once there is somewhere to go.
             The faces under the name lead to the members panel inside, which is
             where you would go to change them. -->
        <button
          class="household-btn"
          type="button"
          :aria-label="t('topbar.householdSettings', { name: householdName })"
          @pointerdown="prefetch(loadHouseholdSettingsModal)"
          @click="openHouseholdSettings"
        >
          <span class="household-emoji" aria-hidden="true">{{ activeHouseholdEmoji }}</span>
          <div class="household-info">
            <p class="household-name">{{ householdName }}</p>
            <div class="household-subrow">
              <MemberAvatarStack :members="orderedActiveMembers" :loading="membersLoading" />
            </div>
          </div>
        </button>
      </template>
      <template v-else-if="loading">
        <!-- Stands in for the real block above, tile included: without the
             square the name and the faces would start at the left edge and then
             jump right by its width the moment the household lands. -->
        <div class="household-meta" aria-hidden="true">
          <SkeletonBlock class="household-emoji-skeleton" width="34px" height="34px" radius="var(--radius-md)" />
          <div class="household-info">
            <SkeletonBlock width="7.5rem" height="1rem" />
            <div class="household-subrow">
              <MemberAvatarStack loading />
            </div>
          </div>
        </div>
      </template>
      <template v-else>
        <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- brand name, the same in every language -->
        <img src="/icons/pwa-192.png" alt="FamCart" class="topbar-logo" />
      </template>
    </div>

    <div class="topbar-actions">
      <!-- The nightly build says so, in the one place that is on screen whatever
           you are doing. Sits at the head of the actions rather than beside the
           household name, which ellipsizes and would have had to give up width
           for it. Untranslated on purpose, like the manifest: it names a build
           channel, not anything the app does. -->
      <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- build channel, the same word in every language -->
      <span v-if="IS_NIGHTLY" class="channel-badge">NIGHTLY</span>

      <button
        v-if="householdName"
        class="topbar-icon-btn"
        type="button"
        :aria-label="t('topbar.history')"
        @pointerdown="prefetch(loadPurchaseHistoryModal)"
        @click="openHistory"
      >
        <span class="history-icon" aria-hidden="true"></span>
      </button>

      <button
        class="user-avatar-btn"
        type="button"
        :aria-label="t('topbar.account')"
        @click="openAccountMenu"
      >
        <img
          v-if="userAvatarUrl"
          :src="userAvatarUrl"
          :alt="t('topbar.avatarAlt')"
          class="user-avatar-img"
        />
        <span v-else class="user-avatar-fallback">{{ userInitial }}</span>
      </button>
    </div>
  </header>


  <PurchaseHistoryModal
    v-if="historyEverOpened"
    :open="historyOpen"
    :household-id="householdId"
    :current-user-id="currentUserId"
    :member-profiles="memberProfiles"
    @close="historyOpen = false"
  />

  <HouseholdSettingsModal
    v-if="settingsEverOpened"
    :open="settingsOpen"
    :household-id="householdId"
    :household-name="householdName"
    :invite-code="inviteCode"
    :household-item-limit="householdItemLimit"
    :household-emoji="householdEmoji"
    :owner-user-id="ownerUserId"
    :member-profiles="memberProfiles"
    @close="settingsOpen = false"
    @refresh-household="emit('refresh-household')"
    @household-deleted="emit('household-deleted')"
    @household-left="emit('household-left')"
  />

  <AccountActionModal
    :open="accountMenuOpen"
    :loading-sign-out="signingOut"
    :avatar-url="userAvatarUrl"
    :display-name="userDisplayName"
    :email="userEmail"
    :initial="userInitial"
    :household-name="householdName"
    :household-member-count="memberCount"
    :households="households"
    :household-id="householdId"
    @close="accountMenuOpen = false"
    @edit-account="openAccountSettings"
    @manage-household="openHouseholdSettings"
    @invite-members="inviteMembersFromAccountMenu"
    @app-settings="openAppSettings"
    @report-issue="openReportIssue"
    @switch-household="selectHousehold"
    @add-household="addHousehold"
    @sign-out="handleSignOut"
  />

  <ReportIssueModal
    v-if="reportEverOpened"
    :open="reportOpen"
    :household-id="householdId"
    :user-id="currentUserId"
    @close="reportOpen = false"
  />

  <AppSettingsModal :open="appSettingsOpen" @close="appSettingsOpen = false" />
</template>

<style scoped>
/* ─── The bottom action bar ──────────────────────────────────────────────────
   Five equal cells and one baseline. Every slot is a bottom-aligned column, so
   the labels line up whatever sits above them: a 26px mark in four of them and
   a 44px disc in the fifth. That is the whole layout, and it is why the disc
   can be much bigger than the icons without needing a position of its own. */
.navbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  align-items: stretch;
  height: calc(var(--nav-height) + var(--safe-bottom));
  /* The surface runs down behind the phone's home bar, the way the topbar's
     runs up behind the status bar. */
  padding-bottom: var(--safe-bottom);
  background: var(--bg-surface);
  border-top: var(--border-width-thin) solid var(--border-main);
}

/* Below the checkout slider (z-index 50), which has to stay reachable while the
   bar is on screen, and above the list. */

.nav-slot {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 3px;
  padding: 0 0.25rem 0.5rem;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--transition-fast), color var(--transition-fast),
    transform var(--transition-fast) var(--ease-rise);
}

.nav-slot--empty {
  cursor: default;
  /* Centred rather than bottom-aligned like the four real slots: there is no
     mark above a label here, only the stamp, and sitting it on the label
     baseline would leave it hanging off the bottom of an otherwise empty cell. */
  justify-content: center;
  padding-bottom: 0;
}

/* A stamp, not a control: no press state and no tap target, because there is
   nothing to do with it. Drawn from the brand tokens, which the nightly channel
   has already re-pointed to indigo, so it matches the bar it marks rather than
   fighting it. Same shape it wore in the topbar. */
.nav-channel {
  padding: 0.15rem 0.35rem;
  border: 1px solid color-mix(in srgb, var(--color-primary) 45%, transparent);
  border-radius: var(--radius-xs);
  background: var(--color-primary-bg);
  color: var(--color-primary-text);
  font-size: 0.5625rem;
  font-weight: var(--weight-extrabold);
  letter-spacing: 0.06em;
  line-height: 1.5;
}

.nav-slot__mark {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

/* AppIcon renders a bare <span> around the SVG and deliberately carries no
   styles of its own, so left alone that span is an inline box and the icon
   inside it sits on a text baseline. That put every mark in this bar a few
   pixels high with a descender's worth of dead space beneath it, which reads as
   the icons floating away from their labels. Both halves are needed: the span
   has to stop being a line box, and the SVG has to stop being inline content. */
.nav-slot__mark > span,
.nav-add__disc > span {
  display: flex;
}

.nav-slot__mark :deep(svg) {
  display: block;
  width: 24px;
  height: 24px;
  /* Actual thickness is stroke-width x rendered / 24, because the sources all
     share a 24-unit viewBox — so the number here says nothing on its own and
     the app's other icons are the only scale worth reading it against. The
     filter button paints 1.25px, an armed swipe action 2px. These are resting
     chrome sitting beside an emoji and a photograph, so 1.5px: heavier than the
     hairline the assets ship at, lighter than anything asking to be noticed. */
  stroke-width: 1.5;
}

.nav-slot__mark--emoji {
  font-size: 1.25rem;
  line-height: 1;
}

.nav-slot__mark--avatar {
  border-radius: var(--radius-pill);
  border: var(--border-width-thin) solid var(--border-main);
  background: var(--bg-hover);
  overflow: hidden;
}

.nav-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.nav-avatar-fallback {
  font-size: var(--text-2xs);
  font-weight: var(--weight-bold);
  color: var(--text-secondary);
}

.nav-slot__label {
  font-size: var(--text-2xs);
  font-weight: var(--weight-semibold);
  line-height: var(--leading-tight);
  letter-spacing: 0;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ─── The centre disc ────────────────────────────────────────────────────────
   The only saturated thing along the bottom edge of the screen, and the only
   place in this bar where boldness is spent. Nothing else here is coloured. */
.nav-add__disc {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-pill);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-primary);
  color: var(--text-inverse);
  box-shadow: var(--elevation-primary);
  transition: transform var(--transition-fast) var(--ease-rise),
    box-shadow var(--transition-fast);
}

/* The one mark in the bar that should be noticed, so it stays the heaviest:
   2.7px against the small slots' 1.5. add.svg ships at 3, which on a filled
   disc this size reads as a slab rather than a plus. */
.nav-add__disc :deep(svg) {
  display: block;
  width: 26px;
  height: 26px;
  stroke-width: 2.5;
}

.nav-slot--add .nav-slot__label {
  color: var(--color-primary);
}

/* ─── How the bar answers a press ────────────────────────────────────────────
   The same rule the header below uses, for the same two reasons written out
   there: the press is not transitioned on the way in, because easing into a
   pressed state is how a button comes to feel slower than the finger; and it
   moves to --bg-press, which is a real step away from the surface in both
   themes where --border-light was not.

   The fill is a pill behind the mark rather than the whole cell: a full-height
   rectangle lighting up under a thumb reads as the bar breaking into panels. */
.nav-slot:not(.nav-slot--empty):active {
  color: var(--text-primary);
  transform: scale(0.92);
  transition-duration: 0s;
}

.nav-slot:not(.nav-slot--add):not(.nav-slot--empty):active .nav-slot__mark {
  box-shadow: 0 0 0 8px var(--bg-press);
  border-radius: var(--radius-pill);
  transition-duration: 0s;
}

/* Less travel than the small slots: the same ratio that reads as a press on a
   26px mark reads as a lurch on a 44px disc. It recedes and its shadow tightens
   with it, so the disc settles toward the bar rather than just shrinking. */
.nav-slot--add:active {
  transform: none;
}

.nav-slot--add:active .nav-add__disc {
  transform: scale(0.94);
  box-shadow: var(--elevation-soft);
  transition-duration: 0s;
}

@media (hover: hover) {
  .nav-slot:not(.nav-slot--empty):hover {
    color: var(--text-primary);
  }

  .nav-slot:not(.nav-slot--add):not(.nav-slot--empty):hover .nav-slot__mark {
    box-shadow: 0 0 0 8px var(--bg-hover);
    border-radius: var(--radius-pill);
  }
}

@media (prefers-reduced-motion: reduce) {
  .nav-slot:active,
  .nav-slot--add:active .nav-add__disc {
    transform: none;
  }
}

/* The bar is the phone shell. At the desktop column the header takes over, so
   this goes and the header stops hiding. */
@media (min-width: 900px) {
  .navbar {
    display: none;
  }
}

/* Doubled class on purpose. `.topbar` sets display:flex further down this file
   and would win a same-specificity tie by coming later, so hiding it needs to
   outrank it rather than merely precede it. */
.topbar.topbar--desktop-only {
  display: none;
}

@media (min-width: 900px) {
  .topbar.topbar--desktop-only {
    display: flex;
  }
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  /* Always keep breathing room between the household name and the action buttons,
     so the name can never butt up against (or slide under) them. */
  gap: 0.75rem;
  /* The bar's surface extends up behind the phone's status bar; its content
     keeps the usual 72px strip below it. */
  padding: var(--safe-top) 1.25rem 0;
  height: calc(72px + var(--safe-top));
  background: var(--bg-surface);
  border-bottom: var(--border-width-thin) solid var(--border-main);
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
}

/* Desktop: keep the bar full-width but align its content with the centered
   dashboard column, so the household name and buttons don't hug the far corners
   of a wide screen. 100% is the bar's own width, which matches the base the
   column is centered against. */
@media (min-width: 900px) {
  .topbar {
    padding-inline: max(1.25rem, calc((100% - var(--desktop-column)) / 2));
  }
}

/* ─── How the bar answers a press ─────────────────────────────────────────────
   Every control up here summons something — a panel, a sheet, a dialog — so they
   all give way the same way: recede under the finger while the thing they called
   for comes forward. Same direction as the empty state's chips, which press in
   "rather than lifting" for the same reason.

   Two things about it are load-bearing, and both were what made this bar feel
   like it lagged behind the finger:

   1. The press is NOT transitioned. Easing INTO a pressed state is the classic
      way to build a button that feels slow — the finger is down and the pixels
      are still on their way. In instantly, out over --transition-fast.
   2. It has to be visible. The two controls that had an :active state painted
      --border-light, which in light mode is the same #f3f4f6 as --bg-hover and
      in dark is lighter than it, so a press either changed nothing or moved the
      wrong way. The other two had no :active at all — and the household block,
      the biggest target in the bar, also suppresses the tap highlight, so a tap
      on it changed nothing on screen at all until its dialog arrived. --bg-press is a real step in the right direction in both
      themes.

   Scale is inverse to size: the same ratio that reads as a press on a 40px
   circle reads as a lurch on a block the width of the screen. */
.household-btn:active,
.topbar-icon-btn:active,
.user-avatar-btn:active {
  background: var(--bg-press);
  transition-duration: 0s;
}

.topbar-icon-btn:active,
.user-avatar-btn:active {
  transform: scale(0.92);
}

.household-btn:active {
  transform: scale(0.97);
}

/* The tile holds its own against the pressed fill, same as on hover. */
.household-btn:active .household-emoji {
  background: var(--bg-surface);
  border-color: var(--border-main);
}

@media (prefers-reduced-motion: reduce) {
  .household-btn:active,
  .topbar-icon-btn:active,
  .user-avatar-btn:active {
    transform: none;
  }
}

.topbar-left {
  display: flex;
  align-items: center;
  /* min-width:0 lets this region shrink below its content width so the name can
     ellipsize; overflow:hidden guarantees nothing ever spills over the buttons,
     which paint on top of it (they come later in the DOM). */
  min-width: 0;
  overflow: hidden;
}

/* Matches .household-btn's own gap and padding, so the placeholder
   sits exactly where the button it stands in for will. */
.household-meta {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.4rem 0.5rem;
  min-width: 0;
}

.household-emoji-skeleton {
  flex-shrink: 0;
}

/* A stamp, not a control: no press state and no tap target, because there is
   nothing to do with it. It is drawn from the brand tokens, which the nightly
   channel has already re-pointed to indigo, so it matches the bar it marks
   rather than fighting it. */
.channel-badge {
  flex-shrink: 0;
  padding: 0.15rem 0.4rem;
  border: 1px solid color-mix(in srgb, var(--color-primary) 45%, transparent);
  border-radius: var(--radius-xs);
  background: var(--color-primary-bg);
  color: var(--color-primary-text);
  font-size: 0.625rem;
  font-weight: var(--weight-extrabold);
  letter-spacing: 0.08em;
  line-height: 1.5;
}

.topbar-logo {
  height: 36px;
  width: auto;
  object-fit: contain;
}

/* flex:1 so the name takes the slack and ellipsizes before the caret after it
   is pushed off the edge. */
.household-info {
  flex: 1;
  min-width: 0;
}

.household-name {
  margin: 0;
  font-family: inherit;
  font-size: var(--text-md);
  font-weight: var(--weight-bold);
  /* Tighter than the body default: the name and the stack under it are one
     block, and a 1.5 line-height pushed that block past the 72px bar. */
  line-height: 1.25;
  letter-spacing: -0.01em;
  color: var(--text-primary);
  /* A long household name must never shove the account button off the edge: cap it
     to the available width and ellipsize the overflow. min-width:0 lets it
     shrink inside the block's flex row rather than forcing it wider. */
  max-width: 100%;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  -webkit-tap-highlight-color: transparent;
  box-sizing: border-box;
}

/* The faces sit under the name rather than beside it. They said the same thing
   as the "n members" line that used to be here — and moved down here they cost
   the name none of its width, so a long name ellipsizes far later. */
.household-subrow {
  margin-top: 0.15rem;
  display: flex;
  /* Pin the row height so the stack's own skeleton can't collapse it and bounce
     the household name up and down. */
  align-items: center;
  min-height: 24px;
}

.household-subrow :deep(.member-stack) {
  /* A step down from the 30px default: the name and the stack have to share a
     72px bar now that they are stacked. */
  --member-avatar-size: 24px;
}

/* ─── Household block ────────────────────────────────────────────────────────── */
.household-btn {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
  border: none;
  background: transparent;
  /* Real padding on every side so the hover fill has room. No negative margins:
     .topbar-left has overflow:hidden and would clip them, which is exactly why
     the hover looked like it had no padding. */
  padding: 0.4rem 0.5rem;
  border-radius: var(--radius-lg);
  cursor: pointer;
  text-align: left;
  transition: background var(--transition-fast),
    transform var(--transition-fast) var(--ease-rise);
  -webkit-tap-highlight-color: transparent;
}

.household-btn:hover {
  background: var(--bg-hover);
}

/* The household's emoji, in the same square it wears inside the panel. It leads
   the block: the name is variable-width text and the avatar stack under it is a
   ragged row of circles, so before this there was nothing holding the left edge
   and the block started at a different place for every household. */
.household-emoji {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-md);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.15rem;
  line-height: 1;
  background: var(--bg-hover);
  border: var(--border-width-thin) solid var(--border-light);
}

/* The tile is filled with --bg-hover, which is what the hovered button is filled
   with too, so it dissolved into the button on hover. Same fix the panel's rows
   use: on a highlighted background the tile takes the surface colour and reads
   as a chip sitting on it rather than a hole cut out of it. */
.household-btn:hover .household-emoji {
  background: var(--bg-surface);
  border-color: var(--border-main);
}




.topbar-actions {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  /* Never let the household name squeeze the action buttons. */
  flex-shrink: 0;
}

/* Borderless on purpose. Three outlined circles in a row gave the eye nothing
   to land on; the avatar keeps its ring and is the only focal point out here,
   while history reads as a plain icon until you reach for it. */
.topbar-icon-btn {
  width: var(--size-control-md);
  height: var(--size-control-md);
  border-radius: var(--radius-pill);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: background var(--transition-fast), color var(--transition-fast),
    transform var(--transition-fast) var(--ease-rise);
  -webkit-tap-highlight-color: transparent;
}

.topbar-icon-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.history-icon {
  width: 20px;
  height: 20px;
  display: inline-block;
  background-color: currentColor;
  opacity: 0.86;
  mask: url('../assets/history.svg') no-repeat center / contain;
  -webkit-mask: url('../assets/history.svg') no-repeat center / contain;
}

:global(:root[data-theme='dark']) .history-icon {
  background-color: var(--text-inverse);
  opacity: 0.96;
}

.user-avatar-btn {
  width: var(--size-control-md);
  height: var(--size-control-md);
  border-radius: var(--radius-pill);
  border: var(--border-width-thick) solid var(--border-main);
  background: var(--bg-hover);
  padding: 0;
  cursor: pointer;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast),
    transform var(--transition-fast) var(--ease-rise);
  flex-shrink: 0;
  -webkit-tap-highlight-color: transparent;
}

.user-avatar-btn:hover {
  border-color: var(--color-primary);
  box-shadow: var(--focus-ring-primary-soft);
}

.user-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: var(--radius-pill);
}

.user-avatar-fallback {
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
  color: var(--text-secondary);
}
</style>
