-- ─── families, members, and profiles ─────────────────────────────────────────
-- Who exists, who belongs to what, and who is allowed to change it.
--
-- Three tables, in dependency order: profiles (identity), families (the group),
-- family_members (the join, which references both).
--
-- The permission model in one paragraph: a family has exactly one owner, the
-- account in families.created_by, and it can never be reassigned. The owner may
-- rename the family, delete it, and grant or revoke the moderator rank.
-- Moderators may change operational settings and remove plain members. Everyone
-- else may read the roster and remove only themselves. Policies decide who may
-- touch a row; triggers decide which columns of it, because a policy cannot see
-- the difference between renaming a family and changing its owner.

-- ─── profiles ────────────────────────────────────────────────────────────────
-- One source of truth for member identity.
--
-- A user's Clerk display name and avatar is stored once, here, keyed by Clerk
-- user id. family_members and the active shopping list carry only the user id
-- and resolve name/avatar by joining this table, so a profile edit shows up
-- everywhere at once.
--
-- purchase_history (005) deliberately does NOT do this: it keeps its own
-- added_by_name / added_by_image_url columns, because history is an archive and
-- is meant to freeze who added an item and how they looked at the time. That is
-- a snapshot, not redundancy.
create table if not exists public.profiles (
  user_id      text        primary key,            -- Clerk user id
  display_name text        not null default 'Member',
  image_url    text,
  updated_at   timestamptz not null default now(),
  constraint profiles_display_name_length
    check (char_length(display_name) between 1 and 80),
  -- https-only: an arbitrary scheme lets a member point an <img src> at a
  -- logging/beacon endpoint. The client mirrors this in deriveProfileFields()
  -- (src/lib/userIdentity.ts), but this is the authority.
  constraint profiles_image_url_scheme
    check (image_url is null or (image_url ~ '^https://' and char_length(image_url) <= 2048))
);

alter table public.profiles enable row level security;

