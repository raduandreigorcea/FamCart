-- Ensure DELETE events include full old rows so Realtime filters on family_id work.
alter table public.shopping_list_items replica identity full;

-- Keep member DELETE events consistent with the same family_id filtering pattern.
alter table public.family_members replica identity full;
