-- ─── realtime ────────────────────────────────────────────────────────────────
-- What Realtime is allowed to broadcast, and in what shape.
--
-- Last, because every table named here has to exist first.
--
-- Note what is NOT here: there is no outbound webhook feature, and pg_net is not
-- installed. An owner-configurable webhook URL once lived alongside this
-- publication and was removed as an SSRF and data-exfiltration surface. It is
-- absent deliberately, not by oversight — nothing in this directory creates it,
-- so a replay cannot resurrect it.

-- Realtime DELETE payloads carry only the primary key unless the table replicates
-- its full old row. The client's channels filter on family_id
-- (src/lib/familyRealtime.ts), and a filter cannot match a column the payload
-- does not include — so without this, deletes would either be missed entirely or
-- have to be broadcast to every family and discarded client-side.
alter table public.shopping_list_items replica identity full;
alter table public.family_members      replica identity full;

-- Add the three tables the dashboard subscribes to: list items, the roster, and
-- the family row itself (renames, emoji, item-limit changes).
--
-- Guarded per table rather than a bare `alter publication ... add table`, which
-- errors if the table is already a member. purchase_history, product_catalog,
-- profiles and the two locked-down security tables are deliberately absent: the
-- app polls or refetches those, and publishing them would stream traffic nobody
-- is listening for.
do $$
declare
  t text;
begin
  foreach t in array array['shopping_list_items', 'family_members', 'families']
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
