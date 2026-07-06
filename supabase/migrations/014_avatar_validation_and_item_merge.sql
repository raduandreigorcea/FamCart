-- Follow-up hardening:
--   1. Restrict avatar URLs to https (close the data:/http:/beacon vector).
--   2. Race-proof the per-name item merge with a unique partial index.
--   3. Mirror the families UPDATE policy's USING clause in WITH CHECK.

-- ─── 1. Avatar URL scheme validation ──────────────────────────────────────────
-- image_url / added_by_image_url are user-controlled (a member sets their own
-- profile row; the client sends added_by_image_url on insert). They render as
-- <img src>, so this is not an XSS vector, but an arbitrary scheme lets a member
-- point them at a logging endpoint (IP/timing beacon) or a data: blob. Require
-- https. Existing invalid values are nulled first so the constraints apply
-- cleanly to legacy data (Clerk avatars are already https, so they are kept).
update public.family_members
set image_url = null
where image_url is not null and image_url !~ '^https://';

alter table public.family_members
  drop constraint if exists family_members_image_url_scheme_check;
alter table public.family_members
  add constraint family_members_image_url_scheme_check
  check (image_url is null or image_url ~ '^https://');

update public.shopping_list_items
set added_by_image_url = null
where added_by_image_url is not null
  and (added_by_image_url !~ '^https://' or char_length(added_by_image_url) > 2048);

alter table public.shopping_list_items
  drop constraint if exists shopping_list_items_added_by_image_url_check;
alter table public.shopping_list_items
  add constraint shopping_list_items_added_by_image_url_check
  check (
    added_by_image_url is null
    or (added_by_image_url ~ '^https://' and char_length(added_by_image_url) <= 2048)
  );

-- ─── 2. Race-proof "one active row per item name" ─────────────────────────────
-- The client merges same-name items, but two clients adding "milk" at the same
-- instant each miss the other locally and insert two rows. Enforce uniqueness at
-- the DB so the loser gets a 23505 it can fold into the winner. lower(btrim(name))
-- matches the client's merge key (trim + lowercase); the partial predicate scopes
-- it to active rows so a bought item and a freshly re-added one can coexist.

-- First collapse any duplicate active rows that already exist: the oldest row in
-- each group keeps the summed quantity, the rest are removed.
with totals as (
  select
    (array_agg(id order by created_at, id))[1] as keeper_id,
    sum(quantity) as total_qty
  from public.shopping_list_items
  where checked = false
  group by family_id, lower(btrim(name))
  having count(*) > 1
)
update public.shopping_list_items s
set quantity = totals.total_qty
from totals
where s.id = totals.keeper_id;

with ranked as (
  select
    id,
    row_number() over (
      partition by family_id, lower(btrim(name))
      order by created_at, id
    ) as rn
  from public.shopping_list_items
  where checked = false
)
delete from public.shopping_list_items s
using ranked
where s.id = ranked.id and ranked.rn > 1;

create unique index if not exists shopping_list_items_unique_active_name
  on public.shopping_list_items (family_id, lower(btrim(name)))
  where checked = false;

-- ─── 3. Tighten families UPDATE WITH CHECK ────────────────────────────────────
-- Mirror the USING predicate so an owner/moderator update cannot leave the row in
-- a family they don't control (defence in depth; created_by and name are already
-- protected by triggers from migration 011).
drop policy if exists "family owner or moderator can update family" on public.families;
create policy "family owner or moderator can update family"
  on public.families for update
  using (public.is_family_owner_or_moderator(id))
  with check (public.is_family_owner_or_moderator(id));
