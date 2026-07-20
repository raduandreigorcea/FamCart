-- ─── product_catalog ─────────────────────────────────────────────────────────
-- The products offered while typing in the add-item input: a seeded global
-- catalog, plus the products families contribute themselves.
--
-- Scope lives in one column:
--   family_id is null  - global. Seeded by scripts/seed-products.mjs with the
--                        service role key, and suggested to everyone.
--   family_id = <uuid> - contributed via add_custom_product(), and suggested only
--                        back to that family until enough other families add the
--                        same product, at which point it is promoted to global.
--
-- That promotion rule is what makes a user-writable catalog safe. A misspelling
-- one family types stays scoped to them forever and nobody else ever sees it,
-- while a product several families independently ask for earns its way in on its
-- own. No moderation queue, and no way for one family's spelling to leak into
-- everyone else's suggestions -- the threshold counts distinct contributing
-- *accounts* (contributed_by), so crossing it takes three separate people who
-- each added the product in their own family. One account that belongs to three
-- families and types the same junk into all three still counts as one and cannot
-- self-promote. Migration 001's one-family-per-owner cap is a complementary
-- product rule, no longer the load-bearing part of this gate.
--
-- Clients never write this table directly: RLS grants SELECT and nothing else.
-- The service role (which bypasses RLS) seeds it, and the two SECURITY DEFINER
-- RPCs at the bottom are the only writes reachable from the app.
--
-- Ranking is the sum of two columns, kept apart so re-seeding never wipes earned
-- usage:
--   base_weight - editorial cold-start baseline from products.json. The seed
--                 script overwrites it freely on every run.
--   add_count   - times the product was actually added. Only the RPCs touch it.
-- popularity is their stored sum, and suggestions order by it descending.
--
-- The whole file is idempotent, so it is safe to re-run in the SQL editor.

-- pg_trgm powers the substring match on search_text; unaccent lets the server
-- derive search_text itself, which it must: a client-supplied one would become
-- everyone's matching key once a contributed product is promoted.
create extension if not exists pg_trgm  with schema extensions;
create extension if not exists unaccent with schema extensions;

create table if not exists public.product_catalog (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,   -- e.g. "Apa Plata 2L"
  maker       text,                   -- e.g. "Dorna", shown as a subtitle
  -- Lowercased, diacritic-free "name maker" that typed input is matched against,
  -- so "apă" typed with or without accents finds "Apa Plata 2L Dorna". Derived by
  -- product_search_text() below.
  search_text text        not null,
  -- Null for the seeded global catalog; the contributing family otherwise.
  family_id   uuid        references public.families(id) on delete cascade,
  -- Who first contributed a scoped row (requesting_user_id()); null for seeded
  -- globals. Promotion counts distinct values of this, so it is the account
  -- identity the anti-abuse threshold is measured in.
  contributed_by text,
  base_weight integer     not null default 0,
  add_count   integer     not null default 0,
  popularity  integer     generated always as (base_weight + add_count) stored,
  created_at  timestamptz not null default now(),
  constraint product_catalog_name_length
    check (char_length(name) between 1 and 120),
  constraint product_catalog_maker_length
    check (maker is null or char_length(maker) between 1 and 60),
  constraint product_catalog_search_text_length
    check (char_length(search_text) between 1 and 200),
  constraint product_catalog_base_weight_check
    check (base_weight between 0 and 1000000),
  constraint product_catalog_add_count_check
    check (add_count >= 0),
  -- NULLS NOT DISTINCT so a maker-less product cannot be inserted twice within a
  -- scope. family_id is part of the key so two families can each contribute their
  -- own "Olive Oil" without the first one blocking the second. Also the conflict
  -- target the seed script upserts against.
  constraint product_catalog_name_maker_family_unique
    unique nulls not distinct (name, maker, family_id)
);

-- Idempotent reconciliation for databases created before the family-scoped
-- columns and key existed: the create-table above is a no-op once the table is
-- there, so any part of the target shape added later has to be applied explicitly
-- on re-run. On a fresh database these are all no-ops (the create-table already
-- built them); on an older one they bring it up to the shape above.
alter table public.product_catalog
  add column if not exists family_id uuid references public.families(id) on delete cascade;
alter table public.product_catalog
  add column if not exists contributed_by text;

-- The unique key widened from (name, maker) to (name, maker, family_id) so two
-- families can each contribute the same product. Drop the old key where an older
-- database still carries it, and add the new one if it is not already present.
alter table public.product_catalog
  drop constraint if exists product_catalog_name_maker_unique;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'product_catalog_name_maker_family_unique'
      and conrelid = 'public.product_catalog'::regclass
  ) then
    alter table public.product_catalog
      add constraint product_catalog_name_maker_family_unique
      unique nulls not distinct (name, maker, family_id);
  end if;
end $$;

-- Match anywhere in the text ("dorna" finds "apa plata 2l dorna"), not just at
-- the start.
create index if not exists product_catalog_search_text_trgm
  on public.product_catalog
  using gin (search_text extensions.gin_trgm_ops);

