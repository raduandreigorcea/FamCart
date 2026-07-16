-- ─── product popularity ────────────────────────────────────────────────────────
-- Rank suggestions by how wanted a product is, so typing "apa" surfaces drinking
-- water before mouthwash. Popularity is kept in two columns so re-seeding never
-- wipes earned usage:
--   base_weight - editorial baseline seeded from scripts/products.json; the seed
--                 script overwrites it freely on every run.
--   add_count   - times the product was added from a suggestion; only the
--                 bump_product_popularity() RPC touches it, never the seed.
-- popularity is their sum (a stored generated column), and suggestions order by
-- it descending.

alter table public.product_catalog
  add column if not exists base_weight integer not null default 0,
  add column if not exists add_count   integer not null default 0;

alter table public.product_catalog
  drop constraint if exists product_catalog_base_weight_check;
alter table public.product_catalog
  add constraint product_catalog_base_weight_check
  check (base_weight between 0 and 1000000);

alter table public.product_catalog
  drop constraint if exists product_catalog_add_count_check;
alter table public.product_catalog
  add constraint product_catalog_add_count_check
  check (add_count >= 0);

alter table public.product_catalog
  add column if not exists popularity integer
  generated always as (base_weight + add_count) stored;

-- Orders the (small) trigram-filtered match set by popularity, name as tiebreak.
create index if not exists product_catalog_popularity
  on public.product_catalog (popularity desc, name);

-- Count one "add" against a product without opening the table to client writes:
-- product_catalog stays read-only via RLS (no update policy), and this SECURITY
-- DEFINER function is the only increment path. It matches a product the same way
-- the app's merge key does — case/space-insensitive name + maker — so a null and
-- an empty maker are treated alike. An unknown product is a silent no-op.
create or replace function public.bump_product_popularity(p_name text, p_maker text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.product_catalog
  set add_count = add_count + 1
  where lower(btrim(name)) = lower(btrim(p_name))
    and lower(btrim(coalesce(maker, ''))) = lower(btrim(coalesce(p_maker, '')));
end;
$$;

-- Function EXECUTE defaults to PUBLIC; scope it to signed-in users.
revoke all on function public.bump_product_popularity(text, text) from public;
grant execute on function public.bump_product_popularity(text, text) to authenticated;
