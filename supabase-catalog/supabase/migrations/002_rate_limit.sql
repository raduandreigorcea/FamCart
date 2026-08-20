-- ─── audit trail and rate limiting (catalog project) ─────────────────────────
-- The throttle behind bump_product_popularity(), and the log that records
-- someone crossing it.
--
-- WHY THIS EXISTS HERE AND NOT ONLY NEXT DOOR
--
-- The bump is the one write a signed-in client can reach in this project, and it
-- increments the number that orders everyone's suggestions. Uncapped, one
-- account in a loop pushes any product to the top of every household's dropdown
-- in both environments at once. The limiter has to live where the write does; a
-- copy in the app database would throttle nothing here.
--
-- This is a narrowed copy of supabase/migrations/002_security_audit.sql, keeping
-- the parts rate_limit_hit() depends on and dropping the parts about households
-- and invites. The two are not shared and will drift if only one is edited --
-- which is tolerable, because they now guard different things, and it is named
-- here so the drift is a decision rather than a surprise.

-- ─── the audit trail ─────────────────────────────────────────────────────────
create table if not exists public.security_events (
  id         bigint      generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind       text        not null,
  actor      text,        -- Clerk user id; null when the caller was unauthenticated
  detail     jsonb       not null default '{}'::jsonb
);

-- No household_id column, unlike the app's copy: nothing in this project belongs
-- to a household, so every row here is about an account and a product.

comment on table public.security_events is
  'Append-only audit trail for the catalog project. Written only by '
  'log_security_event(); unreadable by client roles.';

-- RLS on with *zero policies* means no client role can select, insert, update or
-- delete: every row fails the (nonexistent) policy check. An attacker who
-- reaches the API with a valid token still cannot read the log recording them.
alter table public.security_events enable row level security;

-- Grants and RLS are separate gates, and hosted Supabase hands the API roles
-- table privileges by default at provisioning. Revoke explicitly rather than
-- relying on RLS alone; this closes both.
revoke all on public.security_events from anon, authenticated;

-- And the sequence, which the line above does not reach: `id` is an identity
-- column with its own ACL, and SELECT on a sequence returns last_value -- that
-- is, roughly how many rows this table holds, which is the one fact it exists to
-- keep from the person it is recording.
revoke all on sequence public.security_events_id_seq from anon, authenticated, service_role;

create index if not exists idx_security_events_kind_created_at
  on public.security_events (kind, created_at desc);

create index if not exists idx_security_events_actor_kind_created_at
  on public.security_events (actor, kind, created_at desc);

-- The only way a row lands in this table. SECURITY DEFINER so it writes as the
-- owner, past the RLS lockdown above.
--
-- Never raises: a failure to log must not roll back the operation being logged.
create or replace function public.log_security_event(
  p_kind text,
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.security_events (kind, actor, detail)
  values (p_kind, requesting_user_id(), coalesce(p_detail, '{}'::jsonb));

  -- Opportunistic retention: ~1 call in 100 also trims anything older than 90
  -- days. Inline on every write would put a delete scan on the hot path; never
  -- would grow the table forever. There is no cron on this project either, so
  -- retention stays inside the one function that writes here.
  if random() < 0.01 then
    delete from public.security_events where created_at < now() - interval '90 days';
  end if;
exception
  when others then
    -- Swallow deliberately (see above).
    return;
end;
$$;

-- EXECUTE defaults to PUBLIC in Postgres. Only the definer functions in 003 have
-- any reason to write audit rows, and they run as the owner already.
revoke all on function public.log_security_event(text, jsonb) from public;

-- ─── rate limiting ───────────────────────────────────────────────────────────
create table if not exists public.rate_limit_counters (
  actor        text        not null,
  kind         text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0,
  primary key (actor, kind, window_start)
);

-- Same lockdown as security_events, for the same reason: a client that could
-- edit its own counter has no rate limit.
alter table public.rate_limit_counters enable row level security;
revoke all on public.rate_limit_counters from anon, authenticated;

-- TRUNCATE ignores RLS, so on an append-only trail it is the one privilege that
-- could erase the whole thing in a statement. Reads stay: reading the trail back
-- with the service role is the documented triage path.
revoke all on public.security_events, public.rate_limit_counters from service_role;
grant select on public.security_events, public.rate_limit_counters to service_role;

comment on table public.rate_limit_counters is
  'Fixed-window request counters. Written only by rate_limit_hit(); no client '
  'role can read or modify it.';

-- Records one hit and reports whether the caller is now over the limit.
--
-- Fixed window (via date_bin), not a sliding one: a caller can burst up to twice
-- the limit across a window boundary. That is the standard trade for a limiter
-- that costs a single upsert, and the limit is set far enough above real usage
-- that a 2x boundary burst is still nowhere near abusive.
--
-- Logs to security_events exactly once per window -- on the call that crosses
-- the limit (hits = limit + 1) -- so hammering leaves one audit row per window
-- rather than one per request.
--
-- Never raises: the caller is fire-and-forget from the client and must not
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

  -- Opportunistic cleanup of windows nobody will read again: rare enough to stay
  -- off the hot path, frequent enough that the table cannot grow without bound.
  if random() < 0.01 then
    delete from public.rate_limit_counters where window_start < now() - interval '1 day';
  end if;

  if v_hits = p_limit + 1 then
    perform public.log_security_event(
      'rate_limited',
      jsonb_build_object('for', p_kind, 'limit', p_limit)
    );
  end if;

  return v_hits > p_limit;
exception
  when others then
    -- A broken limiter must not break the app. Fail open: this project has no
    -- breadth cap to fall back on, but a catalog whose ranking drifts is a much
    -- smaller problem than an add-item box that errors.
    return false;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, interval) from public;
