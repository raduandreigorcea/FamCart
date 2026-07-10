-- Purchase history + the "buy" action.
--
-- Checking an item marks it as ready to buy; the Buy button then archives every
-- checked item into purchase_history and removes it from the active list. The
-- archive is what distinguishes buying from the trash button (delete = "I don't
-- want this"), so it is driven by an explicit RPC rather than a delete trigger:
-- a trigger could not tell a purchase apart from a merge-delete or an individual
-- removal, and would pollute history with items no one bought.

create table if not exists public.purchase_history (
  id                  uuid        primary key default gen_random_uuid(),
  family_id           uuid        not null references public.families(id) on delete cascade,
  item_id             uuid,       -- original shopping_list_items id (informational)
  name                text        not null,
  quantity            integer     not null default 1,
  added_by            text,       -- who originally added the item
  added_by_name       text,
  added_by_image_url  text,
  purchased_by        text        not null,   -- Clerk user id who hit Buy
  purchased_at        timestamptz not null default now()
);

-- A "recently bought" view will read newest-first within a family.
create index if not exists idx_purchase_history_family_purchased_at
  on public.purchase_history (family_id, purchased_at desc);

alter table public.purchase_history enable row level security;

-- Family members can read their family's purchase history. drop-then-create so
-- the migration stays safe to re-run against an already-applied database.
drop policy if exists "family members can read purchase history" on public.purchase_history;
create policy "family members can read purchase history"
  on public.purchase_history for select
  using (
    family_id in (
      select family_id from public.family_members
      where user_id = requesting_user_id()
    )
  );

-- Rows are written by buy_items() running as the caller: the purchaser must be
-- the caller and the row must belong to one of their families.
drop policy if exists "family members can insert purchase history" on public.purchase_history;
create policy "family members can insert purchase history"
  on public.purchase_history for insert
  with check (
    purchased_by = requesting_user_id()
    and family_id in (
      select family_id from public.family_members
      where user_id = requesting_user_id()
    )
  );

-- History is append-only from the app; no update/delete policies. Deleting a
-- family cascades its history away.

-- Explicit grants for the client-facing role (see migration 015 for why these
-- are needed on a from-migrations database).
grant select, insert on public.purchase_history to authenticated;

-- Archive the given checked items and remove them from the active list in one
-- statement, so a purchase can never half-apply. SECURITY INVOKER: the caller's
-- RLS governs both the delete (must be a member of each row's family) and the
-- insert (policy above), so passing ids from other families archives nothing.
-- The `checked = true` guard means an unchecked row slipping into the id list is
-- ignored rather than silently bought. Returns the number of items bought.
create or replace function public.buy_items(p_item_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  moved integer;
begin
  with removed as (
    delete from public.shopping_list_items
    where id = any(p_item_ids)
      and checked = true
    returning family_id, id, name, quantity, added_by, added_by_name, added_by_image_url
  )
  insert into public.purchase_history
    (family_id, item_id, name, quantity, added_by, added_by_name, added_by_image_url, purchased_by)
  select
    family_id, id, name, quantity, added_by, added_by_name, added_by_image_url, requesting_user_id()
  from removed;

  get diagnostics moved = row_count;
  return moved;
end;
$$;

grant execute on function public.buy_items(uuid[]) to authenticated;
