-- Enforce per-user active item cap at the database layer.
-- This prevents race conditions or stale client state from bypassing the UI check.

alter table public.families
  add column if not exists max_items_per_member integer not null default 50;

alter table public.families
  drop constraint if exists families_max_items_per_member_check;

alter table public.families
  add constraint families_max_items_per_member_check
  check (max_items_per_member between 1 and 50);

create or replace function public.enforce_member_active_item_limit()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_count integer;
  member_limit integer;
begin
  -- Only enforce the cap for active (unchecked) items.
  if coalesce(new.checked, false) = true then
    return new;
  end if;

  -- On UPDATE, only enforce when the row is newly becoming active (an uncheck).
  -- A row that was already active being updated for some other reason (e.g. a
  -- quantity change) is already counted below, so enforcing here would reject it
  -- the moment the family sits exactly at the cap.
  if tg_op = 'UPDATE' and coalesce(old.checked, false) = false then
    return new;
  end if;

  select coalesce(f.max_items_per_member, 50)
    into member_limit
  from public.families f
  where f.id = new.family_id;

  -- If family row is missing, let the FK constraint produce the canonical error.
  if member_limit is null then
    return new;
  end if;

  select count(*)::integer
    into current_count
  from public.shopping_list_items sli
  where sli.family_id = new.family_id
    and sli.added_by = new.added_by
    and sli.checked = false;

  if current_count >= member_limit then
    raise exception 'You reached your limit of % active items.', member_limit
      using errcode = 'P0001',
            detail = 'member_active_item_limit_exceeded';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_member_active_item_limit on public.shopping_list_items;

-- INSERT and UPDATE: unchecking an item makes it active again, which must count
-- against the cap the same way adding one does.
create trigger trg_enforce_member_active_item_limit
before insert or update on public.shopping_list_items
for each row
execute function public.enforce_member_active_item_limit();