-- ─── families ────────────────────────────────────────────────────────────────
-- The client mirrors these caps in src/lib/limits.ts so the UI can refuse early,
-- but every value here is the authority.
create table if not exists public.families (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  invite_code text        not null unique,
  created_by  text        not null,   -- Clerk user ID; the owner, permanently
  -- How many active items each member of this family may hold. Owner- and
  -- moderator-configurable.
  max_items_per_member integer not null default 50,
  -- Optional emoji identifying the family in the switcher. Capped generously
  -- enough for one multi-codepoint emoji (flags, ZWJ family sequences).
  emoji       text,
  created_at  timestamptz not null default now(),
  constraint families_name_length_check
    check (char_length(btrim(name)) between 1 and 25),
  -- Mirrors the generator and validator in src/lib/inviteCode.ts. The alphabet
  -- omits I, O, 0 and 1 because the code gets read aloud and typed by hand.
  constraint families_invite_code_format_check
    check (invite_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  constraint families_max_items_per_member_check
    check (max_items_per_member between 1 and 50),
  constraint families_emoji_length_check
    check (emoji is null or char_length(emoji) <= 16)
);

-- ─── bounds that have to be restated ─────────────────────────────────────────
-- Everything inside `create table if not exists` above applies only when the
-- table is created. On a database where families already exists — which is every
-- database this file has run against more than once — that whole block is
-- skipped, so changing a bound here never reaches it.
--
-- That is not hypothetical. Production allowed 40-character family names while
-- this file said 25, and re-running the file could not converge it: the server
-- was quietly more permissive than both this schema and the client, which caps
-- the form at FAMILY_NAME_MAX_LENGTH (src/lib/limits.ts). A hand-crafted request
-- could set a name longer than anything the UI is built to show.
--
-- Restating the bound as an explicit ALTER is what makes re-running this file
-- actually converge it. Only this constraint is restated, because only this one
-- has drifted — but any bound in the block above needs the same treatment the
-- day it changes, or it will silently apply to new databases only.
alter table public.families drop constraint if exists families_name_length_check;
alter table public.families add constraint families_name_length_check
  check (char_length(btrim(name)) between 1 and 25);

alter table public.families enable row level security;

-- One family owned per account. A unique index rather than a policy check, so
-- two concurrent inserts cannot both slip past it. Deleting a family frees the
-- slot, and joining another family is unaffected: this caps ownership, not
-- membership.
create unique index if not exists families_one_per_owner
  on public.families (created_by);

-- ─── family_members ──────────────────────────────────────────────────────────
create table if not exists public.family_members (
  id        uuid        primary key default gen_random_uuid(),
  family_id uuid        not null references public.families(id) on delete cascade,
  -- FK to profiles so PostgREST can embed profiles(...) in the roster query, and
  -- so every member is guaranteed to have identity to render. Named explicitly
  -- rather than left to Postgres: PostgREST resolves an embed by constraint, and
  -- the disambiguating hint syntax (profiles!<constraint>) names it directly, so
  -- the name is part of the API surface rather than an implementation detail.
  user_id   text        not null
              constraint family_members_user_id_profiles_fkey
              references public.profiles(user_id),
  -- 'admin' is a legacy spelling of 'moderator' that predates the rename. It
  -- cannot occur on a database created from these migrations, and is kept in the
  -- constraint only so the rank set matches what normalizeMemberRole()
  -- (src/lib/memberRoles.ts) still defensively accepts. Narrowing it would be a
  -- behaviour change, not a cleanup.
  role      text        not null default 'member'
              check (role in ('admin', 'moderator', 'member')),
  joined_at timestamptz not null default now(),
  unique (family_id, user_id)
);

alter table public.family_members enable row level security;

-- Every roster read and every is_member_of_family() call filters on family_id.
create index if not exists idx_family_members_family_id
  on public.family_members (family_id);

-- ─── policy helpers ──────────────────────────────────────────────────────────
-- All three are SECURITY DEFINER on purpose. A policy on family_members that
-- subqueries family_members recurses into that table's own SELECT policy, which
-- only exposes the requester's own rows — so the check would answer the wrong
-- question. Running as the owner sidesteps RLS for the lookup itself while the
-- policy above it still decides what the caller sees.

create or replace function public.is_member_of_family(target_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.family_members fm
    where fm.family_id = target_family_id
      and fm.user_id = requesting_user_id()
  );
$$;

grant execute on function public.is_member_of_family(uuid) to anon, authenticated;

create or replace function public.is_family_owner_or_moderator(target_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.families f
    where f.id = target_family_id
      and (
        f.created_by = requesting_user_id()
        or exists (
          select 1
          from public.family_members fm
          where fm.family_id = target_family_id
            and fm.user_id = requesting_user_id()
            and fm.role in ('admin', 'moderator')
        )
      )
  );
$$;

grant execute on function public.is_family_owner_or_moderator(uuid) to anon, authenticated;

-- Co-membership, for the profiles read policy: may I see this person's avatar?
create or replace function public.shares_family_with(target_user_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.family_members me
    join public.family_members them on them.family_id = me.family_id
    where me.user_id = requesting_user_id()
      and them.user_id = target_user_id
  );
$$;

grant execute on function public.shares_family_with(text) to authenticated;

-- ─── policies: profiles ──────────────────────────────────────────────────────
-- You can read your own profile and that of anyone who shares a family with you,
-- so their avatar renders in the roster and on their list items. You can create
-- and edit only your own.
drop policy if exists "read own or co-member profiles" on public.profiles;
create policy "read own or co-member profiles"
  on public.profiles for select
  to authenticated
  using (user_id = requesting_user_id() or public.shares_family_with(user_id));

drop policy if exists "insert own profile" on public.profiles;
create policy "insert own profile"
  on public.profiles for insert
  to authenticated
  with check (user_id = requesting_user_id());

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile"
  on public.profiles for update
  to authenticated
  using (user_id = requesting_user_id())
  with check (user_id = requesting_user_id());

-- ─── policies: families ──────────────────────────────────────────────────────
drop policy if exists "family members can read their family" on public.families;
create policy "family members can read their family"
  on public.families for select
  using (
    id in (
      select family_id from public.family_members
      where user_id = requesting_user_id()
    )
  );

-- Covers the create-family INSERT ... RETURNING, before the creator's
-- family_members row exists. Scoped so it never exposes other tenants' rows.
-- Note there is deliberately no "read any family by invite code" policy: joining
-- goes through join_family_with_code() below, which is the only thing that ever
-- resolves a code.
drop policy if exists "family owners can read own families" on public.families;
create policy "family owners can read own families"
  on public.families for select
  using (created_by = requesting_user_id());

drop policy if exists "authenticated users can create a family" on public.families;
create policy "authenticated users can create a family"
  on public.families for insert
  with check (created_by = requesting_user_id());

-- Owners and moderators may update the family; the triggers below decide which
-- columns each of them may actually touch.
--
-- Both halves check the same thing on purpose. USING is evaluated against the
-- OLD row and answers "may you touch this family"; WITH CHECK is evaluated
-- against the NEW one and is what stops an update producing a row the caller
-- could not have reached. Leaving WITH CHECK as `true` — as an earlier revision
-- of this policy did — makes the triggers the only guard, and a trigger that
-- silently falls out of step with the schema is a real failure mode this project
-- has already hit once.
drop policy if exists "family owner or moderator can update family" on public.families;
create policy "family owner or moderator can update family"
  on public.families for update
  using (public.is_family_owner_or_moderator(id))
  with check (public.is_family_owner_or_moderator(id));

drop policy if exists "family owner can delete family" on public.families;
create policy "family owner can delete family"
  on public.families for delete
  using (created_by = requesting_user_id());

-- ─── policies: family_members ────────────────────────────────────────────────
-- Family-wide read, so every member can see the roster (avatars in the top nav).
drop policy if exists "family members can read family memberships" on public.family_members;
create policy "family members can read family memberships"
  on public.family_members for select
  using (public.is_member_of_family(family_id));

-- The ONLY direct insert path, and it is narrow: a family creator seeding their
-- own membership row immediately after creating the family. Everyone else joins
-- through join_family_with_code(), which is the only path that checks the invite
-- code. This is what makes rotating a code genuinely lock someone out — without
-- it, anyone who ever knew a family's uuid could re-insert themselves forever.
drop policy if exists "family creators can seed own membership" on public.family_members;
create policy "family creators can seed own membership"
  on public.family_members for insert
  with check (
    user_id = requesting_user_id()
    and exists (
      select 1 from public.families f
      where f.id = family_id
        and f.created_by = requesting_user_id()
    )
  );

-- Members may always remove themselves; the owner may remove anyone; a moderator
-- may remove only plain members (never the owner, never another moderator).
drop policy if exists "family owner or moderator or self can delete memberships" on public.family_members;
create policy "family owner or moderator or self can delete memberships"
  on public.family_members for delete
  using (
    user_id = requesting_user_id()
    or exists (
      select 1 from public.families f
      where f.id = family_id
        and f.created_by = requesting_user_id()
    )
    or (
      public.is_family_owner_or_moderator(family_id)
      and role = 'member'
      and user_id is distinct from (
        select f.created_by from public.families f where f.id = family_id
      )
    )
  );

-- Family-wide so the owner can change roles; the promotion trigger below narrows
-- it to owner-only for the role column itself.
drop policy if exists "family owner or moderator can update memberships" on public.family_members;
create policy "family owner or moderator can update memberships"
  on public.family_members for update
  using (public.is_family_owner_or_moderator(family_id))
  with check (public.is_family_owner_or_moderator(family_id));

-- ─── column-level rules the policies cannot express ──────────────────────────

-- The owner is permanent. Deleting the family is the only way to end it.
create or replace function public.prevent_family_owner_change()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'Family owner cannot be changed.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- Moderators may change operational settings, but the family's name is the
-- owner's to choose.
create or replace function public.prevent_moderator_family_name_change()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if requesting_user_id() is distinct from old.created_by
     and new.name is distinct from old.name then
    raise exception 'Only the family owner can change the family name.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- Only the owner grants or revokes the moderator rank. Without this, a moderator
-- could promote others (or themselves via a second account) indefinitely.
create or replace function public.prevent_moderator_promotion_to_moderator()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  owner_user_id text;
begin
  select f.created_by
    into owner_user_id
  from public.families f
  where f.id = new.family_id;

  if requesting_user_id() is distinct from owner_user_id
     and new.role is distinct from old.role then
    raise exception 'Only the family owner can change member roles.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- A user may belong to at most 3 families. Ownership is separately capped at 1
-- (families_one_per_owner above), so a user can own one and join two more, or
-- join three.
--
-- A trigger rather than a policy so it holds against every write path (the join
-- RPC and the creator seeding their own row alike).
--
-- The count is serialized per user with a transaction-scoped advisory lock keyed
-- on the user id: without it, two concurrent joins each read a stale count under
-- READ COMMITTED (neither sees the other's uncommitted row) and both slip past,
-- leaving the user over the cap.
create or replace function public.enforce_family_membership_limit()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  member_limit constant integer := 3;
begin
  -- An idempotent re-join (join_family_with_code upserts ON CONFLICT DO NOTHING)
  -- is not a new membership, so it must not trip the cap. The BEFORE trigger fires
  -- before the conflict is resolved, so guard on the existing row explicitly.
  if exists (
    select 1 from public.family_members
    where family_id = new.family_id and user_id = new.user_id
  ) then
    return new;
  end if;

  -- Serialize concurrent membership inserts for this user (see header note). The
  -- lock is released automatically at transaction end. hashtextextended keeps the
  -- text user_id inside the bigint key space the advisory-lock API expects.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id, 0));

  if (
    select count(*) from public.family_members where user_id = new.user_id
  ) >= member_limit then
    raise exception 'You can be part of at most % families.', member_limit
      using errcode = 'P0001', detail = 'family_membership_limit_exceeded';
  end if;

  return new;
