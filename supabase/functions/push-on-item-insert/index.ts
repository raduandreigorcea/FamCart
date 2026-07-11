// Push fan-out: called by a database webhook on shopping_list_items INSERT and
// notifies every family member except the person who added the item, over both
// backends — Web Push (browsers) and FCM (native app) — whichever have tokens.
//
// Required secrets (supabase secrets set ...):
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY  — from `npx web-push generate-vapid-keys`
//   VAPID_SUBJECT                         — mailto: or https: contact for the push service
//   PUSH_WEBHOOK_SECRET                   — shared secret; the webhook must send it
//                                           in an `x-webhook-secret` header
//   FCM_SERVICE_ACCOUNT                   — Firebase service-account JSON (native push).
//                                           Omit to run Web Push only (see fcm.ts).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
// verify_jwt is off for this function (config.toml): database webhooks carry no
// user JWT, so the shared secret is the authentication.

import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { isFcmConfigured, sendFcm } from './fcm.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:push@famcart.app',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
)

interface ItemRecord {
  family_id: string
  name: string
  quantity: number | null
  added_by: string
  added_by_name: string | null
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

Deno.serve(async (req) => {
  const secret = Deno.env.get('PUSH_WEBHOOK_SECRET')
  if (!secret || !(await secretMatches(req.headers.get('x-webhook-secret'), secret))) {
    return new Response('unauthorized', { status: 401 })
  }

  const payload = await req.json().catch(() => null)
  if (payload?.type !== 'INSERT' || payload?.table !== 'shopping_list_items') {
    return Response.json({ skipped: true })
  }
  const item = payload.record as ItemRecord

  const { data: members, error: membersErr } = await supabase
    .from('family_members')
    .select('user_id')
    .eq('family_id', item.family_id)
    .neq('user_id', item.added_by)
  if (membersErr) return Response.json({ error: membersErr.message }, { status: 500 })
  if (!members?.length) return Response.json({ sent: 0 })

  const recipientIds = members.map((m) => m.user_id)

  // Two backends, queried in parallel: Web Push (browsers) and FCM (native app).
  const [{ data: subs, error: subsErr }, { data: tokens, error: tokensErr }] = await Promise.all([
    supabase.from('push_subscriptions').select('endpoint, p256dh, auth').in('user_id', recipientIds),
    isFcmConfigured()
      ? supabase.from('device_push_tokens').select('token').in('user_id', recipientIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (subsErr) return Response.json({ error: subsErr.message }, { status: 500 })
  if (tokensErr) return Response.json({ error: tokensErr.message }, { status: 500 })
  if (!subs?.length && !tokens?.length) return Response.json({ sent: 0 })

  const who = item.added_by_name || 'Someone'
  const qty = Number(item.quantity) || 1
  const body = qty > 1 ? `${who} added ${item.name} ×${qty}` : `${who} added ${item.name}`
  // One collapsing notification per family (see src/sw.js and fcm.ts).
  const tag = `famcart-${item.family_id}`
  const url = '/'
  const message = JSON.stringify({ title: 'FamCart', body, tag, url })

  let sent = 0

  const webSends = (subs ?? []).map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        message,
      )
      sent++
    } catch (err) {
      // 404/410 mean the browser revoked the endpoint — prune it so we stop
      // paying for dead sends.
      const status = (err as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      }
    }
  })

  const fcmSends = (tokens ?? []).map(async (row) => {
    const { ok, prune } = await sendFcm(row.token, { title: 'FamCart', body, tag, url })
    if (ok) sent++
    // FCM says the token is dead (app uninstalled / rotated) — prune it.
    else if (prune) await supabase.from('device_push_tokens').delete().eq('token', row.token)
  })

  await Promise.allSettled([...webSends, ...fcmSends])

  return Response.json({ sent })
})
