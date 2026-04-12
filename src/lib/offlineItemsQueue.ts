import { supabase } from './supabase'

type AddOrIncrementPayload = {
  familyId: string
  name: string
  brand: string
  image: string
  quantity: number
  createdBy: string
}

type TogglePayload = {
  itemId: string
  completed: boolean
}

type DeletePayload = {
  itemId: string
}

type CheckoutPayload = {
  itemIds: string[]
}

type OfflineItemMutation =
  | { id: string; type: 'add-or-increment'; payload: AddOrIncrementPayload }
  | { id: string; type: 'toggle'; payload: TogglePayload }
  | { id: string; type: 'delete'; payload: DeletePayload }
  | { id: string; type: 'checkout'; payload: CheckoutPayload }

type OfflineItemMutationInput =
  | { type: 'add-or-increment'; payload: AddOrIncrementPayload }
  | { type: 'toggle'; payload: TogglePayload }
  | { type: 'delete'; payload: DeletePayload }
  | { type: 'checkout'; payload: CheckoutPayload }

const STORAGE_KEY = 'clerk-vue:offline-item-mutations:v1'

function readQueue(): OfflineItemMutation[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as OfflineItemMutation[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeQueue(queue: OfflineItemMutation[]) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue))
  } catch {
    // Ignore storage quota and serialization issues.
  }
}

function nextMutationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function isOfflineLikeError(error: unknown): boolean {
  if (!error) return !navigator.onLine

  if (typeof error === 'string') {
    const normalized = error.toLowerCase()
    return normalized.includes('failed to fetch') || normalized.includes('network')
  }

  if (error instanceof TypeError) {
    return true
  }

  const maybeError = error as { message?: string }
  const message = (maybeError.message ?? '').toLowerCase()
  return message.includes('failed to fetch') || message.includes('network') || !navigator.onLine
}

export function enqueueItemMutation(mutation: OfflineItemMutationInput) {
  const queue = readQueue()
  const id = nextMutationId()

  if (mutation.type === 'add-or-increment') {
    queue.push({ id, type: 'add-or-increment', payload: mutation.payload })
  } else if (mutation.type === 'toggle') {
    queue.push({ id, type: 'toggle', payload: mutation.payload })
  } else if (mutation.type === 'delete') {
    queue.push({ id, type: 'delete', payload: mutation.payload })
  } else {
    queue.push({ id, type: 'checkout', payload: mutation.payload })
  }

  writeQueue(queue)
}

export function getQueuedMutationsCount() {
  return readQueue().length
}

async function applyMutation(mutation: OfflineItemMutation) {
  if (mutation.type === 'add-or-increment') {
    const { payload } = mutation
    const response = await supabase.rpc('add_or_increment_item', {
      p_family_id: payload.familyId,
      p_name: payload.name,
      p_brand: payload.brand,
      p_image: payload.image,
      p_quantity: payload.quantity,
      p_created_by: payload.createdBy,
    })

    if (response.error) throw response.error
    return
  }

  if (mutation.type === 'toggle') {
    const { payload } = mutation
    const response = await supabase
      .from('items')
      .update({ completed: payload.completed })
      .eq('id', payload.itemId)

    if (response.error) throw response.error
    return
  }

  if (mutation.type === 'delete') {
    const { payload } = mutation
    const response = await supabase.from('items').delete().eq('id', payload.itemId)

    if (response.error) throw response.error
    return
  }

  const { payload } = mutation
  if (!payload.itemIds.length) return

  const response = await supabase.from('items').delete().in('id', payload.itemIds)
  if (response.error) throw response.error
}

export async function flushOfflineItemMutations() {
  if (!navigator.onLine) {
    return { applied: 0, remaining: getQueuedMutationsCount() }
  }

  const queue = readQueue()
  if (!queue.length) return { applied: 0, remaining: 0 }

  let applied = 0
  const remaining: OfflineItemMutation[] = []

  for (let index = 0; index < queue.length; index += 1) {
    const mutation = queue[index]

    try {
      await applyMutation(mutation)
      applied += 1
    } catch (error) {
      if (isOfflineLikeError(error)) {
        remaining.push(...queue.slice(index))
        break
      }

      // Drop unrecoverable mutations and continue replaying the rest.
    }
  }

  writeQueue(remaining)
  return { applied, remaining: remaining.length }
}
