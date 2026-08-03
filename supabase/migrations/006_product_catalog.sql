-- ─── product catalog ─────────────────────────────────────────────────────────
-- The products offered while typing in the add-item box, and the throttled ways
-- the catalog grows.
--
-- Scope lives in one column:
--   family_id is null  - global. Seeded by scripts/seed-products.mjs with the
--                        service role key, imported by catalog-importer, and
--                        suggested to everyone.
--   family_id = <uuid> - contributed via add_custom_product(), suggested only
--                        back to that family until enough OTHER families add the
--                        same product, at which point it is promoted to global.
--
-- That promotion rule is what makes a user-writable catalog safe. A misspelling
-- one family types stays scoped to them forever; a product several families
-- independently ask for earns its way in on its own. No moderation queue, and no
-- way for one family's spelling to leak into everyone else's suggestions — the
-- threshold counts distinct contributing *accounts* (contributed_by), so
-- crossing it takes three separate people who each added the product in their
-- own family. One account belonging to three families and typing the same junk
-- into all three still counts as one and cannot self-promote.
--
-- Clients never write this table. RLS grants SELECT and nothing else; the two
-- SECURITY DEFINER RPCs at the bottom are the only writes reachable from the
-- app, and both are rate-limited (002_security_audit.sql).
--
-- Ranking is the sum of two columns, kept apart so re-seeding never wipes earned
-- usage:
--   base_weight - editorial cold-start baseline from products.json. The seed
--                 script overwrites it freely on every run.
--   add_count   - times the product was actually added. Only the RPCs touch it.
-- popularity is their stored sum, and suggestions order by it descending.

create table if not exists public.product_catalog (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,   -- e.g. "Apa Plata 2L"
  maker       text,                   -- e.g. "Dorna", shown as a subtitle
  -- Lowercased, diacritic-free "name maker" that typed input is matched against,
  -- so "apă" typed with or without accents finds "Apa Plata 2L Dorna". Derived by
  -- product_search_text() below — never supplied by a client.
  search_text text        not null,
  -- Null for the global catalog; the contributing family otherwise.
  family_id   uuid        references public.families(id) on delete cascade,
  -- Who first contributed a scoped row; null for globals. Promotion counts
  -- distinct values of this, so it is the identity the anti-abuse gate measures.
  contributed_by text,
  base_weight integer     not null default 0,
  add_count   integer     not null default 0,
  popularity  integer     generated always as (base_weight + add_count) stored,
  -- EAN/GTIN from an upstream catalog. Null for seeded and contributed rows.
  barcode     text,
  -- curated = scripts/seed-products.mjs, community = add_custom_product(),
  -- openfoodfacts = catalog-importer. Provenance is a licensing fact here, not a
  -- nicety, which is why every writer names it explicitly rather than leaning on
  -- this default.
  source      text        not null default 'community',
  -- Identity of this row in the upstream catalog. What makes a re-import update
  -- rather than duplicate.
  source_ref  text,
  -- Which import run produced this row, e.g. off-2026-07-01. Lets one run be
  -- reverted on its own.
  source_version text,
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
  constraint product_catalog_barcode_format
    check (barcode is null or barcode ~ '^[0-9]{8,14}$'),
  constraint product_catalog_source_check
    check (source in ('curated', 'community', 'openfoodfacts')),
  constraint product_catalog_source_ref_length
    check (source_ref is null or char_length(source_ref) between 1 and 100),
  constraint product_catalog_source_version_length
    check (source_version is null or char_length(source_version) between 1 and 40),
  -- NULLS NOT DISTINCT so a maker-less product cannot be inserted twice within a
  -- scope. family_id is part of the key so two families can each contribute their
  -- own "Olive Oil". Also the conflict target the seed script upserts against.
  constraint product_catalog_name_maker_family_unique
    unique nulls not distinct (name, maker, family_id)
);

alter table public.product_catalog enable row level security;

-- Kept as database comments, not just SQL comments: the provenance columns are
-- read from the SQL editor when auditing where a row came from, and a licensing
-- question is exactly when nobody has this file open.
comment on column public.product_catalog.barcode is
  'EAN/GTIN from the upstream catalog. Null for seeded and contributed rows.';
comment on column public.product_catalog.source is
  'curated = scripts/seed-products.mjs, community = add_custom_product(), openfoodfacts = catalog-importer.';
comment on column public.product_catalog.source_ref is
  'Identity of this row in the upstream catalog (the OFF code). What makes a re-import update rather than duplicate.';
