-- Security-invariant tests for the FamCart catalog project.
--
-- Run against the local stack for THIS project, not the app one beside it:
--   npx supabase db reset --workdir supabase-catalog
--   npx supabase test db  --workdir supabase-catalog
--
-- `db start` restores from a local backup where one exists and skips the
-- migrations, so the reset is not optional after editing any of them. Same trap
-- CLAUDE.md documents for the app schema.
--
-- What these assert:
--   1. The catalog is readable by any signed-in user and writable by none of
--      them: no insert, update or delete reaches it from a client role, and anon
--      reaches nothing at all.
--   2. The matching key is folded by the database and only by the database.
--      product_search_text() is unreachable from a client, which is why
--      search_catalog() is SECURITY DEFINER.
--   3. Search matches every token in any order, reaches a product through its
--      category aliases in a language it is not named in, and treats % and _ as
--      the literal characters somebody typed rather than as wildcards.
--   4. Ranking cannot be inflated without limit: the bump stops at the hourly
--      ceiling, the counters are unreachable from a client, and crossing the
--      limit is audited once per window.
--   5. An import can never rewrite a curated product or spend a product's earned
--      popularity, cannot launder itself into a provenance it did not earn, and
--      is unreachable from a client role.
--   6. A dry run writes nothing.
--
-- What is deliberately NOT here: households, members, promotion. Contributed
-- products live in the app database and are tested by supabase/tests/rls.test.sql.
-- If a test in this file needs a household, the line between the two projects has
-- moved and 003_product_catalog.sql's header is out of date.

begin;
select plan(45);

-- ── Seed as the migration/superuser role (bypasses RLS) ──────────────────────
-- search_text is written explicitly: it has no default, because every real write
-- goes through a function that computes it.
insert into public.product_catalog (name, maker, search_text, search_aliases, base_weight, source, barcode)
values
  ('Apa Plata 2L', 'Dorna', public.product_search_text('Apa Plata 2L', 'Dorna'),
   'natural mineral waters apa minerala wasser', 500, 'curated', null),
  ('Lapte 1.5%', 'Zuzu', public.product_search_text('Lapte 1.5%', 'Zuzu'),
   null, 300, 'curated', null),
  ('Ciocolata Lapte', 'Milka', public.product_search_text('Ciocolata Lapte', 'Milka'),
   null, 100, 'openfoodfacts', '40111011');

-- ── 1. Who may read, and who may write ───────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"user_a"}';

select is(
  (select count(*)::integer from public.product_catalog),
  3,
  'a signed-in user can read the whole catalog'
);

select throws_ok(
  $$ insert into public.product_catalog (name, search_text, source)
     values ('smuggled', 'smuggled', 'openfoodfacts') $$,
  '42501',
  null,
  'a signed-in user cannot insert into the catalog'
);

select throws_ok(
  $$ update public.product_catalog set base_weight = 999999 $$,
  '42501',
  null,
  'a signed-in user cannot rewrite the ranking'
);

select throws_ok(
  $$ delete from public.product_catalog $$,
  '42501',
  null,
  'a signed-in user cannot delete catalog rows'
);

-- 1e. product_search_text is the merge key's authority. Granting it to clients
-- would let one compute the key another product will be stored under, so the
-- search RPC is a definer instead.
select throws_ok(
  $$ select public.product_search_text('anything', null) $$,
  '42501',
  null,
  'a signed-in user cannot call the key-folding function directly'
);

reset role;

set local role anon;

select throws_ok(
  $$ select * from public.product_catalog $$,
  '42501',
  null,
  'an anonymous request reaches nothing at all'
);

reset role;

-- ── 2. The matching key ──────────────────────────────────────────────────────
-- Has to agree with normalizeSearchText() in src/lib/productSearch.ts and with
-- the app schema's copy of this function. Three implementations, one rule.
select is(
  public.product_search_text('  Apă   Plată  ', 'Dorna'),
  'apa plata dorna',
  'the key is lowercased, unaccented, and has its whitespace collapsed'
);

select is(
  public.product_search_text('Lapte', null),
  'lapte',
  'a product with no maker folds to its name alone'
);

-- ── 3. Search ────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"user_a"}';

select is(
  (select count(*)::integer from public.search_catalog('apa', 10)),
  1,
  'a single token finds the product'
);

select is(
  (select count(*)::integer from public.search_catalog('dorna apa', 10)),
  1,
  'word order does not matter: every token is matched separately'
);

select is(
  (select count(*)::integer from public.search_catalog('apă', 10)),
  1,
  'a query typed with diacritics is folded the same way the key was'
);

-- 3d. The reason search_aliases exists: the app speaks six languages and the
-- catalog is largely Romanian.
select is(
  (select count(*)::integer from public.search_catalog('wasser', 10)),
  1,
  'a product is reachable through a category alias in a language it is not named in'
);

