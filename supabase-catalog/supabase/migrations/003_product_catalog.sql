-- ─── the product catalog ─────────────────────────────────────────────────────
-- Every product the add-item box can suggest that nobody in particular typed in:
-- the editorial seed, and whatever catalog-importer has loaded from Open Food
-- Facts and its two sibling projects.
--
-- WHERE THE LINE IS, because this is the half of a split
--
-- The app schema (supabase/migrations/006_product_catalog.sql) keeps a table of
-- the same name, and the two are not copies. That one holds rows a household
-- contributed through add_custom_product(), scoped by household_id and protected
-- by RLS, plus the rows promoted out of them once three distinct accounts in
-- three distinct households asked for the same product. This one holds rows that
-- belong to nobody.
--
-- The promotion rule therefore never crosses a database, which is the entire
-- reason the line is drawn here and not somewhere tidier-sounding. A contributed
-- row and the global it eventually becomes both live next door, under one lock,
-- in one transaction. Nothing in this file participates.
--
-- The visible consequence is that one product can exist twice: as an imported
-- row here and as a promoted row over there. The client merges both result sets
-- and dedupes on productKey() (src/lib/productSearch.ts), which is the same
-- name+maker identity both sides already use.
--
-- Clients never write this table. RLS grants SELECT and nothing else; the only
-- write a signed-in user can reach is bump_product_popularity(), and it is rate
-- limited (002_rate_limit.sql).
--
-- Ranking is the sum of two columns, kept apart so re-importing never wipes
-- earned usage:
--   base_weight - editorial cold-start baseline. The importer overwrites it
--                 freely on every run for rows it owns.
--   add_count   - times the product was actually added. Only the bump touches it.
-- popularity is their stored sum, and suggestions order by it descending.

create table if not exists public.product_catalog (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,   -- e.g. "Apa Plata 2L"
  maker       text,                   -- e.g. "Dorna", shown as a subtitle
  -- Lowercased, diacritic-free "name maker" that typed input is matched against,
  -- so "apă" typed with or without accents finds "Apa Plata 2L Dorna". Derived by
  -- product_search_text() below -- never supplied by a client.
  search_text text        not null,
  -- Extra words a product can be found by, beyond its own name: the Open Food
  -- Facts category taxonomy resolved into the languages the app speaks.
  search_aliases text,
  -- One column to match against, so a multi-word query needs one index rather
  -- than an OR across two. Stored because the trigram index is built on it.
  search_blob text generated always as
    (search_text || coalesce(' ' || search_aliases, '')) stored,
  base_weight integer     not null default 0,
  add_count   integer     not null default 0,
  popularity  integer     generated always as (base_weight + add_count) stored,
  -- EAN/GTIN, from the upstream catalog. Null on curated rows.
  barcode     text,
  -- No 'community' here, deliberately: a contributed row lives in the app
  -- database until it is promoted, and a promotion stays there too. If this
  -- allowlist ever grows a fourth import source, widen the matching list inside
  -- import_catalog_products() with it -- that function refuses anything it does
  -- not recognise, and the two lists are checked in different places.
  source      text        not null,
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
  constraint product_catalog_search_aliases_length
    check (search_aliases is null or char_length(search_aliases) between 1 and 400),
  constraint product_catalog_base_weight_check
    check (base_weight between 0 and 1000000),
  constraint product_catalog_add_count_check
    check (add_count >= 0),
  constraint product_catalog_barcode_format
    check (barcode is null or barcode ~ '^[0-9]{8,14}$'),
  constraint product_catalog_source_check
    check (source in ('curated', 'openfoodfacts', 'openproductsfacts', 'openbeautyfacts')),
  constraint product_catalog_source_ref_length
    check (source_ref is null or char_length(source_ref) between 1 and 100),
  constraint product_catalog_source_version_length
    check (source_version is null or char_length(source_version) between 1 and 40),
  -- One row per search key, and a TOTAL constraint rather than the app's partial
  -- index, because every row here is global. Being total is what makes it a
  -- usable ON CONFLICT target.
  --
  -- This subsumes a unique on (name, maker): two rows sharing those normalize to
  -- the same search_text and collide here first. It is also stricter, which is
  -- the point -- "Olive Oil" and "olive oil" are one product, and two rows would
  -- read as two identical suggestions to everybody.
  constraint product_catalog_search_text_unique unique (search_text),
  -- One row per barcode. NULLs are distinct by default, so any number of rows
  -- may have none.
  constraint product_catalog_barcode_unique unique (barcode)
);

