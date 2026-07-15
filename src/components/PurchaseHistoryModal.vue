<script setup>
import { ref, computed, watch } from 'vue'
import { useSupabase } from '../supabase'
import ModalCloseButton from './ModalCloseButton.vue'
import SkeletonBlock from './SkeletonBlock.vue'
import { getProductEmoji } from '../lib/productEmoji'
import { groupCheckouts, trimPartialTail } from '../lib/purchaseHistory'
import historyIconRaw from '../assets/history.svg?raw'

const props = defineProps({
  open: { type: Boolean, default: false },
  familyId: { type: String, default: '' },
  currentUserId: { type: String, default: '' },
  memberProfiles: { type: Array, default: () => [] },
})

const emit = defineEmits(['close'])

const db = useSupabase()

// The server keeps at most 60 checkouts per family; this row cap comfortably
// covers that many checkouts' worth of items.
const HISTORY_LIMIT = 500
const entries = ref([])
const loading = ref(false)
const error = ref('')

// Re-fetch every time the modal opens so it reflects checkouts made since the
// last look. Cheap (one indexed query, capped rows) and always current.
// immediate: the modal is lazy-mounted at the moment it opens, so `open` is
// already true on first render — without this the first open would never fetch.
watch(
  () => props.open,
  (open) => {
    if (open) loadHistory()
  },
  { immediate: true },
)

async function loadHistory() {
  if (!props.familyId) return
  loading.value = true
  error.value = ''
  const { data, error: fetchError } = await db
    .from('purchase_history')
    .select('id, name, maker, quantity, checkout_id, purchased_by, purchased_at, added_by_name, added_by_image_url')
    .eq('family_id', props.familyId)
    // Rows in one checkout share a single purchased_at, and Postgres returns
    // tied rows in no particular order — without tiebreakers every open could
    // shuffle them. checkout_id keeps a checkout's rows contiguous (which the
    // partial-tail trim relies on); id pins the order within it.
    .order('purchased_at', { ascending: false })
    .order('checkout_id', { ascending: true })
    .order('id', { ascending: true })
    .limit(HISTORY_LIMIT)

  if (fetchError) {
    error.value = 'Could not load history. Check your connection and try again.'
    entries.value = []
  } else {
    // If the fetch filled the row cap, the oldest checkout may have been cut
    // mid-way; trim it so every checkout shown is complete.
    entries.value = trimPartialTail(data || [], HISTORY_LIMIT)
  }
  loading.value = false
}

const days = computed(() => groupCheckouts(entries.value))

function buyerProfile(userId) {
  return props.memberProfiles.find((m) => m.user_id === userId) || null
}

function buyerName(userId) {
  if (userId && userId === props.currentUserId) return 'You'
  return buyerProfile(userId)?.display_name || 'Someone'
}

function buyerInitial(userId) {
  return (buyerName(userId) || '?').slice(0, 1).toUpperCase()
}

