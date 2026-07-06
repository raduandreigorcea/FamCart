-- ─── shopping_list_items ─────────────────────────────────────────────────────
create table if not exists public.shopping_list_items (
  id          uuid        primary key default gen_random_uuid(),
  family_id   uuid        not null references public.families(id) on delete cascade,
  name        text        not null,
  checked     boolean     not null default false,
  added_by    text        not null,   -- Clerk user ID
  created_at  timestamptz not null default now()
);

alter table public.shopping_list_items enable row level security;

-- Family members can read their family's items
create policy "family members can read items"
  on public.shopping_list_items for select
  using (
    family_id in (
      select family_id from public.family_members
      where user_id = requesting_user_id()
    )
  );

-- Family members can insert items
create policy "family members can insert items"
  on public.shopping_list_items for insert
  with check (
    added_by = requesting_user_id()
    and family_id in (
      select family_id from public.family_members
      where user_id = requesting_user_id()
    )
  );

-- Family members can update items (e.g. toggle checked). WITH CHECK keeps the
-- row within the caller's families; the trigger below pins added_by/family_id.
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

-- Family members can delete items
create policy "family members can delete items"
  on public.shopping_list_items for delete
  using (
    family_id in (
      select family_id from public.family_members
      where user_id = requesting_user_id()
    )
  );

-- Prevent reassigning an item's creator or moving it between families on update
-- (a WITH CHECK expression cannot compare old vs new).
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

drop trigger if exists trg_prevent_item_ownership_change on public.shopping_list_items;
create trigger trg_prevent_item_ownership_change
before update on public.shopping_list_items
for each row
execute function public.prevent_item_ownership_change();
