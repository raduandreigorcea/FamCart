-- Web Push subscriptions: one row per browser endpoint, written when a user
-- turns the notification toggle on. The push-on-item-insert edge function
-- (service role, bypasses RLS) reads these to fan out notifications to family
-- members. Endpoints are unguessable capability URLs minted by the browser's
-- push service.

create table if not exists public.push_subscriptions (
  id         uuid        primary key default gen_random_uuid(),
  user_id    text        not null,   -- Clerk user ID
  endpoint   text        not null unique
               check (endpoint like 'https://%' and char_length(endpoint) <= 2048),
  p256dh     text        not null check (char_length(p256dh) between 1 and 256),
  auth       text        not null check (char_length(auth) between 1 and 256),
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

-- ─── RLS: users see and remove only their own subscriptions ──────────────────
-- Writes go exclusively through claim_push_subscription() below, so there are
-- deliberately no insert/update policies (and no insert/update grants).

create policy "users can read own push subscriptions"
  on public.push_subscriptions for select
  using (user_id = requesting_user_id());

create policy "users can delete own push subscriptions"
  on public.push_subscriptions for delete
  using (user_id = requesting_user_id());

grant select, delete on public.push_subscriptions to authenticated;

-- ─── claim RPC ────────────────────────────────────────────────────────────────
-- Definer-owned upsert keyed on endpoint. A browser profile has one endpoint;
-- when a second account signs in on the same profile and enables notifications,
-- it must take the endpoint over from the previous account — an update RLS
-- could never allow that without exposing everyone's rows, so the takeover
-- lives in a scoped function instead (same pattern as find_family_by_invite_code).
-- Endpoint takeover is safe: proving you can subscribe to an endpoint means the
-- browser handed it to you.

create or replace function public.claim_push_subscription(
  _endpoint text,
  _p256dh   text,
  _auth     text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  select requesting_user_id(), _endpoint, _p256dh, _auth
  where requesting_user_id() is not null
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh  = excluded.p256dh,
        auth    = excluded.auth;
$$;

revoke all on function public.claim_push_subscription(text, text, text) from public;
grant execute on function public.claim_push_subscription(text, text, text) to authenticated;