function formatTime(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <Transition name="modal-fade" appear>
    <div v-if="open" class="history-overlay" @click.self="emit('close')">
      <div class="history-modal" role="dialog" aria-modal="true" aria-label="Purchase history">
        <div class="history-modal__header">
          <div class="history-modal__title-wrap">
            <div class="history-modal__icon-bg">
              <span class="header-icon" v-html="historyIconRaw"></span>
            </div>
            <div>
              <h3>Checkout history</h3>
              <p class="history-modal__subtitle">Your recent checkouts</p>
            </div>
          </div>
          <ModalCloseButton aria-label="Close history" @click="emit('close')" />
        </div>

        <div class="history-modal__body">
          <!-- Loading: the exact structure and classes of the loaded list
               (dl / dt / dd), so every spacing rule applies identically and
               the swap to real content cannot shift the layout. Two skeleton
               days fill the fixed-height modal. -->
          <dl v-if="loading" class="history-days" aria-hidden="true">
            <template v-for="(cards, d) in [[3, 2], [3]]" :key="d">
              <dt class="history-day__label">
                <SkeletonBlock width="4rem" height="0.9rem" />
              </dt>
              <dd v-for="(rows, c) in cards" :key="c" class="checkout">
                <div class="checkout__head">
                  <SkeletonBlock width="24px" height="24px" radius="50%" />
                  <SkeletonBlock width="34%" height="0.85rem" />
                </div>
                <ul class="history-list">
                  <li v-for="n in rows" :key="n" class="history-row history-row--skeleton">
                    <SkeletonBlock width="2.05rem" height="2.05rem" radius="0.65rem" />
                    <SkeletonBlock :width="`${42 + ((n + c + d) % 3) * 14}%`" height="0.9rem" />
                  </li>
                </ul>
              </dd>
            </template>
          </dl>

          <!-- Error / empty -->
          <p v-else-if="error" class="history-empty">{{ error }}</p>
          <p v-else-if="!entries.length" class="history-empty">
            No checkouts yet. Items you check out will show up here.
          </p>

          <!-- Day -> checkout -> items. A description list so the day labels
               (dt) can stick to the top of the scrolling body; each checkout
               is a dd under its day. -->
          <dl v-else class="history-days">
            <template v-for="day in days" :key="day.label">
              <dt class="history-day__label">{{ day.label }}</dt>

              <dd v-for="checkout in day.checkouts" :key="checkout.key" class="checkout">
                <div class="checkout__head">
                  <img
                    v-if="buyerProfile(checkout.purchasedBy)?.image_url"
                    :src="buyerProfile(checkout.purchasedBy).image_url"
                    :alt="buyerName(checkout.purchasedBy) + ' avatar'"
                    class="checkout__avatar"
                  />
                  <span v-else class="checkout__avatar checkout__avatar--fallback">
                    {{ buyerInitial(checkout.purchasedBy) }}
                  </span>
                  <span class="checkout__buyer">{{ buyerName(checkout.purchasedBy) }}</span>
                  <span class="checkout__time">{{ formatTime(checkout.purchasedAt) }}</span>
                </div>

                <ul class="history-list">
                  <li v-for="entry in checkout.items" :key="entry.id" class="history-row">
                    <span class="history-emoji" aria-hidden="true">{{ getProductEmoji(entry.name, entry.maker || '') }}</span>
                    <span class="history-text">
                      <span class="history-name">{{ entry.name }}</span>
                      <span v-if="entry.maker" class="history-maker">{{ entry.maker }}</span>
                    </span>
                    <span v-if="entry.quantity > 1" class="history-qty">x{{ entry.quantity }}</span>
                    <img
                      v-if="entry.added_by_image_url"
                      :src="entry.added_by_image_url"
                      :alt="(entry.added_by_name || 'Member') + ' added this'"
                      class="history-adder"
                      :title="'Added by ' + (entry.added_by_name || 'Member')"
                    />
                    <span
                      v-else
                      class="history-adder history-adder--fallback"
                      :title="'Added by ' + (entry.added_by_name || 'Member')"
                    >
                      {{ (entry.added_by_name || '?').slice(0, 1).toUpperCase() }}
                    </span>
                  </li>
                </ul>
              </dd>
            </template>
          </dl>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.history-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-dark);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
  padding: calc(var(--space-4) + var(--safe-top)) var(--space-4) calc(var(--space-4) + var(--safe-bottom));
}

.history-modal {
  width: 100%;
  max-width: 520px;
  background: var(--bg-surface);
  border-radius: var(--radius-3xl);
  box-shadow: var(--elevation-modal);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* Fixed height (not max-height): the skeleton and the loaded list render in
     the same frame size, so the modal doesn't snap bigger when data arrives.
     Mirrors the phone bottom sheet, which is already fixed-height. */
  height: min(85vh, 640px);
}

.history-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-5) var(--space-6);
  border-bottom: 1px solid var(--bg-hover);
}

