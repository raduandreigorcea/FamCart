-- ─── families → households ───────────────────────────────────────────────────
-- A one-time rename of the entity this app is built around. "Family" was never
-- what the schema modelled: a household here is one shared shopping list plus
-- the people on it, and a person can be in three of them. You do not have three
-- families; you might well shop for three households.
--
-- WHY THIS FILE SORTS BEFORE 001
--
-- The seven files after this one restate the schema as it IS, so they are all
-- `create table if not exists`. Re-running them with the new names against a
-- database that still holds `families` would not rename anything — it would
-- find no `households`, create a fresh empty one, and leave every existing row
-- stranded in a table nothing queries any more. The rename has to happen first,
-- and then 001-007 rebuild every policy, function and trigger on top of the
-- already-renamed tables. Hence 000.
--
-- So the push is the documented dance from CLAUDE.md, over all seven:
--
--   npx supabase migration repair --status reverted 001 002 003 004 005 006 007 --linked
--   npx supabase db push --dry-run --include-all --linked
--   npx supabase db push --include-all --linked
--
-- `--include-all` is required: this file sorts before every applied migration.
--
-- WHY IT IS SAFE TO RE-RUN
--
-- Everything below is wrapped in one guard on `public.families` still existing.
-- On a database built from the updated 001-007 the tables are already named
-- correctly, the guard is false, and the whole file is a no-op. On production it
-- runs exactly once and the guard is false forever after.
--
-- WHAT IS DELIBERATELY NOT RENAMED
--
-- Nothing in localStorage. The cache and the offline queue persist `familyId`
-- and `family_id` in browsers that are already out there, and those keys are
-- read by a client that may be a version behind. src/lib/householdCache.ts
-- reads both shapes; see the note there.

do $$
declare
  r record;
begin
  -- The whole file, gated once. `to_regclass` returns null rather than raising
  -- when the table is absent, which is what makes this safe on a fresh database.
  if to_regclass('public.families') is null then
    raise notice 'families not present; rename already applied or database is new';
    return;
  end if;

  -- ─── 1. policies ───────────────────────────────────────────────────────────
  -- Dropped wholesale rather than by name. Twelve of the eighteen carry "family"
  -- in their own name, 001-007 recreate every one of them later in this same
  -- push, and enumerating them by hand is the one step here where a typo would
  -- leave a table quietly unprotected.
  --
  -- There is no exposure window: RLS stays ENABLED on all six tables, and a
  -- table with RLS on and no policies denies every row to every non-superuser.
  -- The failure mode between here and 007 is "denied", never "readable".
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'families', 'family_members', 'profiles',
        'shopping_list_items', 'purchase_history', 'product_catalog'
      )
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      r.policyname, r.schemaname, r.tablename
    );
  end loop;

  -- ─── 2. functions whose identity changes ───────────────────────────────────
  -- Two reasons a function has to be dropped rather than left to the
  -- `create or replace` in 001-007:
  --
  --   * its name changes — a replace would leave the old name in place too, and
  --     a stale is_member_of_family() outliving the table it queries is exactly
  --     the drift this schema's notes keep warning about;
  --   * only its parameter name changes — Postgres refuses to rename an input
  --     parameter through CREATE OR REPLACE ("cannot change name of input
  --     parameter"), so p_family_id → p_household_id needs a drop as well.
  --
  -- CASCADE takes the triggers built on these functions with them; 003 through
  -- 006 recreate every one. It does NOT touch other functions that merely call
  -- them, because a plpgsql body is not a tracked dependency — those callers are
  -- rebuilt later in this push regardless.

  -- name changes
  drop function if exists public.is_member_of_family(uuid) cascade;
  drop function if exists public.is_family_owner_or_moderator(uuid) cascade;
  drop function if exists public.shares_family_with(text) cascade;
  drop function if exists public.prevent_family_owner_change() cascade;
  drop function if exists public.prevent_moderator_family_name_change() cascade;
  drop function if exists public.enforce_family_membership_limit() cascade;
  drop function if exists public.join_family_with_code(text, text, text) cascade;

  -- parameter-name changes only
  drop function if exists public.log_security_event(text, uuid, jsonb) cascade;
  drop function if exists public.add_custom_product(uuid, text, text) cascade;
  drop function if exists public.add_custom_product_unthrottled(uuid, text, text) cascade;
  drop function if exists public.bump_product_popularity(text, text, uuid) cascade;

  -- ─── 3. tables ─────────────────────────────────────────────────────────────
  -- Metadata-only in Postgres: no table rewrite, no lock held longer than the
  -- statement, and every foreign key pointing at families follows automatically.
  alter table public.families       rename to households;
  alter table public.family_members rename to household_members;

  -- ─── 4. columns ────────────────────────────────────────────────────────────
  -- Each guarded independently: 002's security_events.family_id has no foreign
  -- key (see the note in that file), so it is possible for it to have been
  -- renamed already while the rest has not.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'household_members'
               and column_name = 'family_id') then
    alter table public.household_members rename column family_id to household_id;
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'shopping_list_items'
               and column_name = 'family_id') then
    alter table public.shopping_list_items rename column family_id to household_id;
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'purchase_history'
               and column_name = 'family_id') then
    alter table public.purchase_history rename column family_id to household_id;
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'product_catalog'
               and column_name = 'family_id') then
    alter table public.product_catalog rename column family_id to household_id;
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'security_events'
               and column_name = 'family_id') then
    alter table public.security_events rename column family_id to household_id;
  end if;
end
$$;

-- ─── 5. constraint and index names ───────────────────────────────────────────
-- Renaming a table or a column rewrites what its constraints MEAN but not what
-- they are CALLED, so without this a households table keeps a set of
-- families_*_check constraints and PostgREST keeps advertising
-- family_members_user_id_profiles_fkey.
--
-- Done by pattern rather than by list because several of these names were
-- generated by Postgres, not written here — families_pkey,
-- family_members_family_id_user_id_key — and guessing them is how a rename
-- misses one.
--
-- Two of them are load-bearing rather than cosmetic:
--
--   families_name_length_check       003 restates this bound as an explicit
--                                    drop-and-add, so a leftover under the old
--                                    name would survive as a second, duplicate
--                                    constraint on the same column.
--   family_members_user_id_..._fkey  named on purpose in 003 because PostgREST
--                                    resolves an embedded profiles(...) by
--                                    constraint name; it is API surface, not an
--                                    implementation detail.
do $$
declare
  r record;
  new_name text;
begin
  for r in
    select c.conname, c.conrelid::regclass::text as tbl
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public'
      and c.conname like '%famil%'
  loop
    new_name := replace(replace(r.conname, 'families', 'households'), 'family', 'household');
    execute format('alter table %s rename constraint %I to %I', r.tbl, r.conname, new_name);
  end loop;

  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'i'
      and c.relname like '%famil%'
      -- Index-backed constraints were renamed by the loop above; their indexes
      -- came along with them, and renaming those again here would fail.
      and not exists (select 1 from pg_constraint pc where pc.conindid = c.oid)
  loop
    new_name := replace(replace(r.relname, 'families', 'households'), 'family', 'household');
    execute format('alter index public.%I rename to %I', r.relname, new_name);
  end loop;
end
$$;
