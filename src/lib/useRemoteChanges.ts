// What other members just did to the list, as far as the screen should say.
//
// Two things, deliberately few. A shared list that narrates every change is a
// feed; one that says nothing looks broken when it moves on its own.
//
//   • A row somebody else added glows briefly as it lands (freshIds). Their
//     face is already on the row; the glow is what makes it read as arriving
//     rather than as having always been there.
//   • Somebody else checking out removes a whole cart at once, which with no
//     explanation looks like the app losing things. That one gets a toast.
//
// Everything else -- a tick, a quantity change, a delete -- just happens: the
// row moves or updates in place, which is its own explanation.
//
// "Somebody else" is worked out on this device, because nothing in the rows says
// who checked out (purchase_history is not in the realtime publication, and the
// backend stays as it is). A change counts as ours if this device caused it,
// which the view reports through markLocal() before it makes the change.

import { ref, watch, type Ref } from 'vue'
import { productKey } from './productSearch'

interface Row {
  id: string
  checked: boolean
  added_by?: string | null
  name?: string | null
  maker?: string | null
}

const FRESH_MS = 1600

export function useRemoteChanges(options: {
  items: Ref<Row[]>
  userId: () => string
  // False while the list is loading or switching list: rows arriving then
  // are the list itself, not somebody adding to it.
  active: () => boolean
  onRemoteCheckout: (count: number) => void
}) {
  const freshIds = ref<ReadonlySet<string>>(new Set())
  const localIds = new Set<string>()
  let previous = new Map(options.items.value.map((i) => [i.id, i] as const))

  function markLocal(ids: Iterable<string>) {
    for (const id of ids) localIds.add(id)
  }

  function flash(ids: string[]) {
    if (!ids.length) return
    freshIds.value = new Set([...freshIds.value, ...ids])
    setTimeout(() => {
      const next = new Set(freshIds.value)
      for (const id of ids) next.delete(id)
      freshIds.value = next
    }, FRESH_MS)
  }

  watch(
    () => options.items.value.map((i) => `${i.id}:${i.checked ? 1 : 0}`).join(','),
    () => {
      const current = new Map(options.items.value.map((i) => [i.id, i]))
      if (!options.active()) {
        previous = current
        return
      }
      const me = options.userId()
      const arrived = [...current.values()]
        .filter((i) => !previous.has(i.id) && !localIds.has(i.id) && i.added_by && i.added_by !== me)
        .map((i) => i.id)
      flash(arrived)

      // A cart row whose product is still on the list was merged, not bought:
      // a merge deletes one of two rows of the same thing, and seen from another
      // device that delete can land before the surviving row's tick, emptying
      // the cart for a moment.
      const stillListed = new Set([...current.values()].map((i) => productKey(i.name, i.maker)))
      const goneChecked = [...previous.values()].filter(
        (i) =>
          i.checked &&
          !current.has(i.id) &&
          !localIds.has(i.id) &&
          !stillListed.has(productKey(i.name, i.maker)),
      )
      const cartEmptied = ![...current.values()].some((i) => i.checked)
      if (goneChecked.length && cartEmptied) options.onRemoteCheckout(goneChecked.length)

      for (const id of previous.keys()) if (!current.has(id)) localIds.delete(id)
      previous = current
    },
  )

  return { freshIds, markLocal }
}
