alter table public.shopping_list_items
add column if not exists added_by_name text,
add column if not exists added_by_image_url text;
