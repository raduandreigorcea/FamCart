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
  household_id   uuid        not null references public.households(id) on delete cascade,
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
    check (quantity between 1 and 999)
);

-- Restated as an explicit ALTER for the reason 003 spells out at length:
-- everything inside `create table if not exists` is skipped wherever the table
-- already exists, so the ceiling added above reaches new databases only.
--
-- The ceiling itself: the floor was always here, but nothing above it was, so a
-- hand-crafted request could park 2,147,483,647 on a shared row — mischief
-- inside one's own household rather than a breach, and still not a number any
-- list should be able to hold. 999 rather than the stepper's 99
-- (ITEM_QUANTITY_MAX in src/lib/limits.ts) because that cap is a product
-- decision and merges legitimately sum quantities past it; this bound only has
-- to exclude the absurd.
alter table public.shopping_list_items drop constraint if exists shopping_list_items_quantity_check;
alter table public.shopping_list_items add constraint shopping_list_items_quantity_check
  check (quantity between 1 and 999);

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
    household_id,
    lower(btrim(name)),
    lower(btrim(coalesce(maker, '')))
  )
  where checked = false;

-- Serves the two list reads (unchecked, then checked) the app issues on load.
create index if not exists idx_shopping_list_items_household_id_checked
  on public.shopping_list_items (household_id, checked);

-- ─── policies ────────────────────────────────────────────────────────────────
-- Membership is the whole rule: you may read, add, change and remove items in
-- any household you belong to. Insert additionally pins added_by to the caller, and
-- the ownership trigger below stops an update rewriting it afterwards.
drop policy if exists "household members can read items" on public.shopping_list_items;
create policy "household members can read items"
  on public.shopping_list_items for select
  using (
    household_id in (
      select household_id from public.household_members
      where user_id = requesting_user_id()
    )
  );

drop policy if exists "household members can insert items" on public.shopping_list_items;
create policy "household members can insert items"
  on public.shopping_list_items for insert
  with check (
    added_by = requesting_user_id()
    and household_id in (
      select household_id from public.household_members
      where user_id = requesting_user_id()
    )
  );

-- WITH CHECK keeps the row inside the caller's households; the trigger below pins
-- added_by and household_id, which a WITH CHECK expression cannot do because it
-- cannot compare old against new.
drop policy if exists "household members can update items" on public.shopping_list_items;
create policy "household members can update items"
  on public.shopping_list_items for update
  using (
    household_id in (
      select household_id from public.household_members
      where user_id = requesting_user_id()
    )
  )
  with check (
    household_id in (
      select household_id from public.household_members
      where user_id = requesting_user_id()
    )
  );

drop policy if exists "household members can delete items" on public.shopping_list_items;
create policy "household members can delete items"
  on public.shopping_list_items for delete
  using (
    household_id in (
      select household_id from public.household_members
      where user_id = requesting_user_id()
    )
  );

-- ─── row rules the policies cannot express ───────────────────────────────────

-- An item's author and its household are fixed at insert.
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

  if new.household_id is distinct from old.household_id then
    raise exception 'Item cannot be moved between households.'
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
  -- the moment the household sits exactly at the cap.
  if tg_op = 'UPDATE' and coalesce(old.checked, false) = false then
    return new;
  end if;

  select coalesce(f.max_items_per_member, 50)
    into member_limit
  from public.households f
  where f.id = new.household_id;

  -- If the household row is missing, let the FK constraint produce the canonical error.
  if member_limit is null then
    return new;
  end if;

  select count(*)::integer
    into current_count
  from public.shopping_list_items sli
  where sli.household_id = new.household_id
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

