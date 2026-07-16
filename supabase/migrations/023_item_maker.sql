-- ─── item maker ───────────────────────────────────────────────────────────────
-- Items picked from the product catalog carry the product's maker ("Dorna"),
-- shown as a small title under the item name in the list and in history.

alter table public.shopping_list_items
  add column if not exists maker text;

alter table public.shopping_list_items
  drop constraint if exists shopping_list_items_maker_length_check;
alter table public.shopping_list_items
  add constraint shopping_list_items_maker_length_check
  check (maker is null or char_length(maker) between 1 and 60);

-- The "one active row per product" merge key (migration 014) now includes the
-- maker: the same name from two makers ("Lapte 3.5% 1L" from Napolact vs
-- LaDorna) stays two distinct rows, while re-adding the same catalog product
-- still merges into the existing row. No duplicate collapse is needed first:
-- every existing row has a null maker, so the new key cannot introduce
-- conflicts the old one allowed.
drop index if exists public.shopping_list_items_unique_active_name;
create unique index shopping_list_items_unique_active_name
  on public.shopping_list_items (
    family_id,
    lower(btrim(name)),
    lower(btrim(coalesce(maker, '')))
  )
  where checked = false;

-- Purchases keep the maker.
alter table public.purchase_history
  add column if not exists maker text;

-- Same definition as migration 019, plus maker in the archived columns.
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
    returning family_id, id, name, maker, quantity, added_by, added_by_name, added_by_image_url
  )
  insert into public.purchase_history
    (checkout_id, family_id, item_id, name, maker, quantity, added_by, added_by_name, added_by_image_url, purchased_by)
  select
    v_checkout_id, family_id, id, name, maker, quantity, added_by, added_by_name, added_by_image_url, v_user
  from removed;

  get diagnostics moved = row_count;
  return moved;
end;
$$;