-- ─── bounds that have to be restated ─────────────────────────────────────────
-- Everything inside `create table if not exists` above applies only when the
-- table is created, so on a database this file has already run against it is
-- skipped entirely. A bound changed up there alone reaches new databases and
-- never production. Restate any that change down here, as an explicit drop and
-- add -- the same trap CLAUDE.md documents for the app schema.
alter table public.product_catalog drop constraint if exists product_catalog_source_check;
alter table public.product_catalog add constraint product_catalog_source_check
  check (source in (
    'curated',            -- the editorial seed, moved here from the app database
    'openfoodfacts',      -- catalog-importer
    'openproductsfacts',  -- catalog-importer, non-food
    'openbeautyfacts'     -- catalog-importer, toiletries
  ));

alter table public.product_catalog enable row level security;

-- Kept as database comments, not just SQL comments: the provenance columns are
-- read from the SQL editor when auditing where a row came from, and a licensing
-- question is exactly when nobody has this file open.
comment on table public.product_catalog is
  'Global product reference data, queried live by both the production and the '
  'development app. Household-contributed products live in the app database, not here.';
comment on column public.product_catalog.source is
  'curated = the editorial seed, openfoodfacts/openproductsfacts/openbeautyfacts = '
  'catalog-importer. All three import sources are ODbL and require attribution in the app.';
comment on column public.product_catalog.search_aliases is
  'Normalized extra search terms (Open Food Facts category names across the app '
  'languages). Never displayed; matched against alongside search_text via search_blob.';
comment on column public.product_catalog.source_ref is
  'Identity of this row in the upstream catalog (the upstream code). What makes a '
  're-import update rather than duplicate.';
comment on column public.product_catalog.source_version is
  'Which import run produced this row, e.g. off-2026-07-01. Lets one run be reverted on its own.';

-- Match anywhere in the text ("dorna" finds "apa plata 2l dorna"), not just at
-- the start. On search_blob rather than search_text so a query can also reach a
-- product through its category aliases, in a language the product is not named
-- in. search_catalog() below is the only reader.
create index if not exists product_catalog_search_blob_trgm
  on public.product_catalog
  using gin (search_blob extensions.gin_trgm_ops);

-- Orders the (small) trigram-filtered match set, with name as the tiebreak.
create index if not exists product_catalog_popularity
  on public.product_catalog (popularity desc, name);

-- "Has this upstream record already landed?" -- scoped by source so two
-- different upstream catalogs can share an identifier space without colliding.
create unique index if not exists product_catalog_source_ref_unique
  on public.product_catalog (source, source_ref)
  where source_ref is not null;

-- Deliberately no index on source alone: the one query that filters by it is a
-- bulk delete of an entire import, which is a sequential scan either way.

-- ─── who may read it ─────────────────────────────────────────────────────────
-- Everything here is global, so the policy has nothing to scope by. It is still
-- a policy rather than an open grant: signed-in only, and RLS stays on, so
-- adding a column that does need scoping later starts from a closed door.
--
-- There are no insert, update or delete policies at all. The definer functions
-- below are the only writes.
drop policy if exists "authenticated users can read the product catalog" on public.product_catalog;
create policy "authenticated users can read the product catalog"
  on public.product_catalog for select
  to authenticated
  using (true);

-- Revoke first, then grant. Hosted Supabase hands anon and authenticated INSERT,
-- UPDATE, DELETE and TRUNCATE at provisioning, and only the absence of a write
-- policy would make the sentence above true -- TRUNCATE would not even be
-- stopped by a policy, since it ignores RLS.
revoke all on public.product_catalog from anon, authenticated, service_role;

