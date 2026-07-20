-- ─── item checked_at ──────────────────────────────────────────────────────────
-- When an item was checked, so the "to buy" (checked) section can show the most
-- recently checked item at the top instead of ordering by creation time.
--
-- Stamped server-side by the trigger below (now() on check, null on uncheck), so
-- the ordering key cannot be forged by a client and is consistent across devices.
-- The client mirrors it optimistically for an instant reorder; the trigger is the
-- authority. buy_items archives to purchase_history without it.
--
-- Idempotent: safe to re-run in the SQL editor.

alter table public.shopping_list_items
  add column if not exists checked_at timestamptz;

-- Backfill rows that were already checked before this column existed, so they
-- carry a stable order (fall back to when they were created). Only touches rows
-- that predate the column.
update public.shopping_list_items
set checked_at = created_at
where checked and checked_at is null;

-- Own checked_at entirely, ignoring whatever the client sends: stamp now() the
-- moment an item becomes checked, clear it on uncheck, and leave an existing
-- stamp alone on an unrelated update to a still-checked row (a quantity change
-- must not bump it to the top of the checked list).
create or replace function public.stamp_item_checked_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if coalesce(new.checked, false) then
    if tg_op = 'INSERT' or coalesce(old.checked, false) = false then
      new.checked_at := now();
    else
      new.checked_at := old.checked_at;
    end if;
  else
    new.checked_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stamp_item_checked_at on public.shopping_list_items;
create trigger trg_stamp_item_checked_at
before insert or update on public.shopping_list_items
for each row
execute function public.stamp_item_checked_at();
