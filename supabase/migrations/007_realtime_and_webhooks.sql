-- Realtime publication entries for live WebSocket updates.
--
-- NOTE: This migration originally also added an owner-configurable outbound
-- webhook feature (pg_net extension + send_family_webhook triggers + a
-- families.webhook_url column). That feature was removed for security (it was an
-- SSRF / data-exfiltration surface), and the webhook code has been stripped from
-- this file so a fresh replay never creates it.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shopping_list_items'
  ) then
    execute 'alter publication supabase_realtime add table public.shopping_list_items';
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'family_members'
  ) then
    execute 'alter publication supabase_realtime add table public.family_members';
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'families'
  ) then
    execute 'alter publication supabase_realtime add table public.families';
  end if;
end;
$$;