grant select on public.product_catalog to authenticated;

-- ─── the matching key ────────────────────────────────────────────────────────
-- The one authority on what a product's matching key is, and it has to stay
-- character-for-character equivalent to the app schema's copy of this function
-- and to normalizeSearchText() in src/lib/productSearch.ts. Three
-- implementations, one rule: lowercase, strip diacritics, collapse whitespace.
-- If they drift, a query folded one way stops matching a key folded the other,
-- and the symptom is an add-item box that finds nothing for no visible reason.
--
-- The TS pair use NFD + \p{Diacritic}; unaccent is dictionary-based and agrees
-- with them across Latin text, which is all any of them ever sees. search_path
-- includes extensions because unaccent/1 resolves its dictionary by name
-- through it.
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

-- Internal helper. The functions below are SECURITY DEFINER and owned by the
-- same role, so they keep their own EXECUTE; clients have no reason to call it.
revoke all on function public.product_search_text(text, text) from public;

-- ─── popularity ──────────────────────────────────────────────────────────────
-- Adding a product from the suggestions bumps the count that ordered them. This
-- is the only write a signed-in client can reach in this project.
--
-- Two arguments, where the app's copy takes three: there is no household to
-- scope by, because there are no scoped rows. A client that has added a product
-- it found HERE calls this; one that added a product it found in its own
-- household's rows calls the app's copy instead. src/lib/productSuggestions.ts
-- routes by where the suggestion came from.
--
-- 240 bumps per hour. A person adding groceries fires one per item; a busy shop
-- is a few dozen. A script inflating a global ranking needs thousands, and the
-- gap between those two numbers is the whole point.
create or replace function public.bump_product_popularity(
  p_name text,
  p_maker text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.rate_limit_hit('catalog_bump', 240, interval '1 hour') then
    return;
  end if;

  update public.product_catalog pc
  set add_count = pc.add_count + 1
  where lower(btrim(pc.name)) = lower(btrim(p_name))
    and lower(btrim(coalesce(pc.maker, ''))) = lower(btrim(coalesce(p_maker, '')));
end;
$$;

revoke all on function public.bump_product_popularity(text, text) from public;
grant execute on function public.bump_product_popularity(text, text) to authenticated;

-- ─── search ──────────────────────────────────────────────────────────────────
-- Every word of the query matched separately, in any order, against search_blob.
--
-- SECURITY DEFINER even though it only reads: tokenizing means calling
-- product_search_text(), and EXECUTE on that is revoked from authenticated.
-- Granting it instead would put the merge-key function in reach of every client.
--
-- Unlike the app's copy there is nothing to scope, so the definer's bypass of
-- RLS costs nothing here -- the read policy is `using (true)` anyway.
create or replace function public.search_catalog(
  p_query text,
  p_limit integer default 100
)
returns table (name text, maker text, popularity integer)
language plpgsql
security definer
stable
set search_path = public, extensions
as $$
declare
  -- Bounded so a pasted paragraph cannot become a hundred-way AND. Six is
  -- already far more words than anyone types into an add-item box.
  max_tokens constant integer := 6;

  v_patterns text[];
  v_primary  text;
  v_rest     text[];
  v_limit    integer := least(greatest(coalesce(p_limit, 100), 1), 200);
begin
  -- Fold the query exactly the way search_text was folded, so "Apă" and "apa"
  -- are the same search. There is one authority for that and this is a caller
  -- of it, not a second copy.
  --
  -- Escaping matters even after folding: product_search_text lowercases and
  -- strips accents but leaves % and _ alone, so without this a typed underscore
  -- matches any character and a typed % matches the entire catalog.
  select array_agg(
           '%' || replace(replace(replace(tok, '\', '\\'), '%', '\%'), '_', '\_') || '%'
           order by char_length(tok) desc
         )
    into v_patterns
  from (
    select tok
    from regexp_split_to_table(
      public.product_search_text(coalesce(p_query, ''), null), '\s+'
    ) as tok
    where tok <> ''
    limit max_tokens
  ) t;

  if v_patterns is null then
    return;
  end if;

  -- Longest token first: it is the most selective, and it is the one predicate
  -- the trigram index drives from. The rest filter what it returns. Written as
  -- one indexable LIKE plus a quantified ALL rather than an AND chain built by
  -- string concatenation, so no SQL is assembled from user input at all.
  v_primary := v_patterns[1];
  v_rest    := v_patterns[2:];

  return query
  select pc.name, pc.maker, pc.popularity
  from public.product_catalog pc
  where pc.search_blob like v_primary
    and pc.search_blob like all (v_rest)
  order by pc.popularity desc, pc.name
  limit v_limit;
end;
$$;

revoke all on function public.search_catalog(text, integer) from public;
grant execute on function public.search_catalog(text, integer) to authenticated;

-- ─── bulk import ─────────────────────────────────────────────────────────────
-- Load a batch of externally-sourced products. This is the only thing that ever
-- writes rows here in bulk, and catalog-importer is its only caller.
--
-- WHY THIS IS AN RPC AND NOT supabase-js .upsert()
--
-- Mostly history now -- the app's copy needed it because its conflict targets
-- were partial indexes PostgREST cannot infer -- but the guarantees below are
-- the real reason it stays one.
--
-- WHAT IT GUARANTEES
--
-- 1. search_text is computed here, by product_search_text(). The database stays
--    the sole authority on the matching key, so the importer's own copy of the
--    normalizer can only affect its client-side collapsing and can never
--    disagree with the unique constraint.
-- 2. An import may never change the name, maker, base_weight, or source of a row
--    whose source is not this import's source. Curated wins, always. A curated
--    row gets the upstream barcode filled in for free and keeps everything else.
-- 3. add_count is never written. Earned usage survives every re-import.
--
-- SECURITY DEFINER, so the body always runs as this function's owner whatever
-- role called it. As INVOKER the body would run as service_role, which has no
-- EXECUTE on product_search_text, and every real import would die with
-- "permission denied" -- invisible to a test suite running as superuser,
-- because superusers bypass privilege checks.
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
  v_key                text;
  v_skipped_invalid    integer := 0;
  v_deduped            integer := 0;
  v_batch_dup_barcode  integer := 0;
  v_skipped_barcode    integer := 0;
  v_inserted           integer := 0;
  v_updated_imported   integer := 0;
  v_updated_provenance integer := 0;
begin
  -- 'curated' belongs to the seed. Refusing it here keeps this from being the
  -- back door that lets an import launder itself into a provenance it did not
  -- earn. This list is the import subset of product_catalog_source_check and has
  -- to be widened alongside it.
  if coalesce(p_source, '') not in
     ('openfoodfacts', 'openproductsfacts', 'openbeautyfacts') then
    raise exception 'import_catalog_products: p_source must be an import source, got %',
      coalesce(p_source, '<null>');
  end if;

  -- Dropped explicitly rather than relying on ON COMMIT DROP: the pgTAP suite
  -- runs every call inside one transaction, so a second call in the same
  -- transaction would otherwise collide with the first call's table.
  -- Unqualified on purpose: pg_temp is implicitly searched first for relation
  -- names even though it is not named in this function's search_path.
  drop table if exists catalog_import_staging;

  create temp table catalog_import_staging on commit drop as
  select
    nullif(btrim(coalesce(r.barcode, '')), '')            as barcode,
    btrim(coalesce(r.name, ''))                           as name,
    nullif(btrim(coalesce(r.maker, '')), '')              as maker,
    greatest(0, coalesce(r.base_weight, 0))               as base_weight,
    nullif(btrim(coalesce(r.source_ref, r.barcode, '')), '') as source_ref,
    -- Folded here rather than trusted: the importer normalizes these already,
    -- but search_aliases feeds a LIKE and a hand-assembled batch must be held to
    -- the same shape as search_text.
    nullif(left(public.product_search_text(
      coalesce(r.search_aliases, ''), null
    ), 400), '')                                          as search_aliases,
    public.product_search_text(
      btrim(coalesce(r.name, '')),
      nullif(btrim(coalesce(r.maker, '')), '')
    )                                                     as search_text
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
    as r(barcode text, name text, maker text, base_weight integer,
         source_ref text, search_aliases text);

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
  -- batch, which product_catalog_barcode_unique would reject. Counted as dedupe
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

  -- A barcode already held by a *different* product. Upstream catalogs contain
  -- reused and mistyped codes, so this is routine rather than an error -- but it
  -- is silent data loss if it goes uncounted, hence skipped_barcode_conflict in
  -- the report.
  delete from catalog_import_staging s
  using public.product_catalog pc
  where s.barcode is not null
    and pc.barcode = s.barcode
    and pc.search_text <> s.search_text;
  get diagnostics v_skipped_barcode = row_count;

  -- Serialize concurrent imports of the same key. Ordered, so two runs at once
  -- can never deadlock by grabbing two keys in opposite orders.
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
    left join public.product_catalog g on g.search_text = s.search_text;
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
        search_aliases = s.search_aliases,
        source_version = coalesce(p_source_version, pc.source_version)
    from catalog_import_staging s
    where pc.source = p_source
      and pc.search_text = s.search_text;
    get diagnostics v_updated_imported = row_count;

    -- Rows this import does not own: provenance only, and only where it is
    -- missing. This single statement is guarantee 2 above. A curated product
    -- gains the upstream barcode -- useful later for scanning -- and keeps its
    -- editorial name, weight, and source.
    update public.product_catalog pc
    set barcode        = coalesce(pc.barcode, s.barcode),
        source_ref     = coalesce(pc.source_ref, s.source_ref),
        -- Additive, like the barcode beside it: a curated row gains search terms
        -- it had none of, and never loses the ones it has.
        search_aliases = coalesce(pc.search_aliases, s.search_aliases)
    from catalog_import_staging s
    where pc.source <> p_source
      and pc.search_text = s.search_text
      and (pc.barcode is null or pc.source_ref is null or pc.search_aliases is null)
      and (s.barcode is not null or s.source_ref is not null
           or s.search_aliases is not null);
    get diagnostics v_updated_provenance = row_count;

    insert into public.product_catalog
      (name, maker, search_text, search_aliases, base_weight,
       barcode, source, source_ref, source_version)
    select s.name, s.maker, s.search_text, s.search_aliases,
           s.base_weight, s.barcode, p_source, s.source_ref, p_source_version
    from catalog_import_staging s
    where not exists (
      select 1 from public.product_catalog pc where pc.search_text = s.search_text
    )
    on conflict (search_text) do nothing;
    get diagnostics v_inserted = row_count;
  end if;

  return jsonb_build_object(
    'inserted',                 v_inserted,
    'updated_imported',         v_updated_imported,
    'updated_provenance_only',  v_updated_provenance,
    'skipped_invalid',          v_skipped_invalid,
    'skipped_barcode_conflict', v_skipped_barcode,
    'deduped',                  v_deduped,
    -- Always zero here, and the key stays anyway. In the app schema this counts
    -- household-contributed rows an import superseded and folded in; there are
    -- no contributed rows in this project, so there is nothing to fold. The
    -- importer sums this field across chunks (catalog-importer
    -- src/load/supabase.ts), and a missing key would make that arithmetic NaN.
    'collapsed_scoped',         0,
    'source',                   p_source,
    'source_version',           p_source_version,
    'dry_run',                  p_dry_run
  );
end;
$$;

revoke all on function public.import_catalog_products(jsonb, text, text, boolean) from public;
grant execute on function public.import_catalog_products(jsonb, text, text, boolean) to service_role;

-- The importer reads the table directly as well as calling the RPC (it builds
-- its load diff from what is already there), so the service role needs more than
-- the RPC gives it. Hosted projects get these at provisioning; a database built
-- from migrations alone does not.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.product_catalog to service_role;