comment on column public.product_catalog.source_version is
  'Which import run produced this row, e.g. off-2026-07-01. Lets one run be reverted on its own.';

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
-- that would read as two identical suggestions.
create unique index if not exists product_catalog_family_search
  on public.product_catalog (family_id, search_text)
  where family_id is not null;

-- One global row per search key. Stops two seed rows — or a promotion landing
-- beside an existing global — from creating two globals that normalize alike,
-- which would both be bumped on every add and read as duplicates to everyone.
create unique index if not exists product_catalog_global_search
  on public.product_catalog (search_text)
  where family_id is null;

-- One global row per barcode. Partial on family_id because a contributed row
-- carries no barcode today, and a future "scan it onto the list" feature must not
-- find itself blocked by a global that already claimed that code.
create unique index if not exists product_catalog_global_barcode
  on public.product_catalog (barcode)
  where family_id is null and barcode is not null;

-- "Has this upstream record already landed?" — scoped by source so two different
-- upstream catalogs can share an identifier space without colliding.
create unique index if not exists product_catalog_source_ref_unique
  on public.product_catalog (source, source_ref)
  where source_ref is not null;

-- Deliberately no index on source alone: the one query that filters by it is a
-- bulk delete of an entire import, which is a sequential scan either way.

-- Read-only for signed-in users, and contributed rows only for the family that
-- owns them. There are no insert/update/delete policies at all. Scoping the reads
-- here rather than in the client's query is what stops a hand-crafted request
-- from pulling another family's products.
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

grant select on public.product_catalog to authenticated;

-- ─── the matching key ────────────────────────────────────────────────────────
-- The one authority on what a product's matching key is. normalizeForSearch() in
-- scripts/seed-products.mjs and normalizeSearchText() in src/lib/productSearch.ts
-- mirror it for the seed and the query side respectively: lowercase, strip
-- diacritics, collapse whitespace. Those two use NFD + \p{Diacritic}; unaccent is
-- dictionary-based and agrees with them across Latin text, which is all any of
-- the three ever sees. search_path includes extensions because unaccent/1
-- resolves its dictionary by name through it.
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

-- Internal helper. The functions below are SECURITY DEFINER and owned by the same
-- role, so they keep their own EXECUTE; clients have no reason to call this.
revoke all on function public.product_search_text(text, text) from public;