.history-modal__title-wrap {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.history-modal__icon-bg {
  width: 38px;
  height: 38px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-primary) 10%, var(--bg-surface));
  color: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.header-icon {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.header-icon :deep(svg) {
  width: 100%;
  height: 100%;
  stroke: currentColor;
  stroke-width: 2;
  fill: none;
}

.history-modal__header h3 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 800;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.history-modal__subtitle {
  margin: 0.1rem 0 0;
  font-size: 0.8rem;
  color: var(--text-secondary);
  font-weight: 500;
}

.history-modal__body {
  /* No top padding on the scroll container: a sticky child pins below it and
     rows stay visible scrolling through the strip, so the label looks afloat.
     The resting gap lives inside the scrolled content (.history-days /
     .history-skeleton) instead, where it scrolls away naturally. */
  padding: 0 var(--space-6) var(--space-6);
  overflow-y: auto;
}

/* The label's own 0.6rem top padding (below) is part of every vertical gap it
   appears in, so the paddings/margins here are reduced by that amount to keep
   the original rhythm: 1rem below the header, 1.4rem between day groups. */
.history-days {
  margin: 0;
  padding-top: 0.4rem;
}

/* dd carries a browser-default indent; the cards do their own layout. */
.history-days dd {
  margin: 0;
}

/* Day labels stick to the top of the scrolling body; the next day's label
   slides in over the previous one. The opaque background is what stops rows
   from showing through while they scroll underneath (dt is not sticky by
   itself — position: sticky does the work). */
.history-day__label {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0;
  /* Symmetric padding: this box is what shows while pinned, so equal space
     above and below the text keeps the pinned label centered in its strip. */
  padding: 0.6rem 0;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-disabled);
  background: var(--bg-surface);
}

/* Day-group spacing lives on the last card before the next label, not on the
   sticky label itself: margins travel with a stuck element, so margin-top on
   the dt would show as a transparent gap floating above it while pinned. */
.history-days dd:has(+ dt) {
  margin-bottom: 0.8rem;
}

/* One checkout event: a buyer + time header over the items bought together. */
.checkout {
  border: 1px solid var(--bg-hover);
  border-radius: var(--radius-xl);
  padding: 0.6rem;
  background: var(--bg-surface);
}

.checkout + .checkout {
  margin-top: 0.6rem;
}

.checkout__head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.1rem 0.25rem 0.55rem;
}

.checkout__avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--border-main);
  flex-shrink: 0;
}

.checkout__avatar--fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-hover);
  color: var(--text-secondary);
  font-size: 0.72rem;
  font-weight: 700;
}

.checkout__buyer {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--text-primary);
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.checkout__time {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-disabled);
  font-variant-numeric: tabular-nums;
}

.history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.history-row {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.4rem 0.25rem;
  border-radius: var(--radius-md);
  background: var(--bg-surface-alt);
}

.history-row--skeleton {
  background: transparent;
  padding: 0.5rem 0.25rem;
}

.history-emoji {
  flex-shrink: 0;
  font-size: 1.05rem;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.05rem;
  height: 2.05rem;
  border-radius: 0.65rem;
  background: color-mix(in srgb, var(--color-primary) 10%, var(--bg-surface));
  border: 1px solid color-mix(in srgb, var(--color-primary) 22%, var(--bg-surface));
}

.history-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.history-name {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-maker {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--text-secondary);
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-qty {
  flex-shrink: 0;
  font-size: 0.74rem;
  font-weight: 700;
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 10%, var(--bg-surface));
  border: 1px solid color-mix(in srgb, var(--color-primary) 28%, var(--bg-surface));
  border-radius: var(--radius-pill);
  padding: 0.12rem 0.42rem;
}

/* Who originally added the item (mirrors the avatar on the main list row). */
.history-adder {
  margin-left: auto;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--border-main);
}

.history-adder--fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-hover);
  color: var(--text-secondary);
  font-size: 0.65rem;
  font-weight: 700;
}

.history-empty {
  text-align: center;
  font-size: 0.875rem;
  color: var(--text-disabled);
  line-height: 1.5;
  margin: 2.5rem 0;
}

/* Modal transitions (mirrors the other modals) */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.18s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-fade-enter-active .history-modal {
  animation: modalScaleIn 0.18s cubic-bezier(0.2, 0.9, 0.2, 1) forwards;
}

@keyframes modalScaleIn {
  from {
    transform: scale(0.96);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

/* Bottom sheet on phones */
@media (max-width: 520px) {
  .history-overlay {
    align-items: flex-end;
    padding: 0;
  }

  .history-modal {
    max-width: none;
    height: min(85dvh, 640px);
    max-height: min(85dvh, 640px);
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    padding-bottom: var(--safe-bottom);
  }

  .history-modal__header {
    padding: 1rem;
  }

  .history-modal__body {
    padding: 0 1rem 1rem;
  }
}
</style>