-- Orders the (small) trigram-filtered match set, with name as the tiebreak.
create index if not exists product_catalog_popularity
  on public.product_catalog (popularity desc, name);

-- The real key for contributed rows, and the arbiter add_custom_product() upserts
-- against. Stricter than the unique constraint above: "Olive Oil" and "olive oil"
-- share a search_text, so this stops one family accumulating near-duplicate rows
-- that would read as two identical suggestions. Any violation of the
-- (name, maker, family_id) constraint implies a violation of this index too — the
-- same name and maker always normalize to the same search_text — so inference on
-- this index catches both.
create unique index if not exists product_catalog_family_search
  on public.product_catalog (family_id, search_text)
  where family_id is not null;

-- One global row per search key, the shared-surface counterpart to the per-family
-- index above. Stops two seed rows -- or a promotion landing beside an existing
-- global -- from creating two globals that normalize alike, which would both be
-- bumped on every add and read as duplicate suggestions to everyone.
create unique index if not exists product_catalog_global_search
  on public.product_catalog (search_text)
  where family_id is null;

alter table public.product_catalog enable row level security;

-- Read-only for signed-in users, and contributed rows only for the family that
-- owns them. There are no insert/update/delete policies at all. Scoping the reads
-- here rather than in the client's query is what stops a hand-crafted request from
-- pulling another family's products, and means the app's suggestion select needs
-- no filter of its own.
drop policy if exists "authenticated users can read the product catalog" on public.product_catalog;
create policy "authenticated users can read the product catalog"
  on public.product_catalog for select
  to authenticated
  using (
    family_id is null
    or family_id in (
      select fm.family_id from public.family_members fm
      where fm.user_id = requesting_user_id()
    )
  );

-- Same reasoning as 015: hosted projects get grants at provisioning, a DB built
-- from migrations alone does not.
grant select on public.product_catalog to authenticated;

-- ─── search_text derivation ───────────────────────────────────────────────────

-- The one authority on what a product's matching key is. normalizeForSearch() in
-- scripts/seed-products.mjs and normalizeSearchText() in src/lib/productSearch.ts
-- mirror it for the seed and the query side respectively: lowercase, strip
-- diacritics, collapse whitespace. Those two use NFD + \p{Diacritic}; unaccent is
-- dictionary-based and agrees with them across Latin text, which is all any of the
-- three ever sees. search_path includes extensions because unaccent/1 resolves its
-- dictionary by name through it.
create or replace function public.product_search_text(p_name text, p_maker text default null)
returns text
language sql
stable
set search_path = public, extensions
as $$
  select lower(
    regexp_replace(
      btrim(extensions.unaccent(
        btrim(p_name) || coalesce(' ' || nullif(btrim(p_maker), ''), '')
      )),
      '\s+', ' ', 'g'
    )
  );
$$;

-- Internal helper: add_custom_product() is SECURITY DEFINER and owned by the same
-- role, so it keeps its own EXECUTE. Clients have no reason to call this.
revoke all on function public.product_search_text(text, text) from public;

-- ─── contribution + promotion ─────────────────────────────────────────────────

-- Contribute a product scoped to p_family_id, and promote it to global once
-- enough distinct families have contributed the same one. Silently no-ops rather
-- than raising for anything the caller cannot fix (not a member, overlong text):
-- this is fire-and-forget from the client and must never surface an error on top
-- of an add that already succeeded.
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
declare
  -- How many distinct accounts must contribute a product before it goes global.
  -- Low enough that genuinely common products graduate, high enough that one
  -- account's spelling (or a two-account coincidence) cannot drag junk in.
  promote_at constant integer := 3;

  -- Ceiling on distinct products one family may contribute, so a member cannot
  -- bloat the catalog with junk. Far above any real family's list; only repeat
  -- adds to products already contributed are allowed past it.
  max_products constant integer := 500;

  v_user   text := requesting_user_id();
  v_name   text := btrim(p_name);
  v_maker  text := nullif(btrim(coalesce(p_maker, '')), '');
  v_search text;
  v_contributors integer;
  v_first  record;