end;
$$;

-- ─── auditing ────────────────────────────────────────────────────────────────
-- Role changes are the privilege-escalation surface (member → moderator grants
-- rename and kick powers), and removals are how someone loses access. Both go
-- through plain UPDATE/DELETE under RLS rather than an RPC, so a trigger is the
-- only place that sees every path.
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

drop trigger if exists trg_prevent_family_owner_change on public.families;
create trigger trg_prevent_family_owner_change
before update on public.families
for each row
execute function public.prevent_family_owner_change();

drop trigger if exists trg_prevent_moderator_family_name_change on public.families;
create trigger trg_prevent_moderator_family_name_change
before update on public.families
for each row
execute function public.prevent_moderator_family_name_change();

drop trigger if exists trg_prevent_moderator_promotion_to_moderator on public.family_members;
create trigger trg_prevent_moderator_promotion_to_moderator
before update on public.family_members
for each row
execute function public.prevent_moderator_promotion_to_moderator();

drop trigger if exists trg_enforce_family_membership_limit on public.family_members;
create trigger trg_enforce_family_membership_limit
before insert on public.family_members
for each row
execute function public.enforce_family_membership_limit();

drop trigger if exists trg_audit_member_role_change on public.family_members;
create trigger trg_audit_member_role_change
after update on public.family_members
for each row
execute function public.audit_member_role_change();

