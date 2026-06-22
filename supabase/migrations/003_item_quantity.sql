alter table public.shopping_list_items
add column if not exists quantity integer not null default 1
check (quantity >= 1);
