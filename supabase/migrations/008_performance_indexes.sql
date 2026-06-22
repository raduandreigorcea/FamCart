-- Create indexes for performance and scalability
create index if not exists idx_shopping_list_items_family_id_checked
  on public.shopping_list_items (family_id, checked);

create index if not exists idx_family_members_family_id
  on public.family_members (family_id);
