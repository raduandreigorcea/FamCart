-- A readable summary of the audit trail.
--
-- security_events (migration 029) records the right things but nothing surfaces
-- them, so in practice it only gets read if someone goes looking. This closes as
-- much of that gap as this architecture allows.
--
-- What is deliberately NOT built here: a push alert. The database has no outbound
-- path — pg_net was removed from this project on purpose (migration 007) because
-- an owner-configurable webhook was an SSRF and exfiltration surface, and
-- reintroducing it to send alerts would reopen exactly that hole. There is also
-- no cron and no server-side app layer to poll from.
--
-- The remaining honest options are:
--   • this: one query, run from the Supabase SQL editor when you want to look;
--   • an external poller (a scheduled GitHub Action) holding a database
--     credential. That is real alerting, but it puts a credential somewhere new,
--     which is a trade worth making deliberately rather than by default. If you
--     want it, give the poller a dedicated role with select on security_events
--     only — never the service role.
--
-- Idempotent: safe to re-run in the SQL editor.

-- Usage, in the Supabase SQL editor:
--   select * from public.security_digest();     -- last 7 days
--   select * from public.security_digest(30);   -- last 30 days
--
-- Read it as: anything with a nonzero rate_limited or invite_rate_limited count
-- is someone hitting a ceiling, and distinct_actors tells you whether it is one
-- account or many.
create or replace function public.security_digest(p_days integer default 7)
returns table (
  kind            text,
  events          bigint,
  distinct_actors bigint,
  first_seen      timestamptz,
  last_seen       timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.kind,
    count(*)                as events,
    count(distinct e.actor) as distinct_actors,
    min(e.created_at)       as first_seen,
    max(e.created_at)       as last_seen
  from public.security_events e
  where e.created_at > now() - make_interval(days => greatest(p_days, 1))
  group by e.kind
  order by count(*) desc, e.kind;
$$;

-- Never reachable from the client. SECURITY DEFINER means this function *can*
-- read the locked-down table, so the grant is the only thing standing between a
-- signed-in user and the audit trail — it goes to service_role alone.
revoke all on function public.security_digest(integer) from public;
grant execute on function public.security_digest(integer) to service_role;
