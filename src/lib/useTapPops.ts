import { onBeforeUnmount, ref, type Ref } from 'vue'

// Counting the taps out loud.
//
// Tapping a suggestion again adds another of that product (addItem's merge sums
// them), and the row's flash says a tap landed but not how many. So from the
// second tap on, the running count flies off the spot that was pressed: x2, x3,
// x4.
//
// They are thrown in scattered directions on purpose. Three tidy badges stacking
// in the same place would read as one badge being replaced, which is the thing
// the count is there to disprove — and the third one has to look different from
// the second, or the tap did not visibly do anything.
//
// Extracted from AddItemForm, which was doing four separate jobs in one file.
// This one has no bearing on the rest of them: it draws a number and forgets it.

// Long enough to read, short enough to be gone before the next tap needs the
// space. Mirrors the pop-drift animation in AddItemForm's stylesheet.
const POP_MS = 900

export interface TapPop {
  id: number
  x: number
  y: number
  label: string
  dx: number
  dy: number
  rot: number
}

export interface TapPops {
  /** Currently airborne counters. */
  pops: Ref<TapPop[]>
  /**
   * Record a tap on `key` and, from the second one on, throw its running count
   * from where the pointer was. Returns the count so the caller can decide what
   * else a repeat tap means.
   */
  countTap: (key: string, event?: MouseEvent) => number
  /** Forget the counts — a new visit to the search is a new tally. */
  reset: () => void
}

export function useTapPops(options: {
  // Declared by the component, for the same reason usePhoneSearchScreen takes
  // its refs: a string `ref="wrapRef"` in the template only resolves against a
  // directly-declared const.
  /** The element the pop coordinates are measured against. */
  wrapRef: Ref<HTMLElement | null>
}): TapPops {
  const { wrapRef } = options
  const pops = ref<TapPop[]>([])
  // Taps per product, for as long as the panel has been open.
  const counts = ref<Map<string, number>>(new Map())
  // Held so unmounting mid-flight does not leave callbacks running against a
  // component that is gone. The originals were never cleared.
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let popId = 0

  function throwPop(event: MouseEvent, label: string): void {
    const wrap = wrapRef.value
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    // A wide fan, biased upward: a counter that drifts down goes straight under
    // the finger that just pressed there, which is the one place it cannot be read.
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.6
    const distance = 34 + Math.random() * 26
    const id = ++popId

    pops.value = [
      ...pops.value,
      {
        id,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        label,
        dx: Math.cos(angle) * distance,
        dy: Math.sin(angle) * distance,
        rot: (Math.random() - 0.5) * 34,
      },
    ]

    const timer = setTimeout(() => {
      timers.delete(timer)
      pops.value = pops.value.filter((pop) => pop.id !== id)
    }, POP_MS)
    timers.add(timer)
  }

  function countTap(key: string, event?: MouseEvent): number {
    const count = (counts.value.get(key) ?? 0) + 1
    counts.value = new Map(counts.value).set(key, count)
    // Nothing on the first: one tap is one item, and the row's own flash and
    // tick already say it landed. The count only becomes news once there is
    // more than one of something.
    if (count > 1 && event) throwPop(event, `x${count}`)
    return count
  }

  function reset(): void {
    counts.value = new Map()
  }

  onBeforeUnmount(() => {
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
  })

  return { pops, countTap, reset }
}
