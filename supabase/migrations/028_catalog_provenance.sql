-- ─── catalog provenance + bulk import ────────────────────────────────────────
-- Migration 022 built a catalog of two kinds of rows: seeded globals and family
-- contributions. Both are small, hand-shaped, and Romanian. This migration adds
-- the third kind -- rows imported in bulk from an external database (Open Food
-- Facts, via tools/catalog-importer) -- and the columns and the one function
-- that make importing them safe.
--
-- Three things had to exist before a bulk import could be allowed near this
-- table:
--
--   barcode  - the only stable identity an external catalog gives us. Names are
--              re-normalized every time the importer improves, so a name can
--              never be the key that says "this is the same product as last
--              run". A barcode can.
--   source   - which of the three kinds a row is. This is what lets one import
--              be re-weighted or deleted wholesale without touching a single
--              curated row, and it is the only thing that makes "which rows
--              carry the upstream database's licence terms" an answerable
--              question. Open Food Facts data is ODbL; that obligation attaches
--              to rows, so the rows have to say so.
--   an RPC   - see import_catalog_products() below. PostgREST cannot upsert
--              against this table's real keys, and the reason is subtle enough
--              that the whole explanation lives with the function.
--
-- Ranking, restated from 022 now that a third kind of row exists. base_weight
-- bands are: 100 seeded staple, 10 seeded ordinary, 1-9 imported (scaled from
-- upstream scan counts), 0 contributed. Imported rows sit strictly below the
-- seeded ordinary baseline on purpose -- tens of thousands of them arriving
-- above it would flatten the editorial signal the seed exists to provide.
-- 022's note that a newly promoted contribution "arrives just under an ordinary
-- product's baseline" still holds, but that range is now shared with the
-- imported band rather than empty, which is the intended reading: a product
-- three real families asked for belongs beside a moderately-scanned import.
--
-- The whole file is idempotent, so it is safe to re-run in the SQL editor.

-- ─── columns ──────────────────────────────────────────────────────────────────

alter table public.product_catalog
  add column if not exists barcode text;
alter table public.product_catalog
  add column if not exists source text;
alter table public.product_catalog
  add column if not exists source_ref text;
alter table public.product_catalog
  add column if not exists source_version text;

comment on column public.product_catalog.barcode is
  'EAN/GTIN from the upstream catalog. Null for seeded and contributed rows.';
comment on column public.product_catalog.source is
  'curated = scripts/seed-products.mjs, community = add_custom_product(), openfoodfacts = tools/catalog-importer.';
comment on column public.product_catalog.source_ref is
  'Identity of this row in the upstream catalog (the OFF code). What makes a re-import update rather than duplicate.';
comment on column public.product_catalog.source_version is
  'Which import run produced this row, e.g. off-2026-07-01. Lets one run be reverted on its own.';

-- Backfill before the not-null lands. Every global that predates this migration
-- came from the seed script (nothing else could write one), and every scoped row
-- came from add_custom_product() (nothing else could write one either), so the
-- split is exact rather than a guess.
update public.product_catalog
set source = case when family_id is null then 'curated' else 'community' end
where source is null;

-- Default 'community': the only writer that does not name the column explicitly
-- would be a future contribution path, and a contribution is what it would be.
alter table public.product_catalog
  alter column source set default 'community';
alter table public.product_catalog
  alter column source set not null;

-- Drop-then-add so re-running replaces rather than fails, matching 027.
alter table public.product_catalog
  drop constraint if exists product_catalog_barcode_format;
alter table public.product_catalog
  add constraint product_catalog_barcode_format
  check (barcode is null or barcode ~ '^[0-9]{8,14}$');

alter table public.product_catalog
  drop constraint if exists product_catalog_source_check;
alter table public.product_catalog
  add constraint product_catalog_source_check
  check (source in ('curated', 'community', 'openfoodfacts'));

alter table public.product_catalog
  drop constraint if exists product_catalog_source_ref_length;
alter table public.product_catalog
  add constraint product_catalog_source_ref_length
  check (source_ref is null or char_length(source_ref) between 1 and 100);

alter table public.product_catalog
  drop constraint if exists product_catalog_source_version_length;
alter table public.product_catalog
  add constraint product_catalog_source_version_length
  check (source_version is null or char_length(source_version) between 1 and 40);

-- One global row per barcode. Partial on family_id because a contributed row
-- carries no barcode today, and a future "scan it onto the list" feature must
-- not find itself blocked by a global that already claimed that code.
create unique index if not exists product_catalog_global_barcode
  on public.product_catalog (barcode)
  where family_id is null and barcode is not null;

-- "Has this upstream record already landed?" -- scoped by source so two
-- different upstream catalogs can use the same identifier space without
-- colliding.
create unique index if not exists product_catalog_source_ref_unique
  on public.product_catalog (source, source_ref)
  where source_ref is not null;

-- Deliberately no index on source alone: the one query that filters by it is a
-- bulk delete of an entire import, which is a sequential scan either way.

-- ─── contribution + promotion, restated to stamp source ───────────────────────

