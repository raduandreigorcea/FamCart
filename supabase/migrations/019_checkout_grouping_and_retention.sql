-- Group purchase history into checkout events, and cap how much is kept.
--
-- Every item bought in one Buy action shares a checkout_id, so the history view
-- can separate same-day purchases by who checked out and when. Retention keeps
-- each family's history bounded to the 60 most recent checkouts, and nothing
-- older than 30 days.
--
-- The whole file is idempotent, so it is safe to re-run in the SQL editor.

alter table public.purchase_history
  add column if not exists checkout_id uuid;

-- Backfill rows written before this column existed. buy_items stamped one
-- transaction time per checkout, so (family_id, purchased_by, purchased_at)
-- reconstructs the original grouping.
with groups as (
  select family_id, purchased_by, purchased_at, gen_random_uuid() as new_id
  from public.purchase_history
  where checkout_id is null
  group by family_id, purchased_by, purchased_at
)
update public.purchase_history ph
set checkout_id = g.new_id
from groups g
where ph.checkout_id is null
  and ph.family_id = g.family_id
  and ph.purchased_by = g.purchased_by
  and ph.purchased_at = g.purchased_at;

create index if not exists idx_purchase_history_checkout
  on public.purchase_history (family_id, checkout_id);

-- Stamp a single checkout_id across every item bought in one call.
create or replace function public.buy_items(p_item_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_checkout_id uuid := gen_random_uuid();
  moved integer;
begin
  with removed as (
    delete from public.shopping_list_items
    where id = any(p_item_ids)
      and checked = true
    returning family_id, id, name, quantity, added_by, added_by_name, added_by_image_url
  )
  insert into public.purchase_history
    (checkout_id, family_id, item_id, name, quantity, added_by, added_by_name, added_by_image_url, purchased_by)
  select
    v_checkout_id, family_id, id, name, quantity, added_by, added_by_name, added_by_image_url, requesting_user_id()
  from removed;

  get diagnostics moved = row_count;
  return moved;
end;
$$;

-- Retention (on checkout). After each checkout, prune the families it touched
-- back to their 60 most recent checkouts and drop anything older than 30 days.
--
-- SECURITY DEFINER: the app role has only select/insert on this append-only
-- table (no delete grant or policy), so the prune runs as the table owner.
-- Its only effect is enforcing the fixed retention policy — it cannot remove a
-- recent checkout — so running as owner is safe. A statement-level trigger with
-- a transition table prunes once per checkout instead of once per row.
create or replace function public.prune_purchase_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  with affected as (
    select distinct family_id from new_rows
  ),
  checkouts as (
    select ph.family_id, ph.checkout_id, max(ph.purchased_at) as ts
    from public.purchase_history ph
    join affected a on a.family_id = ph.family_id
    group by ph.family_id, ph.checkout_id
  ),
  ranked as (
    select
      checkout_id,
      ts,
      row_number() over (partition by family_id order by ts desc, checkout_id desc) as rn
    from checkouts
  ),
  doomed as (
    select checkout_id
    from ranked
    where rn > 60
       or ts < now() - interval '30 days'
  )
  delete from public.purchase_history ph
  using doomed d
  where ph.checkout_id = d.checkout_id;

  return null;
end;
$$;

drop trigger if exists trg_prune_purchase_history on public.purchase_history;
create trigger trg_prune_purchase_history
after insert on public.purchase_history
referencing new table as new_rows
for each statement
execute function public.prune_purchase_history();

-- Retention (daily sweep). The trigger above only prunes a family when it
-- checks out, so a family that goes quiet could keep checkouts past 30 days
-- until its next one. This scheduled job deletes anything older than 30 days
-- across every family, regardless of activity. Requires pg_cron.
--
-- On Supabase the postgres role may enable it directly; if this create fails on
-- your instance, enable "pg_cron" once under Database -> Extensions in the
-- dashboard, then re-run.
create extension if not exists pg_cron;

-- cron.schedule upserts by job name, so re-running this is not a duplicate.
-- Runs daily at 03:00 UTC.
select cron.schedule(
  'purge-checkouts-older-than-30-days',
  '0 3 * * *',
  $$delete from public.purchase_history where purchased_at < now() - interval '30 days'$$
);
