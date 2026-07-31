-- Rate limiting for the high-frequency RPCs.
--
-- Why this exists at the database and not at the edge: the browser talks to
-- Supabase directly (VITE_SUPABASE_URL), so a Vercel firewall rule only sees
-- requests for the app shell — never a single PostgREST call. Anything that
-- throttles the API has to live where the API does.
--
-- The target is catalog write amplification. bump_product_popularity() and
-- add_custom_product() both increment product_catalog.add_count on *global* rows
-- (family_id is null), and add_count drives the suggestion ranking every family
-- sees. Nothing capped how often either could be called, so one account in a loop
-- could push any product to the top of everyone's suggestions. The existing
-- guards cap breadth (500 products per family, 3 distinct accounts to promote)
-- but not repetition, which is the part that moves the ranking.
--
-- Why a counter table rather than counting security_events like the invite
-- throttle (migration 030) does: invite failures are rare and belong in the audit
-- trail on their own merit. These calls fire on every item add — logging each one
-- to build a count would bury the audit log in routine traffic. So the hot path
-- gets a counter, and only crossing the limit reaches security_events.
--
-- Idempotent: safe to re-run in the SQL editor.

create table if not exists public.rate_limit_counters (
  actor        text        not null,
  kind         text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0,
  primary key (actor, kind, window_start)
);

-- Same lockdown as security_events: RLS on with no policies, and the grants
-- revoked outright. A client that could edit its own counter has no rate limit.
alter table public.rate_limit_counters enable row level security;
revoke all on public.rate_limit_counters from anon, authenticated;

comment on table public.rate_limit_counters is
  'Fixed-window request counters. Written only by rate_limit_hit(); no client role '
  'can read or modify it.';

-- ─── the limiter ─────────────────────────────────────────────────────────────
-- Records one hit and reports whether the caller is now over the limit.
--
-- Fixed window (via date_bin), not a sliding one: a caller can burst up to twice
-- the limit across a window boundary. That is the standard trade for a limiter
-- that costs a single upsert, and the limits below are set far enough above real
-- usage that a 2x boundary burst is still nowhere near abusive.
--
-- Logs to security_events exactly once per window — on the call that crosses the
-- limit (hits = limit + 1) — so repeated hammering leaves one audit row per
-- window rather than one per request.
--
-- Never raises: both callers are fire-and-forget from the client and must not
-- surface an error on top of an add that already succeeded.
create or replace function public.rate_limit_hit(
  p_kind text,
  p_limit integer,
  p_window interval
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := requesting_user_id();
  v_start timestamptz;
  v_hits  integer;
begin
  if v_actor is null then
    return true;  -- unauthenticated callers have no budget
  end if;

  v_start := date_bin(p_window, now(), timestamptz 'epoch');

  insert into public.rate_limit_counters as rl (actor, kind, window_start, hits)
  values (v_actor, p_kind, v_start, 1)
  on conflict (actor, kind, window_start)
  do update set hits = rl.hits + 1
  returning rl.hits into v_hits;

  -- Opportunistic cleanup of windows nobody will read again, same approach as
  -- security_events: rare enough to stay off the hot path, frequent enough that
  -- the table cannot grow without bound.
  if random() < 0.01 then
    delete from public.rate_limit_counters where window_start < now() - interval '1 day';
  end if;

  if v_hits = p_limit + 1 then
    perform public.log_security_event(
      'rate_limited',
      null,
      jsonb_build_object('for', p_kind, 'limit', p_limit)
    );
  end if;

  return v_hits > p_limit;
exception
  when others then
    -- A broken limiter must not break the app. Fail open and let the existing
    -- breadth caps (500 products per family, the 3-account promotion gate) hold.
    return false;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, interval) from public;

-- ─── apply to the catalog write paths ────────────────────────────────────────
-- 240 bumps and 120 contributions per hour. A person adding groceries fires one
-- bump per item; a busy shop is a few dozen. A script inflating a global ranking
-- needs thousands. The gap between those two numbers is the whole point.

-- Unchanged from migration 022 except for the throttle at the top.
create or replace function public.bump_product_popularity(
  p_name text,
  p_maker text default null,
  p_family_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user text := requesting_user_id();
begin
  if public.rate_limit_hit('catalog_bump', 240, interval '1 hour') then
    return;
  end if;

  update public.product_catalog pc
  set add_count = pc.add_count + 1
  where lower(btrim(pc.name)) = lower(btrim(p_name))
    and lower(btrim(coalesce(pc.maker, ''))) = lower(btrim(coalesce(p_maker, '')))
    and (
      pc.family_id is null
      or (
        pc.family_id = p_family_id
        and exists (
          select 1 from public.family_members fm
          where fm.family_id = p_family_id and fm.user_id = v_user
        )
      )
    );
end;
$$;

revoke all on function public.bump_product_popularity(text, text, uuid) from public;
grant execute on function public.bump_product_popularity(text, text, uuid) to authenticated;

-- add_custom_product() keeps its own body (migration 022); the throttle is added
-- by wrapping the entry point rather than restating 90 lines of contribution and
-- promotion logic that has not changed. A plpgsql function cannot be "extended",
-- so the guard goes in a renamed inner function and the public name becomes the
-- gate. Guarded so a re-run does not re-wrap an already-wrapped function.
do $$
begin
  if not exists (
    select 1 from pg_proc
    where proname = 'add_custom_product_unthrottled'
      and pronamespace = 'public'::regnamespace
  ) then
    execute 'alter function public.add_custom_product(uuid, text, text) '
         || 'rename to add_custom_product_unthrottled';
  end if;
end $$;

revoke all on function public.add_custom_product_unthrottled(uuid, text, text) from public;

create or replace function public.add_custom_product(
  p_family_id uuid,
  p_name text,
  p_maker text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.rate_limit_hit('catalog_contribute', 120, interval '1 hour') then
    return;
  end if;
  perform public.add_custom_product_unthrottled(p_family_id, p_name, p_maker);
end;
$$;

revoke all on function public.add_custom_product(uuid, text, text) from public;
grant execute on function public.add_custom_product(uuid, text, text) to authenticated;
