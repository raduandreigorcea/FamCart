-- Enable outbound HTTP calls from Postgres for webhook delivery.
create extension if not exists pg_net;

-- Owner-configurable endpoint for family events.
alter table public.families
add column if not exists webhook_url text;

-- Realtime publication entries for live WebSocket updates.
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

-- Push family-scoped events to a webhook endpoint if one is configured.
create or replace function public.send_family_webhook()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_family_id uuid;
  target_url text;
  payload jsonb;
begin
  if tg_table_name = 'families' then
    target_family_id := coalesce(new.id, old.id);
    target_url := coalesce(new.webhook_url, old.webhook_url);
  else
    target_family_id := coalesce(new.family_id, old.family_id);
    select f.webhook_url
      into target_url
    from public.families f
    where f.id = target_family_id;
  end if;

  if target_url is null or btrim(target_url) = '' then
    return coalesce(new, old);
  end if;

  payload := jsonb_build_object(
    'event', tg_op,
    'table', tg_table_name,
    'family_id', target_family_id,
    'record', to_jsonb(new),
    'old_record', to_jsonb(old),
    'sent_at', now()
  );

  perform net.http_post(
    url := target_url,
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := payload
  );

  return coalesce(new, old);
exception
  when others then
    -- Never block user actions because a webhook failed.
    return coalesce(new, old);
end;
$$;

-- Emit webhook events when the shopping list changes.
drop trigger if exists trg_shopping_list_items_webhook on public.shopping_list_items;
create trigger trg_shopping_list_items_webhook
after insert or update or delete on public.shopping_list_items
for each row execute function public.send_family_webhook();

-- Emit webhook events when family membership changes.
drop trigger if exists trg_family_members_webhook on public.family_members;
create trigger trg_family_members_webhook
after insert or delete on public.family_members
for each row execute function public.send_family_webhook();

-- Emit webhook events for family metadata updates.
drop trigger if exists trg_families_webhook on public.families;
create trigger trg_families_webhook
after update of name, invite_code on public.families
for each row execute function public.send_family_webhook();