begin
  if v_user is null or p_family_id is null then
    return;
  end if;

  -- Mirror this table's length checks instead of letting them raise.
  if v_name = '' or char_length(v_name) > 120 then
    return;
  end if;
  if v_maker is not null and char_length(v_maker) > 60 then
    return;
  end if;

  -- Contribute only to a family you are actually in. SECURITY DEFINER bypasses
  -- RLS, so this is the whole tenancy check.
  if not exists (
    select 1 from public.family_members fm
    where fm.family_id = p_family_id and fm.user_id = v_user
  ) then
    return;
  end if;

  v_search := public.product_search_text(v_name, v_maker);
  if v_search = '' or char_length(v_search) > 200 then
    return;
  end if;

  -- Serialize every contribution and promotion for this product key. Without it a
  -- promotion's delete can race a concurrent contribution from another family: the
  -- contribution re-inserts a scoped row just after the delete removed it, leaving
  -- that family looking at both the new global row and an orphaned scoped one.
  -- Transaction-scoped, so it releases on commit or rollback.
  perform pg_advisory_xact_lock(hashtext(v_search));

  -- Already global: there is nothing to contribute, so count the add against it
  -- the way bump_product_popularity would. Matching on search_text rather than
  -- name/maker means a differently-accented spelling still finds it.
  if exists (
    select 1 from public.product_catalog
    where family_id is null and search_text = v_search
  ) then
    update public.product_catalog
    set add_count = add_count + 1
    where family_id is null and search_text = v_search;
    return;
  end if;

  -- Refuse a brand-new product once the family is at its ceiling; a repeat add to
  -- a product they already contributed still goes through (it is not a new row).
  if not exists (
    select 1 from public.product_catalog
    where family_id = p_family_id and search_text = v_search
  ) and (
    select count(*) from public.product_catalog where family_id = p_family_id
  ) >= max_products then
    return;
  end if;

  -- Contribute, or count a repeat add if this family already contributed it.
  -- contributed_by records who first added it and is left untouched on the repeat
  -- (do update only bumps add_count), so it stays the identity of the first
  -- contributor. base_weight stays 0: that column belongs to the seed script, so
  -- earned usage has to live in add_count or the next re-seed would wipe it.
  insert into public.product_catalog as pc
    (name, maker, search_text, family_id, contributed_by, base_weight, add_count)
  values (v_name, v_maker, v_search, p_family_id, v_user, 0, 1)
  on conflict (family_id, search_text) where family_id is not null
  do update set add_count = pc.add_count + 1;

  -- Count distinct contributing *accounts*, not families or owners. This is the
  -- gate that actually resists abuse: one account that is a member of three
  -- families and types the same junk into each still contributes all three scoped
  -- rows itself, so they share one contributed_by and count as one. Reaching the
  -- threshold takes three separate people who each added the product in their own
  -- family. (Nulls -- seeded globals -- are excluded by count(distinct), but no
  -- scoped row ever has a null contributed_by anyway: v_user is checked above.)
  select count(distinct pc.contributed_by) into v_contributors
  from public.product_catalog pc
  where pc.family_id is not null and pc.search_text = v_search;

  if v_contributors < promote_at then
    return;
  end if;

  -- Promote. The first contributor's spelling wins; the rows all share a
  -- search_text, so they differ only in case, accents, or spacing anyway.
  select name, maker into v_first
  from public.product_catalog
  where family_id is not null and search_text = v_search
  order by created_at, id
  limit 1;

  -- Collapse the scoped rows into one global row in a single statement, carrying
  -- their add_counts so the product arrives ranked by the usage it earned rather
  -- than at zero. Leaving the scoped rows would show their families the same
  -- product twice. The advisory lock above serializes concurrent contributions for
  -- this key, so at most one promotion runs.
  --
  -- ON CONFLICT folds the carried count into the existing global instead of
  -- dropping it. The lock does not cover the seed script (service role, no lock),
  -- so a seed can insert this global between the "already global?" check above and
  -- this insert; without the DO UPDATE the delete would still fire and the earned
  -- counts (and the families' scoped rows) would just vanish. Now they are added
  -- to whatever global exists.
  --
  -- Each family's share is capped at promote_at, for calibration as much as for
  -- abuse: seeded base_weight is 10 for an ordinary product and 100 for a staple
  -- (scripts/products.json), so an uncapped sum would let one family re-adding a
  -- niche product outrank bottled water for everyone. Capped, a newly promoted
  -- product arrives just under an ordinary product's baseline and climbs from
  -- there through bump_product_popularity.
  with scoped as (
    delete from public.product_catalog
    where family_id is not null and search_text = v_search
    returning add_count
  )
  insert into public.product_catalog (name, maker, search_text, family_id, base_weight, add_count)
  select v_first.name, v_first.maker, v_search, null::uuid, 0,
         coalesce(sum(least(add_count, promote_at)), 0)::integer
  from scoped
  on conflict (search_text) where family_id is null
  do update set add_count = public.product_catalog.add_count + excluded.add_count;
end;
$$;

revoke all on function public.add_custom_product(uuid, text, text) from public;
grant execute on function public.add_custom_product(uuid, text, text) to authenticated;

-- ─── popularity ───────────────────────────────────────────────────────────────

-- Count one add against a product without opening the table to client writes.
-- Matches a product the way the app's merge key does — case/space-insensitive
-- name + maker — so a null and an empty maker are treated alike. An unknown
-- product is a silent no-op.
--
-- The scope matters now that a name+maker can exist in more than one family. The
-- add happened in exactly one family (p_family_id), so bump only that family's
-- row (and any global row it matches) -- never the same product a caller happens
-- to have contributed in a *different* family they belong to, which would inflate
-- that other family's count toward a promotion the add never earned. p_family_id
-- null (a plain global pick with no family context) bumps only the global row.
--
-- Signature changed from (text, text): drop the old overload first so re-running
-- this file replaces it rather than leaving a stale two-arg version behind.
drop function if exists public.bump_product_popularity(text, text);
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

-- Function EXECUTE defaults to PUBLIC; scope it to signed-in users.
revoke all on function public.bump_product_popularity(text, text, uuid) from public;
grant execute on function public.bump_product_popularity(text, text, uuid) to authenticated;
