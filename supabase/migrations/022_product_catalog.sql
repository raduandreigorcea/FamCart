-- ─── product_catalog ─────────────────────────────────────────────────────────
-- Global product suggestions shown while typing in the add-item input.
-- Rows are seeded by scripts/seed-products.mjs using the service role key;
-- clients can only read.

create extension if not exists pg_trgm with schema extensions;

create table if not exists public.product_catalog (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,   -- e.g. "Apa Plata 2L"
  maker       text,                   -- e.g. "Dorna", shown as a subtitle
  -- Lowercased, diacritic-free "name maker" that typed input is matched
  -- against; computed by the seed script so the DB needs no unaccent setup.
  search_text text        not null,
  created_at  timestamptz not null default now(),
  constraint product_catalog_name_length
    check (char_length(name) between 1 and 120),
  constraint product_catalog_maker_length
    check (maker is null or char_length(maker) between 1 and 60),
  constraint product_catalog_search_text_length
    check (char_length(search_text) between 1 and 200),
  -- NULLS NOT DISTINCT so a maker-less product cannot be inserted twice;
  -- also the conflict target the seed script upserts against.
  constraint product_catalog_name_maker_unique
    unique nulls not distinct (name, maker)
);

-- Trigram index so suggestions match anywhere in the text ("dorna" finds
-- "apa plata 2l dorna"), not just prefixes.
create index if not exists product_catalog_search_text_trgm
  on public.product_catalog
  using gin (search_text extensions.gin_trgm_ops);

alter table public.product_catalog enable row level security;

-- Read-only for signed-in users. There are no insert/update/delete policies:
-- only the service role (which bypasses RLS) can write.
create policy "authenticated users can read the product catalog"
  on public.product_catalog for select
  to authenticated
  using (true);

-- Same reasoning as 015: hosted projects get grants at provisioning, a DB
-- built from migrations alone does not.
grant select on public.product_catalog to authenticated;
