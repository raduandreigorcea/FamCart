-- ─── profiles: one source of truth for member identity ───────────────────────
-- A user's Clerk display name and avatar used to be copied onto every row that
-- referenced them: once per family_members row (so a user in three families
-- stored three copies) and once per shopping_list_items row. Those copies were
-- also write-once — captured at join/add time and never refreshed — so changing
-- your Clerk photo left every old family and list item showing the stale one.
--
-- This migration moves that identity into a single profiles row keyed by the
-- Clerk user id. family_members and the active shopping list now carry only the
-- user id and resolve name/avatar by joining profiles, so a profile edit shows
-- up everywhere at once. purchase_history keeps its own added_by_name /
-- added_by_image_url: history is an archive and is meant to freeze who added an
-- item and how they looked at the time, so those columns stay a deliberate
-- snapshot, not redundancy.
--
-- The whole file is idempotent, so it is safe to re-run in the SQL editor.

create table if not exists public.profiles (
  user_id      text        primary key,            -- Clerk user id
  display_name text        not null default 'Member',
  image_url    text,
  updated_at   timestamptz not null default now(),
  constraint profiles_display_name_length
    check (char_length(display_name) between 1 and 80),
  -- Same https-only rule the old family_members/shopping_list_items columns
  -- enforced (migration 014): an arbitrary scheme lets a member point <img src>
  -- at a logging/beacon endpoint.
  constraint profiles_image_url_scheme
    check (image_url is null or (image_url ~ '^https://' and char_length(image_url) <= 2048))
);

alter table public.profiles enable row level security;

-- ─── backfill ────────────────────────────────────────────────────────────────
-- Seed one profile per user from the copies we are about to drop, freshest wins.
-- family_members first (the roster is the authority on who exists), then any
-- active-list adder not already covered, so existing list avatars survive the
-- column drop below. distinct on picks the most recent row per user; image_url
-- rides along from that same row.
--
-- Guarded on the source columns existing: this file drops them further down, so
-- on a second run (columns already gone) the backfill is simply skipped rather
-- than erroring on a missing column — keeping the whole file re-runnable.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'family_members'
      and column_name = 'display_name'
  ) then
    insert into public.profiles (user_id, display_name, image_url, updated_at)
    select distinct on (fm.user_id)
      fm.user_id,
      coalesce(nullif(btrim(fm.display_name), ''), 'Member'),
      case when fm.image_url ~ '^https://' and char_length(fm.image_url) <= 2048
           then fm.image_url else null end,
      now()
    from public.family_members fm
    order by fm.user_id, fm.joined_at desc
    on conflict (user_id) do nothing;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'shopping_list_items'
      and column_name = 'added_by_name'
  ) then
    insert into public.profiles (user_id, display_name, image_url, updated_at)
    select distinct on (s.added_by)
      s.added_by,
      coalesce(nullif(btrim(s.added_by_name), ''), 'Member'),
      case when s.added_by_image_url ~ '^https://' and char_length(s.added_by_image_url) <= 2048
           then s.added_by_image_url else null end,
      now()
    from public.shopping_list_items s
    where s.added_by is not null
    order by s.added_by, s.created_at desc
    on conflict (user_id) do nothing;
  end if;
end $$;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- You can read your own profile and the profile of anyone who shares a family
-- with you (so their avatar renders in the roster and on their list items). A
-- SECURITY DEFINER helper does the co-membership check, mirroring
-- is_member_of_family() (migration 006): running it as the owner sidesteps the
-- RLS recursion that a family_members subquery inside a profiles policy would hit
-- (family_members' own SELECT policy only exposes the requester's memberships).
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

drop policy if exists "read own or co-member profiles" on public.profiles;
create policy "read own or co-member profiles"
  on public.profiles for select
  to authenticated
  using (user_id = requesting_user_id() or public.shares_family_with(user_id));

-- A user may create and edit only their own profile row.
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

-- Same reasoning as migration 015: a from-migrations database needs explicit
-- grants for the client-facing role.
grant select, insert, update on public.profiles to authenticated;

-- ─── family_members references profiles ──────────────────────────────────────
-- Every family_members.user_id now has a profile (backfilled above), so the FK
-- both enforces that invariant and lets PostgREST embed profiles(...) in the
-- roster query. Guarded so re-running the file is a no-op.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'family_members_user_id_profiles_fkey'
      and conrelid = 'public.family_members'::regclass
  ) then
    alter table public.family_members
      add constraint family_members_user_id_profiles_fkey
      foreign key (user_id) references public.profiles(user_id);
  end if;
end $$;

-- Drop the denormalized copies now that profiles owns them.
alter table public.family_members drop constraint if exists family_members_image_url_scheme_check;
alter table public.family_members drop column if exists display_name;
alter table public.family_members drop column if exists image_url;

-- ─── join flow writes profiles ───────────────────────────────────────────────
-- join_family_with_code() upserts the joiner's profile (the FK target, and the
-- place a fresh Clerk photo lands) before inserting the membership, which now
-- carries no profile columns of its own. Same clamping the old version applied.
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
  v_user text := requesting_user_id();
  v_family record;
begin
  if v_user is null then
    return;
  end if;

  select f.id, f.name into v_family
  from public.families f
  where f.invite_code = p_code;

  if not found then
    return;
  end if;

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

  return query select v_family.id, v_family.name;
end;
$$;

revoke all on function public.join_family_with_code(text, text, text) from public;
grant execute on function public.join_family_with_code(text, text, text) to authenticated;

-- ─── shopping list stops copying author identity ─────────────────────────────
-- The stamp trigger (migration 014) existed to overwrite client-supplied author
-- name/avatar from the family_members copy on insert. With the columns gone the
-- list resolves the author from profiles by added_by at render time, so both the
-- trigger and the columns go away.
drop trigger if exists trg_stamp_item_author_identity on public.shopping_list_items;
drop function if exists public.stamp_item_author_identity();

alter table public.shopping_list_items drop constraint if exists shopping_list_items_added_by_image_url_check;
alter table public.shopping_list_items drop column if exists added_by_name;
alter table public.shopping_list_items drop column if exists added_by_image_url;

-- ─── buy_items snapshots the profile into history ────────────────────────────
-- Same shape as migration 023, but the archived added_by_name / added_by_image_url
-- are read from profiles at buy time (a left join, so an item added by someone
-- who has since left still archives with a 'Member' fallback) instead of from the
-- now-removed shopping_list_items columns. This is where the deliberate history
-- snapshot is taken.
create or replace function public.buy_items(p_item_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user text := requesting_user_id();
  v_checkout_id uuid := gen_random_uuid();
  moved integer;
begin
  if v_user is null then
    return 0;
  end if;

  with removed as (
    delete from public.shopping_list_items
    where id = any(p_item_ids)
      and checked = true
      and family_id in (
        select fm.family_id from public.family_members fm
        where fm.user_id = v_user
      )
    returning family_id, id, name, maker, quantity, added_by
  )
  insert into public.purchase_history
    (checkout_id, family_id, item_id, name, maker, quantity, added_by, added_by_name, added_by_image_url, purchased_by)
  select
    v_checkout_id, r.family_id, r.id, r.name, r.maker, r.quantity, r.added_by,
    coalesce(p.display_name, 'Member'), p.image_url, v_user
  from removed r
  left join public.profiles p on p.user_id = r.added_by;

  get diagnostics moved = row_count;
  return moved;
end;
$$;

grant execute on function public.buy_items(uuid[]) to authenticated;
