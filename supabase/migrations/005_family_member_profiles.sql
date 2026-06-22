alter table public.family_members
add column if not exists display_name text,
add column if not exists image_url text;
