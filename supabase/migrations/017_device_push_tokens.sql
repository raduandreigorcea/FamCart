-- Native (FCM) push tokens: one row per Android/iOS device install, written when
-- a user turns notifications on inside the Capacitor app. Mirrors
-- push_subscriptions (Web Push) but for Firebase Cloud Messaging device tokens.
-- The push-on-item-insert edge function (service role, bypasses RLS) reads these
-- and fans out to family members via the FCM HTTP v1 API.
--
-- Web browsers keep using push_subscriptions; native app installs use this table.
-- A device's FCM token is an unguessable capability string minted by Firebase.

create table if not exists public.device_push_tokens (
  id         uuid        primary key default gen_random_uuid(),
  user_id    text        not null,   -- Clerk user ID
  token      text        not null unique
               check (char_length(token) between 1 and 4096),
  platform   text        not null default 'android'
               check (platform in ('android', 'ios', 'web')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.device_push_tokens enable row level security;

create index if not exists device_push_tokens_user_id_idx
  on public.device_push_tokens (user_id);

-- ─── RLS: users see and remove only their own tokens ─────────────────────────
-- Writes go exclusively through claim_device_push_token() below, so there are
-- deliberately no insert/update policies (and no insert/update grants).

-- drop-then-create so the migration is safe to re-run even if it was already
-- applied out-of-band (the remote migration history was empty when this landed).
drop policy if exists "users can read own device push tokens" on public.device_push_tokens;
create policy "users can read own device push tokens"
  on public.device_push_tokens for select
  using (user_id = requesting_user_id());

drop policy if exists "users can delete own device push tokens" on public.device_push_tokens;
create policy "users can delete own device push tokens"
  on public.device_push_tokens for delete
  using (user_id = requesting_user_id());

grant select, delete on public.device_push_tokens to authenticated;

-- ─── claim RPC ────────────────────────────────────────────────────────────────
-- Definer-owned upsert keyed on token. A device install has one FCM token; when
-- a second account signs in on the same device and enables notifications, it
-- must take the token over from the previous account — an update RLS could never
-- allow that without exposing everyone's rows, so the takeover lives in a scoped
-- function (same pattern as claim_push_subscription in migration 016).
-- Token takeover is safe: holding the token means Firebase handed it to this
-- install.

create or replace function public.claim_device_push_token(
  _token    text,
  _platform text default 'android'
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.device_push_tokens (user_id, token, platform)
  select requesting_user_id(), _token, coalesce(_platform, 'android')
  where requesting_user_id() is not null
  on conflict (token) do update
    set user_id    = excluded.user_id,
        platform   = excluded.platform,
        updated_at = now();
$$;

revoke all on function public.claim_device_push_token(text, text) from public;
grant execute on function public.claim_device_push_token(text, text) to authenticated;
