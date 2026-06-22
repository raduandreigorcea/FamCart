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

-- Family members can update items (e.g. toggle checked)
create policy "family members can update items"
  on public.shopping_list_items for update
  using (
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
