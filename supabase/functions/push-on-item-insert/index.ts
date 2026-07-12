// Push fan-out via OneSignal, called by database webhooks on INSERT into:
//   • shopping_list_items — "Radu added Milk", one per item;
//   • purchase_history    — "Radu bought Milk and 2 more", one per checkout.
// A checkout inserts one history row per item, so the webhook fires once per
// row; every row carries the same checkout_id, which doubles as the OneSignal
// idempotency_key — duplicate calls collapse into a single sent notification.
//
// Recipients are every family member except the actor. Devices (web and
// native) are registered by the client SDKs and keyed to Clerk user ids via
// OneSignal.login(), so no subscription storage lives on our side.
//
// Required secrets (supabase secrets set ...):
//   ONESIGNAL_APP_ID       — the OneSignal app's id (dashboard → Settings → Keys & IDs)
//   ONESIGNAL_REST_API_KEY — the app's REST API key, same page
//   PUSH_WEBHOOK_SECRET    — shared secret; webhooks must send it in an
//                            `x-webhook-secret` header
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
// verify_jwt is off for this function (config.toml): database webhooks carry no
// user JWT, so the shared secret is the authentication.

import { createClient } from 'npm:@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

interface ItemRecord {
  id: string
  family_id: string
  name: string
  quantity: number | null
  added_by: string
  added_by_name: string | null
}

interface PurchaseRecord {
  checkout_id: string
  family_id: string
  purchased_by: string
}

// Compare SHA-256 digests instead of the raw strings so the check cannot leak
// matching-prefix timing (a plain === short-circuits on the first wrong byte).
async function secretMatches(given: string | null, expected: string): Promise<boolean> {
  if (given === null) return false
  const enc = new TextEncoder()
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ])
  const av = new Uint8Array(a)
  const bv = new Uint8Array(b)
  let diff = 0
  for (let i = 0; i < av.length; i++) diff |= av[i] ^ bv[i]
  return diff === 0
}

function itemLabel(name: string, quantity: number | null): string {
  const qty = Number(quantity) || 1
  return qty > 1 ? `${name} ×${qty}` : name
}

// Family members minus the actor. Returns display names too, so checkout
// messages can name the buyer (history rows only store their user id).
async function fetchMembers(familyId: string) {
  return await supabase
    .from('family_members')
    .select('user_id, display_name')
    .eq('family_id', familyId)
}

async function sendPush(options: {
  recipientIds: string[]
  body: string
  familyId: string
  idempotencyKey: string
}): Promise<Response> {
  // One collapsing notification per family: web_push_topic (browsers) and
  // collapse_id (native) make a burst of changes update in place, not stack.
  const tag = `famcart-${options.familyId}`
  const res = await fetch('https://api.onesignal.com/notifications?c=push', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Key ${Deno.env.get('ONESIGNAL_REST_API_KEY')}`,
    },
    body: JSON.stringify({
      app_id: Deno.env.get('ONESIGNAL_APP_ID'),
      target_channel: 'push',
      include_aliases: { external_id: options.recipientIds },
      headings: { en: 'FamCart' },
      contents: { en: options.body },
      web_push_topic: tag,
      collapse_id: tag,
      // Webhook retries (and per-row checkout fan-in) resend the same key;
      // OneSignal processes the first and swallows the rest.
      idempotency_key: options.idempotencyKey,
    }),
  })

  const result = await res.json().catch(() => null)
  if (!res.ok) {
    return Response.json(
      { error: 'OneSignal rejected the notification', detail: result },
      { status: 502 },
    )
  }
  // An empty id means no recipient had a subscribed device — normal when
  // nobody has enabled notifications; not an error.
  return Response.json({ id: result?.id ?? null, targeted: options.recipientIds.length })
}

async function handleItemAdded(item: ItemRecord): Promise<Response> {
  const { data: members, error } = await fetchMembers(item.family_id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  const recipientIds = (members ?? [])
    .map((m) => m.user_id)
    .filter((id) => id !== item.added_by)
  if (!recipientIds.length) return Response.json({ sent: 0 })

  const who = item.added_by_name || 'Someone'
  return sendPush({
    recipientIds,
    body: `${who} added ${itemLabel(item.name, item.quantity)}`,
    familyId: item.family_id,
    idempotencyKey: item.id,
  })
}

async function handleCheckout(purchase: PurchaseRecord): Promise<Response> {
  const [{ data: members, error: membersErr }, { data: items, error: itemsErr }] =
    await Promise.all([
      fetchMembers(purchase.family_id),
      // The webhook fires after buy_items commits, so every row of this
      // checkout is already visible; the count is complete on the first call.
      supabase
        .from('purchase_history')
        .select('name, quantity')
        .eq('checkout_id', purchase.checkout_id),
    ])
  if (membersErr) return Response.json({ error: membersErr.message }, { status: 500 })
  if (itemsErr) return Response.json({ error: itemsErr.message }, { status: 500 })

  const recipientIds = (members ?? [])
    .map((m) => m.user_id)
    .filter((id) => id !== purchase.purchased_by)
  if (!recipientIds.length || !items?.length) return Response.json({ sent: 0 })

  const who =
    (members ?? []).find((m) => m.user_id === purchase.purchased_by)?.display_name || 'Someone'
  const labels = items.map((i) => itemLabel(i.name, i.quantity))
  let bought: string
  if (labels.length === 1) bought = labels[0]
  else if (labels.length === 2) bought = `${labels[0]} and ${labels[1]}`
  else bought = `${labels[0]}, ${labels[1]} and ${labels.length - 2} more`

  return sendPush({
    recipientIds,
    body: `${who} bought ${bought}`,
    familyId: purchase.family_id,
    idempotencyKey: purchase.checkout_id,
  })
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('PUSH_WEBHOOK_SECRET')
  if (!secret || !(await secretMatches(req.headers.get('x-webhook-secret'), secret))) {
    return new Response('unauthorized', { status: 401 })
  }

  if (!Deno.env.get('ONESIGNAL_APP_ID') || !Deno.env.get('ONESIGNAL_REST_API_KEY')) {
    return Response.json({ error: 'OneSignal secrets not configured' }, { status: 500 })
  }

  const payload = await req.json().catch(() => null)
  if (payload?.type !== 'INSERT') return Response.json({ skipped: true })

  if (payload.table === 'shopping_list_items') {
    return handleItemAdded(payload.record as ItemRecord)
  }
  if (payload.table === 'purchase_history') {
    return handleCheckout(payload.record as PurchaseRecord)
  }
  return Response.json({ skipped: true })
})