-- The cap above is breadth: how many active items a member may hold at once.
-- This is rate: how fast they may create them. The two are different rules and
-- only one of them was here — under the cap alone an account can add, check out
-- and re-add forever, and every insert fires the push fan-out in
-- supabase/functions/push-on-item-insert, so uncapped insert rate is also
-- uncapped notification volume at everyone else in the household.
--
-- A trigger rather than an RPC because the list has several write paths — the
-- direct insert in addItem(), the offline queue's replay
-- (src/lib/offlineQueue.ts), and the 23505 merge after a lost race. A trigger
-- sees all of them, including ones not written yet.
--
-- 300 per hour. Calibrated against the ceiling above it: a member may hold 50
-- active items, so a full list plus a checkout plus a full re-add is 100
-- inserts, and an offline queue flush after a long trip replays as one burst.
-- Deliberately far looser than the catalog limiters in 006 (120 and 240/hour):
-- those guard a ranking every household sees, where one account's repetition is the
-- whole attack. This guards a household's own list, where a false positive costs a
-- real person a grocery item, so it errs toward letting the shopper shop.
--
-- SECURITY DEFINER because rate_limit_hit() (002_security_audit.sql) is granted
-- to no client role; the trigger runs as the owner, which holds the execute.
create or replace function public.enforce_item_insert_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  insert_limit  constant integer  := 300;
  window_length constant interval := interval '1 hour';
  v_actor text := requesting_user_id();
  v_hits  integer;
begin
  -- No JWT means no client: the seed path, the service role and the pgTAP suite
  -- all insert with no claims set. rate_limit_hit() refuses an actorless caller
  -- outright (it returns true — "no budget"), which would otherwise turn every
  -- superuser seed into a failure. RLS already governs whether an
  -- unauthenticated insert may happen at all.
  if v_actor is null then
    return new;
  end if;

  if not public.rate_limit_hit('item_insert', insert_limit, window_length) then
    return new;
  end if;

  -- Over the limit. Now the part that is not obvious.
  --
  -- rate_limit_hit() logs the crossing to security_events on the call where hits
  -- reaches limit + 1. That INSERT is in *this* transaction, so raising here
  -- would roll it back along with the rejected item — the throttle would fire
  -- forever and leave no trace of having fired. 003_households_and_members.sql
  -- hits the same wall in the invite throttle and answers it by returning
  -- quietly instead of raising; a trigger has no such option, because letting
  -- the insert through IS the thing being prevented.
  --
  -- So the crossing call is allowed to commit and everything after it is
  -- rejected. The counter row rate_limit_hit() just wrote tells the two apart.
  -- One item over the ceiling per window buys an audit trail that actually
  -- records the ceiling being hit, which is the whole reason it exists. Note
  -- this also means the counter never climbs past limit + 1: a rejected insert
  -- rolls its own increment back, so the persisted count is the number of
  -- inserts that actually landed.
  select rl.hits
    into v_hits
  from public.rate_limit_counters rl
  where rl.actor = v_actor
    and rl.kind = 'item_insert'
    and rl.window_start = date_bin(window_length, now(), timestamptz 'epoch');

  if coalesce(v_hits, 0) <= insert_limit + 1 then
    return new;
  end if;

  -- The detail string is the client's cue: src/lib/shoppingListActions.ts shows
  -- a "slow down" message on it rather than the generic add failure, and
  -- src/lib/offlineQueue.ts treats it as retryable so a throttled replay is kept
  -- rather than dropped as a permanent rejection.
  raise exception 'Too many items added in a short time. Try again shortly.'
    using errcode = 'P0001',
          detail = 'item_insert_rate_limit_exceeded';
end;
$$;

revoke all on function public.enforce_item_insert_rate_limit() from public;

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

-- INSERT only: the rate ceiling is about creating rows, and unchecking one is
-- already governed by the breadth cap above. BEFORE triggers fire in name order,
-- so this runs ahead of trg_enforce_member_active_item_limit — deliberate but
-- not load-bearing, because a row rejected by either rolls the whole transaction
-- back, counter increment included, so an insert refused for being over the
-- 50-item cap costs no rate budget whichever runs first.
drop trigger if exists trg_enforce_item_insert_rate_limit on public.shopping_list_items;
create trigger trg_enforce_item_insert_rate_limit
before insert on public.shopping_list_items
for each row
execute function public.enforce_item_insert_rate_limit();

-- Revoke then grant, so the end state is exactly these two lines and not these
-- plus the provisioning defaults — TRUNCATE among them, which ignores RLS. The
-- long note at the end of 003_households_and_members.sql explains the whole thing.
-- buy_items() deletes from this table as its owner, so service_role needs no
-- write privilege of its own.
revoke all on public.shopping_list_items from anon, authenticated, service_role;

grant select, insert, update, delete on public.shopping_list_items to authenticated;
grant select on public.shopping_list_items to service_role;
