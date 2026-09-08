<script setup lang="ts">
import { computed, type PropType } from 'vue'
import PopoverMenu from './PopoverMenu.vue'
import AppIcon from './AppIcon.vue'
import { DEFAULT_HOUSEHOLD_EMOJI } from '../lib/householdEmoji'
import { HOUSEHOLD_MEMBERSHIP_CAP } from '../lib/limits'
import { t } from '../lib/i18n'

// Which household's list you are looking at.
//
// This lived in the topbar as a popover, then moved into the account dialog when
// the topbar gave its best position to the household name. Neither was wrong for
// its moment, and both had the same problem: switching is a thing you do to the
// SCREEN, and it was filed under the thing you are. It has the bar's fourth slot
// now, one press from the list.
//
// Only the menu is here. The trigger is a .nav-slot in AppNavBar, because it has
// to look like the four buttons beside it and that styling is scoped to the bar
// -- so the button stays there and hands its element down as `trigger`.
//
// The shell is PopoverMenu, which is where it came from: that component was
// extracted from this switcher and the list filter before the switcher was
// removed, and its panel chrome and row styling are still the ones this was
// drawn against.
const open = defineModel({ type: Boolean, default: false })

const props = defineProps({
  // The .nav-slot that opens this. PopoverMenu measures it to place the panel on
  // a wide screen; on a phone the panel is a bottom sheet and ignores it.
  trigger: { type: Object as PropType<HTMLElement | null>, default: null },
  // Every household the user belongs to, and which one is active.
  households: {
    type: Array as PropType<{ id: string; name: string; emoji?: string | null }[]>,
    default: () => [],
  },
  householdId: { type: String, default: '' },
})

const emit = defineEmits(['switch-household', 'add-household'])

// The cap is the app's, not this menu's: at three households there is nowhere
// left to go and the row would open a screen that can only refuse.
const canAddHousehold = computed(() => props.households.length < HOUSEHOLD_MEMBERSHIP_CAP)

// Picking the one you are already in is not an error and not a switch -- it is
// somebody confirming where they are. Close and do nothing.
function pick(id: string, close: () => void) {
  close()
  if (id !== props.householdId) emit('switch-household', id)
}

function addHousehold(close: () => void) {
  close()
  emit('add-household')
}
</script>

<template>
  <PopoverMenu
    v-model="open"
    :trigger="trigger"
    align="right"
    :label="t('nav.switchLabel')"
    :heading="t('switcher.heading')"
    :hint="t('switcher.hint')"
    icon-name="layout-grid"
  >
    <template #default="{ close }">
      <!-- menuitemradio, not menuitem: these are one choice with one answer, and
           exactly one of them is always true. The same shape the filter's
           options use, for the same reason. -->
      <button
        v-for="household in households"
        :key="household.id"
        class="menu-item switcher-item"
        type="button"
        role="menuitemradio"
        :aria-checked="household.id === householdId"
        @click="pick(household.id, close)"
      >
        <span class="switcher-item__label">
          <span class="switcher-emoji" aria-hidden="true">
            {{ household.emoji || DEFAULT_HOUSEHOLD_EMOJI }}
          </span>
          <span class="switcher-name">{{ household.name || t('account.householdFallback') }}</span>
        </span>
        <span v-if="household.id === householdId" class="switcher-item__hint">
          {{ t('account.current') }}
        </span>
      </button>

      <!-- The way to a second household, which for most accounts is the only
           thing in here that does anything. It used to be three taps deep in the
           profile dialog, which is a strange place to keep the answer to "we
           want a second list". -->
      <template v-if="canAddHousehold">
        <div class="switcher-divider"></div>
        <button class="menu-item switcher-add" type="button" @click="addHousehold(close)">
          <span class="switcher-item__label">
            <AppIcon class="switcher-add__icon" name="plus" />
            <span>{{ t('account.joinOrCreate') }}</span>
          </span>
        </button>
      </template>
    </template>
  </PopoverMenu>
</template>

<style scoped>
/* .menu-item itself is PopoverMenu's, applied through its :slotted rules, so a
   row here matches a row in the filter without restating it. What is left is
   only what a household row has that a filter option does not: its own emoji. */
.switcher-item__label {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
}

/* A household wears its own emoji where every other row in the app's menus
   wears an icon: it identifies one particular household rather than naming a
   kind of destination. Sized to the icons beside it so the names still start on
   one line. */
.switcher-emoji {
  width: 16px;
  font-size: 15px;
  line-height: 1;
  text-align: center;
  flex-shrink: 0;
}

.switcher-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.switcher-item__hint {
  flex-shrink: 0;
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.switcher-add__icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--text-secondary);
}

.switcher-add__icon :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  /* The asset ships at stroke-width 1, too fine to read at this size. */
  stroke-width: 2;
}

.switcher-divider {
  height: var(--border-width-thin);
  margin: 0.35rem 0;
  background: var(--border-light);
}
</style>
