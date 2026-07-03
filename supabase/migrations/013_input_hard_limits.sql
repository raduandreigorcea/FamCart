-- Harden text/format limits so UI constraints cannot be bypassed by crafted requests.

-- Normalize existing rows so adding stricter constraints does not fail on legacy data.
update public.families
set name = case
  when char_length(btrim(name)) = 0 then 'Family'
  else left(btrim(name), 40)
end
where char_length(btrim(name)) not between 1 and 40;

alter table public.families
  drop constraint if exists families_name_length_check;
alter table public.families
  add constraint families_name_length_check
  check (char_length(btrim(name)) between 1 and 40);

alter table public.families
  drop constraint if exists families_invite_code_format_check;
alter table public.families
  add constraint families_invite_code_format_check
  check (invite_code ~ '^[A-HJ-NP-Z2-9]{8}$');

alter table public.shopping_list_items
  drop constraint if exists shopping_list_items_name_length_check;
alter table public.shopping_list_items
  add constraint shopping_list_items_name_length_check
  check (char_length(btrim(name)) between 1 and 120);

alter table public.family_members
  drop constraint if exists family_members_display_name_length_check;
alter table public.family_members
  add constraint family_members_display_name_length_check
  check (display_name is null or char_length(btrim(display_name)) between 1 and 80);

alter table public.family_members
  drop constraint if exists family_members_image_url_length_check;
alter table public.family_members
  add constraint family_members_image_url_length_check
  check (image_url is null or char_length(image_url) <= 2048);
