-- Family-level preference: cap how many active items each member can add.
alter table public.families
  add column if not exists max_items_per_member integer not null default 50;

alter table public.families
  drop constraint if exists families_max_items_per_member_check;

alter table public.families
  add constraint families_max_items_per_member_check
  check (max_items_per_member between 1 and 50);