-- ─── contribution and promotion ──────────────────────────────────────────────
-- The body, unthrottled. add_custom_product() below is the public entry point and
-- adds the rate limit; this is split out because a plpgsql function cannot be
-- "extended", and restating ninety lines of contribution and promotion logic
-- inside a throttled copy would be two things to keep in step.
--
-- Silently no-ops rather than raising for anything the caller cannot fix (not a
-- member, overlong text): this is fire-and-forget from the client and must never
-- surface an error on top of an add that already succeeded.
create or replace function public.add_custom_product_unthrottled(
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
  -- bloat the catalog. Far above any real family's list; only repeat adds to
  -- products already contributed are allowed past it.
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

  -- Already global: nothing to contribute, so count the add against it the way
  -- bump_product_popularity would. Matching on search_text rather than name/maker
  -- means a differently-accented spelling still finds it.
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
  -- (do update only bumps add_count). base_weight stays 0: that column belongs to
  -- the seed script, so earned usage has to live in add_count or the next
  -- re-seed would wipe it.
  insert into public.product_catalog as pc
    (name, maker, search_text, family_id, contributed_by, base_weight, add_count, source)
  values (v_name, v_maker, v_search, p_family_id, v_user, 0, 1, 'community')
  on conflict (family_id, search_text) where family_id is not null
  do update set add_count = pc.add_count + 1;

  -- Count distinct contributing *accounts*, not families or owners. This is the
  -- gate that actually resists abuse — see the header.
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

  -- Collapse the scoped rows into one global in a single statement, carrying
  -- their add_counts so the product arrives ranked by the usage it earned rather
  -- than at zero. Leaving the scoped rows would show their families the same
  -- product twice.
  --
  -- ON CONFLICT folds the carried count into an existing global instead of
  -- dropping it. The advisory lock does not cover the seed script (service role,
  -- no lock), so a seed can insert this global between the "already global?"
  -- check above and this insert; without the DO UPDATE the delete would still
  -- fire and the earned counts would just vanish.
  --
  -- Each family's share is capped at promote_at, for calibration as much as for
  -- abuse: seeded base_weight is 10 for an ordinary product and 100 for a staple,
  -- so an uncapped sum would let one family re-adding a niche product outrank
  -- bottled water for everyone.
  with scoped as (
    delete from public.product_catalog
    where family_id is not null and search_text = v_search
    returning add_count
  )
  insert into public.product_catalog
    (name, maker, search_text, family_id, base_weight, add_count, source)
  select v_first.name, v_first.maker, v_search, null::uuid, 0,
         coalesce(sum(least(add_count, promote_at)), 0)::integer, 'community'
  from scoped
  on conflict (search_text) where family_id is null
  do update set add_count = public.product_catalog.add_count + excluded.add_count;
end;
$$;

-- Not callable by a client, which is the whole point of splitting it out.
--
-- This is a deliberate behaviour change from the schema this file replaces, and
-- the one place the consolidation is not a pure restatement. Previously the
-- throttle was retrofitted by RENAMING the granted function
-- (`alter function add_custom_product rename to add_custom_product_unthrottled`)
-- and creating a wrapper over it. A rename carries the function's grants with
-- it, and `revoke ... from public` does not touch a grant held explicitly by
-- `authenticated` — so the unthrottled function stayed directly callable by any
-- signed-in user, and the 120/hour limit was one RPC name away from being
-- bypassed entirely. Defining the inner function outright, never granting it, is
-- what closes that.
revoke all on function public.add_custom_product_unthrottled(uuid, text, text) from public;
revoke all on function public.add_custom_product_unthrottled(uuid, text, text) from authenticated;

-- The public entry point: 120 contributions per hour, then silence.
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

-- ─── popularity ──────────────────────────────────────────────────────────────
-- Count one add against a product without opening the table to client writes.
-- Matches the way the app's merge key does — case/space-insensitive name +
-- maker — so a null and an empty maker are treated alike. An unknown product is
-- a silent no-op.
--
-- The scope matters now that a name+maker can exist in more than one family. The
-- add happened in exactly one family (p_family_id), so bump only that family's
-- row and any global it matches — never the same product the caller happens to
-- have contributed in a *different* family they belong to, which would inflate
-- that family's count toward a promotion the add never earned.
--
-- 240 bumps per hour. A person adding groceries fires one per item; a busy shop
-- is a few dozen. A script inflating a global ranking needs thousands, and the
-- gap between those two numbers is the whole point.
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

-- ─── bulk import ─────────────────────────────────────────────────────────────
-- Load a batch of externally-sourced products into the global catalog.
--
-- WHY THIS IS AN RPC AND NOT supabase-js .upsert()
--
-- PostgREST can only infer ON CONFLICT against a *total* unique constraint. Of
-- the three keys that govern a global row, only
-- product_catalog_name_maker_family_unique qualifies —
-- product_catalog_global_search and product_catalog_global_barcode are both
-- partial indexes, and `.upsert({ onConflict: 'barcode' })` against either fails
-- at runtime with "there is no unique or exclusion constraint matching the ON
-- CONFLICT specification". If a later change ever "simplifies" this back to a
-- client-side upsert, that is the error it will produce.
--
-- WHAT IT GUARANTEES
--
-- 1. search_text is computed here, by product_search_text(). The database stays
--    the sole authority on the matching key, so the importer's own copy of the
--    normalizer can only affect its client-side collapsing and can never
--    disagree with the unique index.
-- 2. An import may never change the name, maker, base_weight, or source of a row
--    whose source is not this import's source. Curated wins, always. A curated
--    row gets the upstream barcode filled in for free and keeps everything else.
-- 3. add_count is never written, with exactly one exception — the final step,
--    which folds already-earned counts off scoped rows the import supersedes.
--    Earned usage survives every re-import.
--
-- SECURITY DEFINER, so the body always runs as this function's owner whatever
-- role called it. Two concrete failures forced that, both invisible to a test
-- suite running as superuser because superusers bypass privilege checks:
--   1. As INVOKER the body ran as service_role, which has no EXECUTE on
--      product_search_text, so every real import died with "permission denied".
--   2. The staging table is created by whoever calls, so a second call from a
--      different role in the same session cannot drop the first one's table.
create or replace function public.import_catalog_products(
  p_rows           jsonb,
  p_source         text default 'openfoodfacts',
  p_source_version text default null,
  p_dry_run        boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  -- Same cap add_custom_product_unthrottled() uses when it folds scoped counts
  -- into a global, for the same reason: one enthusiastic family must not outrank
  -- the editorial baseline on its own.
  promote_at constant integer := 3;

  v_key                text;
  v_skipped_invalid    integer := 0;
  v_deduped            integer := 0;
  v_batch_dup_barcode  integer := 0;
  v_skipped_barcode    integer := 0;
  v_inserted           integer := 0;
  v_updated_imported   integer := 0;
  v_updated_provenance integer := 0;
  v_collapsed_scoped   integer := 0;
begin
  -- 'curated' belongs to the seed script and 'community' to add_custom_product().
  -- Refusing them here keeps this from being the back door that lets an import
  -- launder itself into a provenance it did not earn.
  if coalesce(p_source, '') <> 'openfoodfacts' then
    raise exception 'import_catalog_products: p_source must be an import source, got %',
      coalesce(p_source, '<null>');
  end if;

  -- Dropped explicitly rather than relying on ON COMMIT DROP: the pgTAP suite
  -- runs every call inside one transaction, so a second call in the same
  -- transaction would otherwise collide with the first call's table.
  -- Unqualified on purpose: pg_temp is implicitly searched first for relation
  -- names even though it is not named in this function's search_path.
  drop table if exists catalog_import_staging;
  drop table if exists catalog_import_inserted;

  create temp table catalog_import_staging on commit drop as
  select
    nullif(btrim(coalesce(r.barcode, '')), '')            as barcode,
    btrim(coalesce(r.name, ''))                           as name,
    nullif(btrim(coalesce(r.maker, '')), '')              as maker,
    greatest(0, coalesce(r.base_weight, 0))               as base_weight,
    nullif(btrim(coalesce(r.source_ref, r.barcode, '')), '') as source_ref,
    public.product_search_text(
      btrim(coalesce(r.name, '')),
      nullif(btrim(coalesce(r.maker, '')), '')
    )                                                     as search_text
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
    as r(barcode text, name text, maker text, base_weight integer, source_ref text);

  -- Mirror the table's own checks instead of letting them raise mid-chunk. A
  -- logged drop of one bad row beats losing the other 499.
  delete from catalog_import_staging
  where name = ''
     or char_length(name) > 120
     or (maker is not null and char_length(maker) > 60)
     or search_text is null
     or search_text = ''
     or char_length(search_text) > 200
     or base_weight > 1000000
     or (barcode is not null and barcode !~ '^[0-9]{8,14}$');
  get diagnostics v_skipped_invalid = row_count;

  -- Collapse rows that normalize alike. The importer does this too and picks the
  -- winner the same way (highest base_weight, then lowest barcode); repeating it
  -- here means the two can never disagree, and that a hand-assembled batch is
  -- held to the same rule.
  delete from catalog_import_staging s
  where s.ctid <> (
    select s2.ctid from catalog_import_staging s2
    where s2.search_text = s.search_text
    order by s2.base_weight desc, s2.barcode asc nulls last
    limit 1
  );
  get diagnostics v_deduped = row_count;

  -- Same again for one barcode appearing under two different names in a single
  -- batch, which product_catalog_global_barcode would reject. Counted as dedupe
  -- rather than conflict: nothing outside this batch was involved.
  delete from catalog_import_staging s
  where s.barcode is not null and s.ctid <> (
    select s2.ctid from catalog_import_staging s2
    where s2.barcode = s.barcode
    order by s2.base_weight desc, s2.search_text asc
    limit 1
  );
  get diagnostics v_batch_dup_barcode = row_count;
  v_deduped := v_deduped + v_batch_dup_barcode;

  -- A barcode already held by a *different* global. Upstream catalogs contain
  -- reused and mistyped codes, so this is routine rather than an error — but it
  -- is silent data loss if it goes uncounted, hence skipped_barcode_conflict in
  -- the report.
  delete from catalog_import_staging s
  using public.product_catalog pc
  where s.barcode is not null
    and pc.family_id is null
    and pc.barcode = s.barcode
    and pc.search_text <> s.search_text;
  get diagnostics v_skipped_barcode = row_count;

  -- Serialize against add_custom_product_unthrottled(), which takes the same lock
  -- on the same hash. Ordered, so an import and a promotion running at once can
  -- never deadlock by grabbing two keys in opposite orders.
  for v_key in
    select distinct search_text from catalog_import_staging order by 1
  loop
    perform pg_advisory_xact_lock(hashtext(v_key));
  end loop;

  if p_dry_run then
    -- A separate read-only branch rather than a rollback, so a dry run can never
    -- partially apply.
    select
      count(*) filter (where g.id is null),
      count(*) filter (where g.id is not null and g.source = p_source),
      count(*) filter (where g.id is not null and g.source <> p_source)
    into v_inserted, v_updated_imported, v_updated_provenance
    from catalog_import_staging s
    left join public.product_catalog g
      on g.family_id is null and g.search_text = s.search_text;

    select count(*) into v_collapsed_scoped
    from public.product_catalog pc
    join catalog_import_staging s on s.search_text = pc.search_text
    where pc.family_id is not null
      and not exists (
        select 1 from public.product_catalog g
        where g.family_id is null and g.search_text = s.search_text
      );
  else
    -- Rows this import already owns: fully refreshed, because a better normalizer
    -- or a newer dump is exactly why you re-run. name and maker can only differ
    -- here in case, accents, or spacing — anything more would have changed
    -- search_text and so would not have joined.
    update public.product_catalog pc
    set name           = s.name,
        maker          = s.maker,
        base_weight    = s.base_weight,
        barcode        = coalesce(s.barcode, pc.barcode),
        source_ref     = coalesce(s.source_ref, pc.source_ref),
        source_version = coalesce(p_source_version, pc.source_version)
    from catalog_import_staging s
    where pc.family_id is null
      and pc.source = p_source
      and pc.search_text = s.search_text;
    get diagnostics v_updated_imported = row_count;

    -- Rows this import does not own: provenance only, and only where it is
    -- missing. This single statement is guarantee 2 above. A curated product
    -- gains the upstream barcode — useful later for scanning — and keeps its
    -- editorial name, weight, and source.
    update public.product_catalog pc
    set barcode    = coalesce(pc.barcode, s.barcode),
        source_ref = coalesce(pc.source_ref, s.source_ref)
    from catalog_import_staging s
    where pc.family_id is null
      and pc.source <> p_source
      and pc.search_text = s.search_text
      and (pc.barcode is null or pc.source_ref is null)
      and (s.barcode is not null or s.source_ref is not null);
    get diagnostics v_updated_provenance = row_count;

    create temp table catalog_import_inserted (search_text text primary key) on commit drop;

    with ins as (
      insert into public.product_catalog
        (name, maker, search_text, family_id, base_weight, barcode, source, source_ref, source_version)
      select s.name, s.maker, s.search_text, null::uuid, s.base_weight, s.barcode,
             p_source, s.source_ref, p_source_version
      from catalog_import_staging s
      where not exists (
        select 1 from public.product_catalog pc
        where pc.family_id is null and pc.search_text = s.search_text
      )
      on conflict (search_text) where family_id is null do nothing
      returning search_text
    )
    insert into catalog_import_inserted (search_text)
    select search_text from ins;
    get diagnostics v_inserted = row_count;

    -- A family may have contributed this product before it was imported. Their
    -- scoped row and the new global read as the same product twice, forever, so
    -- collapse them the way a promotion would — and carry the counts they earned,
    -- capped per family. This is the sole exception to "add_count is never
    -- written", and it only ever adds counts that already existed.
    with scoped as (
      delete from public.product_catalog pc
      using catalog_import_inserted i
      where pc.family_id is not null
        and pc.search_text = i.search_text
      returning pc.search_text, pc.add_count
    ),
    folded as (
      select search_text,
             sum(least(add_count, promote_at))::integer as carried,
             count(*)::integer as scoped_rows
      from scoped
      group by search_text
    ),
    applied as (
      update public.product_catalog pc
      set add_count = pc.add_count + f.carried
      from folded f
      where pc.family_id is null and pc.search_text = f.search_text
      returning f.scoped_rows
    )
    select coalesce(sum(scoped_rows), 0)::integer into v_collapsed_scoped from applied;
  end if;

  return jsonb_build_object(
    'inserted',                 v_inserted,
    'updated_imported',         v_updated_imported,
    'updated_provenance_only',  v_updated_provenance,
    'skipped_invalid',          v_skipped_invalid,
    'skipped_barcode_conflict', v_skipped_barcode,
    'deduped',                  v_deduped,
    'collapsed_scoped',         v_collapsed_scoped,
    'source',                   p_source,
    'source_version',           p_source_version,
    'dry_run',                  p_dry_run
  );
end;
$$;

revoke all on function public.import_catalog_products(jsonb, text, text, boolean) from public;
grant execute on function public.import_catalog_products(jsonb, text, text, boolean) to service_role;

-- The seed script and the importer both reach this table directly (the importer
-- reads it to build its load diff), so the service role needs more than the RPC
-- gives it. Same reasoning as the authenticated grants elsewhere: hosted projects
-- get these at provisioning, a database built from migrations alone does not.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.product_catalog to service_role;