drop trigger if exists trg_audit_member_removal on public.family_members;
create trigger trg_audit_member_removal
after delete on public.family_members
for each row
execute function public.audit_member_removal();

-- ─── joining by invite code ──────────────────────────────────────────────────
-- The invite code is a real credential, and this is the only thing that checks
-- it. Verifying the code, upserting the joiner's profile and inserting the
-- membership all happen in one server-side step; the direct INSERT policy above
-- covers only the creator-seeding case, so there is no client path that joins a
-- family without presenting a valid code.
--
-- Throttling, honestly scoped: the limit is per Clerk user, because PostgREST
-- does not hand the database a client IP. Someone willing to mint many Clerk
-- accounts can still spread attempts across them — Clerk's own signup rate
-- limiting is what covers that, and a 32^8 (~1.1 trillion) code space is what
-- makes the exercise pointless. The goal here is a ceiling plus a trail, not an
-- impregnable gate.
--
-- Note what does NOT exist: any function that merely resolves a code to a family
-- without joining. Such a lookup is a free yes/no oracle — exactly the primitive
-- a brute-forcer wants, and cheaper to call than this. Every invite-code check
-- goes through this throttled, audited path.
create or replace function public.join_family_with_code(
  p_code text,
  p_display_name text default null,
  p_image_url text default null
)
returns table (id uuid, name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Ten wrong codes in fifteen minutes. A real person mistyping an 8-character
  -- code does not get near this; a script does so immediately.
  max_failures  constant integer  := 10;
  window_length constant interval := interval '15 minutes';
  v_user   text := requesting_user_id();
  v_family record;
  v_recent_failures integer;
begin
  if v_user is null then
    return;
  end if;

  select count(*)::integer into v_recent_failures
  from public.security_events
  where actor = v_user
    and kind = 'invite_code_failed'
    and created_at > now() - window_length;

  if v_recent_failures >= max_failures then
    perform public.log_security_event(
      'invite_rate_limited',
      null,
      jsonb_build_object('failures_in_window', v_recent_failures)
    );
    -- Return empty rather than raising, for two reasons.
    --
    -- 1. Correctness: RAISE would abort the transaction, and the audit row just
    --    written above would roll back with it — the log would be blank at exactly
    --    the moment it mattered. Postgres has no autonomous transactions, so a
    --    clean return is the only way the record survives.
    -- 2. Security: the caller cannot distinguish "throttled" from "wrong code", so
    --    the throttle itself leaks nothing about whether guesses were landing.
    --
    -- The cost is that a user who really did mistype ten times sees "No family
    -- found with that invite code" until the window clears. Rare enough, and a
    -- softer failure than a scary error.
    return;
  end if;

  select f.id, f.name into v_family
  from public.families f
  where f.invite_code = p_code;

  if not found then
    -- The code itself is deliberately not logged: it is a credential, and an
    -- audit table that accumulates near-miss guesses would become a place worth
    -- stealing. The count is what tells the story.
    perform public.log_security_event('invite_code_failed');
    return;
  end if;

  -- Clamp to what the profiles constraints allow rather than failing the join on
  -- an overlong name or a non-https avatar URL.
  insert into public.profiles (user_id, display_name, image_url, updated_at)
  values (
    v_user,
    coalesce(nullif(left(btrim(p_display_name), 80), ''), 'Member'),
    case when p_image_url ~ '^https://' and char_length(p_image_url) <= 2048 then p_image_url else null end,
    now()
  )
  on conflict (user_id) do update
    set display_name = excluded.display_name,
        image_url = excluded.image_url,
        updated_at = now();

  insert into public.family_members (family_id, user_id, role)
  values (v_family.id, v_user, 'member')
  on conflict (family_id, user_id) do nothing;  -- already a member: idempotent

  perform public.log_security_event('invite_join_succeeded', v_family.id);

  return query select v_family.id, v_family.name;
end;
$$;

revoke all on function public.join_family_with_code(text, text, text) from public;
grant execute on function public.join_family_with_code(text, text, text) to authenticated;

-- ─── grants ──────────────────────────────────────────────────────────────────
-- RLS above decides which rows; these decide that the role may reach the tables
-- at all. Note profiles gets no DELETE: a profile is the FK target for every
-- membership, and there is no product flow that removes one.
grant select, insert, update, delete on public.families, public.family_members to authenticated;
grant select, insert, update on public.profiles to authenticated;
