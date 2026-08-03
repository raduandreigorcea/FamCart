-- ─── the shopping list ───────────────────────────────────────────────────────
-- The active list itself, and the rules its rows obey.
--
-- Two things worth knowing up front. First, the list carries no author identity:
-- rows store added_by (a Clerk user id) and nothing else, and the UI resolves the
-- name and avatar from profiles at render time, so a changed Clerk photo shows up
-- on every existing item at once.
--
-- Second, a checked item is still a row on this table. Checking is a state, not a
-- removal — buy_items() (005_purchase_history.sql) is the only thing that moves
-- rows off the list, and it archives them as it goes.

create table if not exists public.shopping_list_items (
  id          uuid        primary key default gen_random_uuid(),
  family_id   uuid        not null references public.families(id) on delete cascade,
  name        text        not null,
  -- The catalog product's maker ("Dorna"), shown as a subtitle. Part of the merge
  -- key below: the same name from two makers is two different products.
  maker       text,
  quantity    integer     not null default 1,
  checked     boolean     not null default false,
  -- When the item was checked. Stamped server-side by the trigger below, so the
  -- ordering key cannot be forged by a client and is consistent across devices.
  checked_at  timestamptz,
  added_by    text        not null,   -- Clerk user ID
  created_at  timestamptz not null default now(),
  constraint shopping_list_items_name_length_check
    check (char_length(btrim(name)) between 1 and 120),
  constraint shopping_list_items_maker_length_check
    check (maker is null or char_length(maker) between 1 and 60),
  constraint shopping_list_items_quantity_check
    check (quantity >= 1)
);

alter table public.shopping_list_items enable row level security;

-- ─── one active row per product ──────────────────────────────────────────────
-- Adding something already on the list bumps its quantity rather than creating a
-- second row, and this index is what makes that guarantee real against two
-- devices adding at once — the loser gets a 23505 and the client folds its
-- quantity into the winning row.
--
-- Scoped to unchecked rows only: re-adding something already bought should start
-- a fresh active item, not resurrect the checked one. Matching is
-- case/whitespace-insensitive and includes the maker, mirroring
-- normalizeItemName() and findActiveItemByName() in src/lib/shoppingList.ts.
create unique index if not exists shopping_list_items_unique_active_name
  on public.shopping_list_items (
    family_id,
    lower(btrim(name)),
    lower(btrim(coalesce(maker, '')))
  )
  where checked = false;

-- Serves the two list reads (unchecked, then checked) the app issues on load.
create index if not exists idx_shopping_list_items_family_id_checked
  on public.shopping_list_items (family_id, checked);

-- ─── policies ────────────────────────────────────────────────────────────────
-- Membership is the whole rule: you may read, add, change and remove items in
-- any family you belong to. Insert additionally pins added_by to the caller, and
-- the ownership trigger below stops an update rewriting it afterwards.
drop policy if exists "family members can read items" on public.shopping_list_items;
create policy "family members can read items"
  on public.shopping_list_items for select
  using (
    family_id in (
      select family_id from public.family_members
      where user_id = requesting_user_id()
    )
  );

drop policy if exists "family members can insert items" on public.shopping_list_items;
create policy "family members can insert items"
  on public.shopping_list_items for insert
  with check (
    added_by = requesting_user_id()
    and family_id in (
      select family_id from public.family_members
      where user_id = requesting_user_id()
    )
  );

-- WITH CHECK keeps the row inside the caller's families; the trigger below pins
-- added_by and family_id, which a WITH CHECK expression cannot do because it
-- cannot compare old against new.
drop policy if exists "family members can update items" on public.shopping_list_items;
create policy "family members can update items"
  on public.shopping_list_items for update
  using (
    family_id in (
      select family_id from public.family_members
      where user_id = requesting_user_id()
    )
  )
  with check (
    family_id in (
      select family_id from public.family_members
      where user_id = requesting_user_id()
    )
  );

drop policy if exists "family members can delete items" on public.shopping_list_items;
create policy "family members can delete items"
  on public.shopping_list_items for delete
  using (
    family_id in (
      select family_id from public.family_members
      where user_id = requesting_user_id()
    )
  );

-- ─── row rules the policies cannot express ───────────────────────────────────

-- An item's author and its family are fixed at insert.
create or replace function public.prevent_item_ownership_change()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.added_by is distinct from old.added_by then
    raise exception 'Item creator cannot be changed.'
      using errcode = 'P0001';
  end if;

  if new.family_id is distinct from old.family_id then
    raise exception 'Item cannot be moved between families.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- Own checked_at entirely, ignoring whatever the client sends: stamp now() the
-- moment an item becomes checked, clear it on uncheck, and leave an existing
-- stamp alone on an unrelated update to a still-checked row (a quantity change
-- must not bump it to the top of the checked list).
create or replace function public.stamp_item_checked_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if coalesce(new.checked, false) then
    if tg_op = 'INSERT' or coalesce(old.checked, false) = false then
      new.checked_at := now();
    else
      new.checked_at := old.checked_at;
    end if;
  else
    new.checked_at := null;
  end if;
  return new;
end;
$$;

-- The per-member active-item cap, at the database layer so race conditions or
-- stale client state cannot bypass the UI's own check
-- (countActiveItemsByMember in src/lib/shoppingList.ts).
create or replace function public.enforce_member_active_item_limit()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_count integer;
  member_limit integer;
begin
  -- Only active (unchecked) items count.
  if coalesce(new.checked, false) = true then
    return new;
  end if;

  -- On UPDATE, only enforce when the row is newly becoming active (an uncheck).
  -- A row that was already active being updated for some other reason (e.g. a
  -- quantity change) is already counted below, so enforcing here would reject it
  -- the moment the family sits exactly at the cap.
  if tg_op = 'UPDATE' and coalesce(old.checked, false) = false then
    return new;
  end if;

  select coalesce(f.max_items_per_member, 50)
    into member_limit
  from public.families f
  where f.id = new.family_id;

  -- If the family row is missing, let the FK constraint produce the canonical error.
  if member_limit is null then
    return new;
  end if;

  select count(*)::integer
    into current_count
  from public.shopping_list_items sli
  where sli.family_id = new.family_id
    and sli.added_by = new.added_by
    and sli.checked = false;

  if current_count >= member_limit then
    raise exception 'You reached your limit of % active items.', member_limit
      using errcode = 'P0001',
            detail = 'member_active_item_limit_exceeded';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_item_ownership_change on public.shopping_list_items;
create trigger trg_prevent_item_ownership_change
before update on public.shopping_list_items
for each row
execute function public.prevent_item_ownership_change();

drop trigger if exists trg_stamp_item_checked_at on public.shopping_list_items;
create trigger trg_stamp_item_checked_at
before insert or update on public.shopping_list_items
for each row
execute function public.stamp_item_checked_at();

-- INSERT and UPDATE both: unchecking an item makes it active again, which must
-- count against the cap the same way adding one does.
drop trigger if exists trg_enforce_member_active_item_limit on public.shopping_list_items;
create trigger trg_enforce_member_active_item_limit
before insert or update on public.shopping_list_items
for each row
execute function public.enforce_member_active_item_limit();

grant select, insert, update, delete on public.shopping_list_items to authenticated;