-- Byte-identical to 022's function except that both inserts now name `source`.
-- The column default already makes them correct; naming it anyway is the point.
-- A SECURITY DEFINER function that depends on a column default for a semantic
-- guarantee is one `alter column set default` away from silently writing the
-- wrong provenance, and provenance is a licensing fact here, not a nicety.
--
-- The two `do update` clauses are deliberately left alone. They set add_count
-- and nothing else, so a promotion landing on a row that was imported bumps its
-- earned count without rewriting source, barcode, or source_ref. That is
-- correct: families adding an imported product does not change where the row
-- came from.
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
  promote_at constant integer := 3;
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

  if v_name = '' or char_length(v_name) > 120 then
    return;
  end if;
  if v_maker is not null and char_length(v_maker) > 60 then
    return;
  end if;

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

  perform pg_advisory_xact_lock(hashtext(v_search));

  if exists (
    select 1 from public.product_catalog
    where family_id is null and search_text = v_search
  ) then
    update public.product_catalog
    set add_count = add_count + 1
    where family_id is null and search_text = v_search;
    return;
  end if;

  if not exists (
    select 1 from public.product_catalog
    where family_id = p_family_id and search_text = v_search
  ) and (
    select count(*) from public.product_catalog where family_id = p_family_id
  ) >= max_products then
    return;
  end if;

  insert into public.product_catalog as pc
    (name, maker, search_text, family_id, contributed_by, base_weight, add_count, source)
  values (v_name, v_maker, v_search, p_family_id, v_user, 0, 1, 'community')
  on conflict (family_id, search_text) where family_id is not null
  do update set add_count = pc.add_count + 1;

  select count(distinct pc.contributed_by) into v_contributors
  from public.product_catalog pc
  where pc.family_id is not null and pc.search_text = v_search;

  if v_contributors < promote_at then
    return;
  end if;

  select name, maker into v_first
  from public.product_catalog
  where family_id is not null and search_text = v_search
  order by created_at, id
  limit 1;

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

revoke all on function public.add_custom_product(uuid, text, text) from public;
grant execute on function public.add_custom_product(uuid, text, text) to authenticated;

-- ─── bulk import ──────────────────────────────────────────────────────────────

-- Load a batch of externally-sourced products into the global catalog.
--
-- WHY THIS IS AN RPC AND NOT supabase-js .upsert()
--
-- PostgREST can only infer ON CONFLICT against a *total* unique constraint. Of
-- the three keys that govern a global row, only product_catalog_name_maker_
-- family_unique qualifies -- product_catalog_global_search and
-- product_catalog_global_barcode are both partial indexes, and
-- `.upsert({ onConflict: 'barcode' })` against either fails at runtime with
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification". If a later change ever "simplifies" this back to a client-side
-- upsert, that is the error it will produce.
--
-- The seed script gets away with upserting on (name, maker, family_id) only
-- because it pre-collapses its own input by search_text. That cannot see a row
-- already in the table whose *different* name normalizes to the same key, so the
-- whole chunk fails on product_catalog_global_search. At 256 curated rows that
-- is a latent bug; at tens of thousands of imported ones it is a certainty.
--
-- WHAT IT GUARANTEES
--
-- 1. search_text is computed here, by product_search_text(). The database stays
--    the sole authority on the matching key, so the importer's own copy of the
--    normalizer can only ever affect its client-side collapsing and can never
--    disagree with the unique index.
-- 2. An import may never change the name, maker, base_weight, or source of a row
--    whose source is not this import's source. Curated wins, always. A curated
--    row gets the upstream barcode filled in for free and keeps everything else.
-- 3. add_count is never written. It is not named in the insert (so it takes its
--    default of 0) and not named in any update -- with exactly one exception,
--    step 8, which folds already-earned counts off scoped rows the import is
--    superseding. Earned usage survives every re-import.
--
-- SECURITY INVOKER, not definer: EXECUTE is granted to service_role alone, and
-- service_role could write this table directly anyway, so the function adds no
-- privilege and therefore presents no escalation surface. Making it definer
-- would create one for no gain.
create or replace function public.import_catalog_products(
  p_rows           jsonb,
  p_source         text default 'openfoodfacts',
  p_source_version text default null,
  p_dry_run        boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  -- Same cap add_custom_product() uses when it folds scoped counts into a
  -- global, for the same reason: one enthusiastic family must not be able to
  -- outrank the editorial baseline on its own.
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
  -- Refusing them here keeps this function from being the back door that lets an
  -- import launder itself into a provenance it did not earn.
  if coalesce(p_source, '') <> 'openfoodfacts' then
    raise exception 'import_catalog_products: p_source must be an import source, got %',
      coalesce(p_source, '<null>');
  end if;

  -- Dropped explicitly rather than relying on ON COMMIT DROP: the pgTAP suite
  -- runs every call inside one transaction, so a second call in the same
  -- transaction would otherwise collide with the first call's table.
  -- Unqualified on purpose: pg_temp is implicitly searched first for relation
  -- names even though it is not named in this function's search_path, and naming
  -- it explicitly would depend on the session already having a temp schema.
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
  -- reused and mistyped codes, so this is routine rather than an error -- but it
  -- is silent data loss if it goes uncounted, hence skipped_barcode_conflict in
  -- the report.
  delete from catalog_import_staging s
  using public.product_catalog pc
  where s.barcode is not null
    and pc.family_id is null
    and pc.barcode = s.barcode
    and pc.search_text <> s.search_text;
  get diagnostics v_skipped_barcode = row_count;

  -- Serialize against add_custom_product(), which takes the same lock on the
  -- same hash. Ordered, so an import and a promotion running at once can never
  -- deadlock by grabbing two keys in opposite orders. 022's seed path has this
  -- race open; this closes it for the import path.
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
    -- Rows this import already owns: fully refreshed, because a better
    -- normalizer or a newer dump is exactly why you re-run. name and maker can
    -- only differ here in case, accents, or spacing -- anything more would have
    -- changed search_text and so would not have joined.
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
    -- gains the upstream barcode -- useful later for scanning -- and keeps its
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
    -- collapse them the way a promotion would -- and carry the counts they
    -- earned, capped per family. This is the sole exception to "add_count is
    -- never written", and it only ever adds counts that already existed.
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

-- 015's reasoning: hosted projects get these at provisioning, a database built
-- from migrations alone does not. delete is needed for the scoped-row collapse.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.product_catalog to service_role;
