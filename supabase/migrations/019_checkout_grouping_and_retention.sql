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
--
-- SECURITY DEFINER (was invoker in 018): purchase_history no longer accepts
-- direct client inserts (see below), so the archive insert must run as the
-- table owner. That also means RLS no longer guards the delete, so membership
-- is checked explicitly: only checked items in one of the caller's families
-- can be bought (mirroring the shopping_list_items delete policy). Every
-- history field is therefore server-stamped and trustworthy — in particular
-- purchased_at and checkout_id, which the retention logic ranks by.
create or replace function public.buy_items(p_item_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user text := requesting_user_id();
  v_checkout_id uuid := gen_random_uuid();
  moved integer;
begin
  if v_user is null then
    return 0;
  end if;

  with removed as (
    delete from public.shopping_list_items
    where id = any(p_item_ids)
      and checked = true
      and family_id in (
        select fm.family_id from public.family_members fm
        where fm.user_id = v_user
      )
    returning family_id, id, name, quantity, added_by, added_by_name, added_by_image_url
  )
  insert into public.purchase_history
    (checkout_id, family_id, item_id, name, quantity, added_by, added_by_name, added_by_image_url, purchased_by)
  select
    v_checkout_id, family_id, id, name, quantity, added_by, added_by_name, added_by_image_url, v_user
  from removed;

  get diagnostics moved = row_count;
  return moved;
end;
$$;

-- Function EXECUTE defaults to PUBLIC; scope it to signed-in users.
revoke all on function public.buy_items(uuid[]) from public;
grant execute on function public.buy_items(uuid[]) to authenticated;

-- Close the history-forgery hole. 018 granted direct INSERT so the
-- invoker-mode buy_items could write history — which also let any member
-- insert arbitrary rows: fake author names/avatars (bypassing the identity
-- stamping and https checks from migration 014), and future purchased_at
-- timestamps that would trick the prune trigger below into deleting the
-- family's real checkouts. buy_items is now the only writer, so drop the
-- client-facing insert path entirely.
drop policy if exists "family members can insert purchase history" on public.purchase_history;
revoke insert on public.purchase_history from authenticated;

-- Every writer stamps a checkout id now and the backfill above covered
-- pre-existing rows, so lock the column. (Also keeps the prune trigger honest:
-- its delete matches on checkout_id, which never matches null rows.)
alter table public.purchase_history
  alter column checkout_id set not null;

-- Retention (on checkout). After each checkout, prune the families it touched
-- back to their 60 most recent checkouts and drop anything older than 30 days.
--
-- SECURITY DEFINER: the app role has only select on this append-only table
-- (no insert/update/delete; buy_items writes it as owner), so the prune runs
-- as the table owner. purchased_at is always server-stamped by buy_items, so
-- ranking by it cannot be gamed and the prune can never remove a genuinely
-- recent checkout. A statement-level trigger with a transition table prunes
-- once per checkout instead of once per row.
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
-- Wrapped in a DO block so a database where pg_cron cannot be created (not on
-- the image, or insufficient privilege — e.g. `supabase test db`) still gets
-- the rest of this migration: the sweep is a safety net on top of the trigger,
-- not the primary mechanism. On hosted Supabase, if this raises a warning
-- instead of scheduling, enable "pg_cron" once under Database -> Extensions in
-- the dashboard, then re-run this file.
do $cron$
begin
  create extension if not exists pg_cron;

  -- cron.schedule upserts by job name, so re-running this is not a duplicate.
  -- Runs daily at 03:00 UTC.
  perform cron.schedule(
    'purge-checkouts-older-than-30-days',
    '0 3 * * *',
    $job$delete from public.purchase_history where purchased_at < now() - interval '30 days'$job$
  );
exception when others then
  raise warning 'pg_cron sweep not scheduled (%); the checkout trigger still enforces retention.', sqlerrm;
end;
$cron$;
