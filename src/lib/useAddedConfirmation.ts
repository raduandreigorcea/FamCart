import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { productKey, type ProductSuggestion } from './productSearch'
import { t } from './i18n'

// What the search screen has already put on the list, and which row to light up
// about it.
//
// This exists because picking a product hands the screen straight back, ready
// for the next item — which on a phone means the tap has no visible result at
// all, since the list it landed on is the thing this screen is covering. The
// answer is given on the row that was tapped: it is still there, because a pick
// no longer clears the query.
//
// Two different lifetimes, which is most of why this is fiddly enough to be
// worth its own file:
//
//   • the highlight is timed, and says "this one, just now";
//   • the tick is not, and says "this is on the list" — it stays for as long as
//     the panel is open, so the results double as a record of what this search
//     has contributed. That is the question you actually have on the third pass
//     through "milk".
//
// Tapping an already-ticked row still adds again; the merge sums it. The mark
// says "this is on the list", not "this is spent".

export interface AddedProductLabel {
  name: string
  maker: string | null
}

export interface AddedConfirmation {
  /**
   * What to announce, or '' for nothing. Owned here rather than built in the
   * template because it shares the highlight's lifetime exactly: it is the
   * spoken half of the same "just now", and the live region it feeds is
   * permanently mounted so that announcing does not depend on the element
   * arriving with the news.
   */
  announcement: Ref<string>
  /** The key of the row to light up, or '' for none. */
  justAddedKey: Ref<string>
  /** Which of the two identical flash classes is in play — see below. */
  litPhase: Ref<number>
  /** Whether this product has been added during this visit to the search. */
  isAdded: (product: ProductSuggestion) => boolean
  /** Forget the record. The caller decides when a visit has ended. */
  forgetAdded: () => void
}

// How long the tapped row stays lit. Only the highlight is timed; the tick it
// leaves behind is not.
const ADDED_VISIBLE_MS = 2400

export function useAddedConfirmation(options: {
  /** The product the parent reports as landed, or null when it did not. */
  lastAdded: () => AddedProductLabel | null
}): AddedConfirmation {
  const { lastAdded } = options

  const justAdded = ref<AddedProductLabel | null>(null)
  let addedTimer: ReturnType<typeof setTimeout> | null = null

  // Every product added while this panel has been open, by productKey.
  const addedKeys = ref<Set<string>>(new Set())

  // The key of the most recent add, kept past the highlight's timer so a late
  // failure still knows which mark to take back.
  const lastAddedKey = ref('')

  const justAddedKey = computed(() =>
    justAdded.value ? productKey(justAdded.value.name, justAdded.value.maker) : '',
  )

  const announcement = computed(() =>
    justAdded.value ? t('add.announced', { name: justAdded.value.name }) : '',
  )

  // Which of the two identical flash classes is in play. Tapping the same row
  // again has to flash it again -- that is how you see the third one land -- but
  // the row is already wearing the class, so nothing changes in the DOM and a CSS
  // animation only restarts when its declaration does. Alternating between two
  // rules that differ in name and nothing else is what forces that: one class
  // comes off, the other goes on, and the browser starts the animation over.
  const litPhase = ref(0)

  const isAdded = (product: ProductSuggestion): boolean =>
    addedKeys.value.has(productKey(product.name, product.maker))

  function forgetAdded(): void {
    addedKeys.value = new Set()
  }

  watch(lastAdded, (product) => {
    if (addedTimer) clearTimeout(addedTimer)
    if (!product) {
      // The parent only clears this when the add did not land after all (see
      // clearLastAdded, "it did not land"). The mark has to come off with it, or
      // a failed add leaves a product ticked as on a list it never reached.
      justAdded.value = null
      if (lastAddedKey.value) {
        const next = new Set(addedKeys.value)
        next.delete(lastAddedKey.value)
        addedKeys.value = next
        lastAddedKey.value = ''
      }
      return
    }
    justAdded.value = product
    lastAddedKey.value = productKey(product.name, product.maker)
    litPhase.value = litPhase.value === 0 ? 1 : 0
    // Replaced rather than mutated: a Set added to in place is the same object,
    // so the rows would not re-render and the tick would not appear until
    // something else happened to redraw them.
    addedKeys.value = new Set(addedKeys.value).add(productKey(product.name, product.maker))
    addedTimer = setTimeout(() => {
      justAdded.value = null
      addedTimer = null
    }, ADDED_VISIBLE_MS)
  })

  onBeforeUnmount(() => {
    if (addedTimer) clearTimeout(addedTimer)
  })

  return { announcement, justAddedKey, litPhase, isAdded, forgetAdded }
}