select is(
  (select count(*)::integer from public.search_catalog('', 10)),
  0,
  'an empty query returns nothing rather than the whole catalog'
);

-- 3f/3g. product_search_text folds case and accents but leaves LIKE's
-- metacharacters alone, so escaping them is search_catalog's job. Without it a
-- typed underscore matches any character and a typed percent matches everything.
select is(
  (select count(*)::integer from public.search_catalog('apa_plata', 10)),
  0,
  'a typed underscore is a literal, not a wildcard'
);

-- One row, not zero and not three. "Lapte 1.5%" genuinely contains a percent
-- sign, so a literal match on it is the correct answer -- the escaping is doing
-- its job by making the character mean itself instead of "everything". Asserting
-- zero here would have been asserting that a percent sign can never match
-- anything, which is a different and wrong claim.
select is(
  (select count(*)::integer from public.search_catalog('%', 10)),
  1,
  'a typed percent sign matches the product containing one, not the whole catalog'
);

-- 3h. "Lapte" is in two products; the higher base_weight leads.
select is(
  (select name from public.search_catalog('lapte', 10) limit 1),
  'Lapte 1.5%',
  'results are ordered by popularity, highest first'
);

select is(
  (select count(*)::integer from public.search_catalog('lapte', 1)),
  1,
  'the limit is honoured'
);

reset role;

-- ── 4. Ranking cannot be inflated ────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"user_rate"}';

select throws_ok(
  $$ select * from public.rate_limit_counters $$,
  '42501',
  null,
  'a signed-in user cannot read the rate-limit counters'
);

select throws_ok(
  $$ update public.rate_limit_counters set hits = 0 $$,
  '42501',
  null,
  'a signed-in user cannot reset their own rate-limit counter'
);

select throws_ok(
  $$ select * from public.security_events $$,
  '42501',
  null,
  'a signed-in user cannot read the audit trail'
);

reset role;

set local request.jwt.claims = '{"sub":"user_rate"}';

select public.bump_product_popularity('Apa Plata 2L', 'Dorna');

select is(
  (select add_count::integer from public.product_catalog
   where search_text = 'apa plata 2l dorna'),
  1,
  'adding a product bumps the count that ordered it'
);

-- The maker is part of the match: a wrong maker bumps nothing.
select public.bump_product_popularity('Apa Plata 2L', 'Wrong Maker');

select is(
  (select add_count::integer from public.product_catalog
   where search_text = 'apa plata 2l dorna'),
  1,
  'a product whose maker does not match is left alone'
);

select is(
  (select popularity::integer from public.product_catalog
   where search_text = 'apa plata 2l dorna'),
  501,
  'popularity is the editorial baseline plus what the product earned'
);

-- 4e. 240/hour is the limit, so 300 calls must leave add_count at 240 rather
-- than 300.
--
-- A fresh actor and a different product, deliberately. The window counts CALLS,
-- not successful updates, so reusing user_rate here would spend two of its 240
-- on the bumps above -- including the one that matched nothing -- and the
-- expected number would become 239 for a reason that has nothing to do with the
-- ceiling being tested.
set local request.jwt.claims = '{"sub":"user_ceiling"}';

do $$
begin
  for i in 1..300 loop
    perform public.bump_product_popularity('Ciocolata Lapte', 'Milka');
  end loop;
end $$;

select is(
  (select add_count::integer from public.product_catalog
   where search_text = 'ciocolata lapte milka'),
  240,
  'ranking inflation stops dead at the hourly ceiling'
);

select is(
  (select count(*)::integer from public.security_events
   where actor = 'user_ceiling' and kind = 'rate_limited'
     and detail->>'for' = 'catalog_bump'),
  1,
  'crossing the ceiling logs one audit row per window, not one per request'
);

-- ── 5. Import ────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"user_a"}';

select throws_ok(
  $$ select public.import_catalog_products('[]'::jsonb, 'openfoodfacts', 'v1', false) $$,
  '42501',
  null,
  'a signed-in user cannot reach the import path at all'
);

reset role;

-- 5b. The provenance gate. An import may not claim to be the editorial seed,
-- which is what stops it overwriting curated rows through guarantee 2 below.
select throws_ok(
  $$ select public.import_catalog_products('[]'::jsonb, 'curated', 'v1', false) $$,
  'P0001',
  null,
  'an import cannot launder itself into the curated provenance'
);

select throws_ok(
  $$ select public.import_catalog_products('[]'::jsonb, 'community', 'v1', false) $$,
  'P0001',
  null,
  'nor into the provenance contributed rows carry in the app database'
);

-- 5d. A dry run reports what would happen and writes nothing.
select is(
  (public.import_catalog_products(
    '[{"name":"Bere Blonda","maker":"Ursus","barcode":"50111011","base_weight":10}]'::jsonb,
    'openfoodfacts', 'off-test', true) ->> 'inserted')::integer,
  1,
  'a dry run reports the insert it would make'
);

