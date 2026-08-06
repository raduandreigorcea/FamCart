-- ─── realtime ────────────────────────────────────────────────────────────────
-- What Realtime is allowed to broadcast, and in what shape.
--
-- Last, because every table named here has to exist first.
--
-- What is NOT here, precisely: no *owner-configurable* webhook. A settings screen
-- that let a household owner type any URL once lived alongside this publication and
-- was removed as an SSRF and data-exfiltration surface. Nothing in this directory
-- recreates it, so a replay cannot resurrect it.
--
-- An earlier version of this note claimed "pg_net is not installed", and
-- 002_security_audit.sql leaned on that claim to explain why the audit digest has
-- no way to push an alert. Both were wrong. pg_net IS installed —
-- supabase_functions.http_request() is built on net.http_post, and the push
-- webhooks at the bottom of this file depend on it. The distinction that actually
-- matters is not whether the database can make outbound requests, but whether an
-- untrusted party chooses the destination. Here the destination is one hardcoded
-- function of ours; there it was whatever an owner typed.

-- Realtime DELETE payloads carry only the primary key unless the table replicates
-- its full old row. The client's channels filter on household_id
-- (src/lib/householdRealtime.ts), and a filter cannot match a column the payload
-- does not include — so without this, deletes would either be missed entirely or
-- have to be broadcast to every household and discarded client-side.
alter table public.shopping_list_items replica identity full;
alter table public.household_members      replica identity full;

-- Add the three tables the dashboard subscribes to: list items, the roster, and
-- the household row itself (renames, emoji, item-limit changes).
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
  foreach t in array array['shopping_list_items', 'household_members', 'households']
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

-- ─── push fan-out ────────────────────────────────────────────────────────────
-- The two database webhooks that call supabase/functions/push-on-item-insert:
-- one per added item, one per checkout row (the function collapses a checkout by
-- its idempotency key).
--
-- WHY THESE ARE HERE NOW
--
-- They were created in the Supabase dashboard and existed nowhere in this repo.
-- That is fine until the day the database is rebuilt from these files — a new
-- project, a staging copy, a restore — because then you get an app that works in
-- every visible way and silently sends no notifications, with nothing in the
-- codebase to explain the absence. The edge function's own header says it is
-- "called by database webhooks" without anything creating them.
--
-- WHY THE SECRET IS NOT IN THIS FILE
--
-- supabase_functions.http_request() bakes its arguments into the trigger
-- definition, headers included, so writing the secret here would commit it to a
-- public repository. Both values are read from database settings instead, set
-- once per environment and never in git:
--
--   alter database postgres set app.push_webhook_url    = 'https://<ref>.supabase.co/functions/v1/push-on-item-insert';
--   alter database postgres set app.push_webhook_secret = '<the PUSH_WEBHOOK_SECRET edge function secret>';
--
-- Then re-run this file. Without them it warns and creates nothing, which is what
-- keeps local stacks and the pgTAP suite from firing HTTP requests during tests.
--
-- Note the secret still ends up readable in the trigger definition to anyone who
-- can query pg_catalog on a direct connection (pg_get_triggerdef is world
-- readable). It is a shared secret for one function, not a credential, but that
-- is the reason to rotate it if a direct-connection role is ever exposed.
do $$
declare
  v_url    text := current_setting('app.push_webhook_url', true);
  v_secret text := current_setting('app.push_webhook_secret', true);
  v_headers text;
begin
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    raise warning 'push webhooks not configured: set app.push_webhook_url and app.push_webhook_secret on the database, then re-run 007_realtime.sql. Push notifications will not fire until then.';
    return;
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'supabase_functions' and p.proname = 'http_request'
  ) then
    raise warning 'supabase_functions.http_request() is absent; skipping push webhooks.';
    return;
  end if;

  v_headers := jsonb_build_object(
    'Content-type', 'application/json',
    'x-webhook-secret', v_secret
  )::text;

  -- Recreated rather than guarded on existence, so a rotated secret or a moved
  -- URL actually takes effect on a re-run instead of silently keeping the old one.
  drop trigger if exists push_on_item_insert on public.shopping_list_items;
  execute format(
    'create trigger push_on_item_insert after insert on public.shopping_list_items '
    || 'for each row execute function supabase_functions.http_request(%L, %L, %L, %L, %L)',
    v_url, 'POST', v_headers, '{}', '5000'
  );

  drop trigger if exists push_on_checkout on public.purchase_history;
  execute format(
    'create trigger push_on_checkout after insert on public.purchase_history '
    || 'for each row execute function supabase_functions.http_request(%L, %L, %L, %L, %L)',
    v_url, 'POST', v_headers, '{}', '5000'
  );
end;
$$;

-- ─── RLS on by default ───────────────────────────────────────────────────────
-- A safety net that enables row level security on any table created in `public`,
-- so a table added in a hurry cannot be world-readable while nobody is looking.
-- Every table in this schema already enables RLS explicitly; this is what covers
-- the one somebody forgets.
--
-- Also captured from the dashboard rather than invented here: production has been
-- running it, and a database rebuilt from these files without it would be quietly
-- less safe than the one it replaced.
create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name = 'public' then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception when others then
        -- Never break a CREATE TABLE because the safety net stumbled.
        raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    end if;
  end loop;
end;
$$;

revoke all on function public.rls_auto_enable() from public;

-- Exactly one event trigger, whatever it was called before.
--
-- Production created this from the dashboard under the name `ensure_rls`, and an
-- earlier version of this block added a second one under a different name — so a
-- CREATE TABLE fired the same function twice. Harmless, because enabling RLS
-- twice is a no-op, but two objects doing one job is the sprawl these
-- consolidated files exist to prevent. Dropping by function rather than by name
-- converges any database to one regardless of what its trigger was called.
do $$
declare
  t text;
begin
  for t in
    select e.evtname
    from pg_event_trigger e
    join pg_proc p on p.oid = e.evtfoid
    where p.proname = 'rls_auto_enable'
  loop
    execute format('drop event trigger if exists %I', t);
  end loop;

  create event trigger ensure_rls
    on ddl_command_end
    when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
    execute function public.rls_auto_enable();
exception when insufficient_privilege then
  -- Event triggers require superuser. Hosted Supabase runs migrations as a role
  -- that has it here, but a restricted environment may not; the explicit `alter
  -- table ... enable row level security` in 002-006 is the actual guarantee, and
  -- this only backstops tables nobody has written yet.
  raise warning 'could not create the rls_auto_enable event trigger (insufficient privilege); per-table RLS is unaffected.';
end;
$$;
