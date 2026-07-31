-- Server-side security audit trail.
--
-- Sentry only sees the browser. Someone hitting the PostgREST API directly with
-- a valid token never loads our JavaScript, so the events worth noticing —
-- failed invite-code attempts, role changes, member removals — left no trace
-- anywhere we control. This table is that trace, written by the database itself
-- so it records what actually happened rather than what a client chose to report.
--
-- Idempotent: safe to re-run in the SQL editor.

create table if not exists public.security_events (
  id         bigint      generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind       text        not null,
  actor      text,        -- Clerk user id; null when the caller was unauthenticated
  family_id  uuid,        -- deliberately no FK: see below
  detail     jsonb       not null default '{}'::jsonb
);

-- No foreign key on family_id on purpose. "Owner deleted the family and removed
-- everyone first" is exactly the sequence an audit log exists to preserve, and an
-- ON DELETE CASCADE would erase it at the moment it became interesting.

comment on table public.security_events is
  'Append-only audit trail. Written only by SECURITY DEFINER functions and '
  'triggers; unreadable by client roles. Read it from the SQL editor or with '
  'the service role.';

-- ─── access ──────────────────────────────────────────────────────────────────
-- RLS on with *zero policies* means no client role can select, insert, update or
-- delete: every row fails the (nonexistent) policy check. That is the whole
-- access model — an attacker who reaches the API with a valid token still cannot
-- read the log recording them, nor delete their own entries to cover the trail.
alter table public.security_events enable row level security;

-- Hosted Supabase hands the API roles table privileges by default privilege at
-- provisioning, so revoke explicitly rather than relying on RLS alone. Grants and
-- RLS are separate gates; this closes both.
revoke all on public.security_events from anon, authenticated;

create index if not exists idx_security_events_kind_created_at
  on public.security_events (kind, created_at desc);

-- Serves the rate limiter in migration 030: "how many events of this kind has
-- this actor produced recently".
create index if not exists idx_security_events_actor_kind_created_at
  on public.security_events (actor, kind, created_at desc);

-- ─── writer ──────────────────────────────────────────────────────────────────
-- The only way a row lands in this table. SECURITY DEFINER so it writes as the
-- owner, past the RLS lockdown above; callers are other definer functions and
-- the triggers below, never a client.
--
-- Never raises: a failure to log must not roll back the operation being logged.
-- Losing an audit row is bad, but breaking a member removal because the audit
-- write hiccuped is worse, and would turn the log into a denial-of-service knob.
create or replace function public.log_security_event(
  p_kind text,
  p_family_id uuid default null,
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.security_events (kind, actor, family_id, detail)
  values (p_kind, requesting_user_id(), p_family_id, coalesce(p_detail, '{}'::jsonb));

  -- Opportunistic retention: ~1 call in 100 also trims anything older than 90
  -- days. Doing it inline on every write would put a delete scan on the hot path;
  -- doing it never would grow the table forever. There is no cron on this project,
  -- so this keeps retention self-contained in the one function that writes here.
  if random() < 0.01 then
    delete from public.security_events where created_at < now() - interval '90 days';
  end if;
exception
  when others then
    -- Swallow deliberately (see above).
    return;
end;
$$;

-- EXECUTE defaults to PUBLIC in Postgres. Nothing outside this schema's own
-- definer functions and triggers has any reason to write audit rows, so no role
-- is granted execute at all — the callers run as the owner already.
revoke all on function public.log_security_event(text, uuid, jsonb) from public;

-- ─── membership auditing ─────────────────────────────────────────────────────
-- Role changes are the privilege-escalation surface (member → moderator gives
-- rename/kick powers, migration 011), and removals are how someone loses access.
-- Both go through plain UPDATE/DELETE under RLS rather than an RPC, so a trigger
-- is the only place that sees every path.
create or replace function public.audit_member_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    perform public.log_security_event(
      'member_role_changed',
      new.family_id,
      jsonb_build_object('target', new.user_id, 'from', old.role, 'to', new.role)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_member_role_change on public.family_members;
create trigger trg_audit_member_role_change
after update on public.family_members
for each row
execute function public.audit_member_role_change();

create or replace function public.audit_member_removal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.log_security_event(
    'member_removed',
    old.family_id,
    jsonb_build_object(
      'target', old.user_id,
      'role', old.role,
      -- Distinguishes leaving voluntarily from being kicked, which is the part
      -- worth knowing when reading this log back.
      'self', old.user_id is not distinct from requesting_user_id()
    )
  );
  return old;
end;
$$;

drop trigger if exists trg_audit_member_removal on public.family_members;
create trigger trg_audit_member_removal
after delete on public.family_members
for each row
execute function public.audit_member_removal();