select is(
  (select count(*)::integer from public.product_catalog where search_text = 'bere blonda ursus'),
  0,
  'and writes nothing'
);

-- 5e. The same batch, applied.
select is(
  (public.import_catalog_products(
    '[{"name":"Bere Blonda","maker":"Ursus","barcode":"50111011","base_weight":10}]'::jsonb,
    'openfoodfacts', 'off-test', false) ->> 'inserted')::integer,
  1,
  'applying it inserts the row'
);

-- 5f. Guarantee 3: earned usage survives a re-import. The row is bumped, then
-- the same import runs again with a different weight.
set local request.jwt.claims = '{"sub":"user_reimport"}';
select public.bump_product_popularity('Bere Blonda', 'Ursus');
reset role;

select is(
  (public.import_catalog_products(
    '[{"name":"Bere Blonda","maker":"Ursus","barcode":"50111011","base_weight":77}]'::jsonb,
    'openfoodfacts', 'off-test-2', false) ->> 'updated_imported')::integer,
  1,
  'a re-import refreshes the row it owns'
);

select is(
  (select base_weight::integer from public.product_catalog where search_text = 'bere blonda ursus'),
  77,
  'the editorial baseline is overwritten by the import that owns the row'
);

select is(
  (select add_count::integer from public.product_catalog where search_text = 'bere blonda ursus'),
  1,
  'but the count the product earned is never spent'
);

-- 5g. Guarantee 2: a curated row is not this import's to rewrite. It gains the
-- upstream barcode and keeps everything else.
--
-- Named in lower case on purpose: the import has to fold to the same key the
-- curated row was stored under, or it joins nothing and this tests that an
-- unmatched import leaves rows alone, which is not the guarantee in question.
select is(
  (public.import_catalog_products(
    '[{"name":"lapte 1.5%","maker":"zuzu","barcode":"60111011","base_weight":1}]'::jsonb,
    'openfoodfacts', 'off-test-3', false) ->> 'updated_provenance_only')::integer,
  1,
  'a row the import does not own is touched for provenance only'
);

select is(
  (select base_weight::integer from public.product_catalog where search_text = 'lapte 1.5% zuzu'),
  300,
  'the curated weight survives an import that matched it'
);

select is(
  (select source from public.product_catalog where search_text = 'lapte 1.5% zuzu'),
  'curated',
  'and so does its provenance'
);

select is(
  (select barcode from public.product_catalog where search_text = 'lapte 1.5% zuzu'),
  '60111011',
  'while the upstream barcode is filled in for free'
);

-- 5h. Two rows in one batch that normalize alike collapse to one, the same way
-- the importer collapses them client-side.
select is(
  (public.import_catalog_products(
    '[{"name":"Paine Alba","maker":"Vel Pitar","base_weight":5},
      {"name":"  paine   alba  ","maker":"vel pitar","base_weight":9}]'::jsonb,
    'openfoodfacts', 'off-test-4', false) ->> 'deduped')::integer,
  1,
  'two rows in one batch that fold to the same key collapse to one'
);

select is(
  (select base_weight::integer from public.product_catalog where search_text = 'paine alba vel pitar'),
  9,
  'and the heavier of the two is the one that lands'
);

-- 5i. A barcode another product already holds is routine upstream noise, so the
-- row is skipped and counted rather than raising.
select is(
  (public.import_catalog_products(
    '[{"name":"Altceva","maker":"Altcineva","barcode":"40111011","base_weight":1}]'::jsonb,
    'openfoodfacts', 'off-test-5', false) ->> 'skipped_barcode_conflict')::integer,
  1,
  'a barcode another product already holds is skipped and counted'
);

-- 5j. The key the importer sums across chunks. It is always zero here -- there
-- are no contributed rows in this project to fold in -- but a missing key would
-- turn that arithmetic into NaN.
select is(
  (public.import_catalog_products('[]'::jsonb, 'openfoodfacts', 'off-test-6', true) ->> 'collapsed_scoped')::integer,
  0,
  'the report still carries collapsed_scoped, which this project can only ever report as zero'
);

-- ── 6. The constraints that keep one product one row ─────────────────────────
select throws_ok(
  $$ insert into public.product_catalog (name, maker, search_text, source)
     values ('Apa Plata 2L', 'Dorna', 'apa plata 2l dorna', 'openfoodfacts') $$,
  '23505',
  null,
  'two rows cannot share a search key'
);

select throws_ok(
  $$ insert into public.product_catalog (name, search_text, source)
     values ('Contributed', 'contributed', 'community') $$,
  '23514',
  null,
  'a contributed row cannot be stored here: it belongs in the app database'
);

select throws_ok(
  $$ insert into public.product_catalog (name, search_text, source, barcode)
     values ('Bad Code', 'bad code', 'openfoodfacts', 'not-a-barcode') $$,
  '23514',
  null,
  'a barcode that is not a barcode is rejected'
);

select * from finish();
rollback;
