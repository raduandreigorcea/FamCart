-- ─── foundation (catalog project) ────────────────────────────────────────────
-- The primitives the two files after this one assume exist. Same shape as
-- supabase/migrations/001_foundation.sql, narrowed to what a catalog needs.
--
-- These three files describe the schema as it IS and are safe to re-run, exactly
-- like the seven next door. Same consequence, too, and it is the one that bites:
-- a change made *inside* one of them is invisible to `supabase db push`, which
-- tracks by version and will report "up to date" and apply nothing. See the
-- repair/push dance in CLAUDE.md before editing any of them.
--
--   001 foundation        extensions, the JWT helper, the schema grant
--   002 rate_limit        the audit trail and the throttle behind the bump
--   003 product_catalog   the catalog itself, its search, and the import RPC
--
-- WHAT IS DELIBERATELY ABSENT, so a later reader does not go looking:
-- households, members, profiles, lists, purchase history, realtime, push
-- webhooks, pg_cron. None of them have a counterpart here. This project holds
-- rows that belong to nobody.

-- pg_trgm powers the substring match on product_catalog.search_blob; unaccent
-- lets the server derive search_text itself, which it must -- a client-supplied
-- one would become everyone's matching key. Both land in `extensions` rather
-- than `public` so the schema stays application-owned.
create extension if not exists pg_trgm  with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ─── who is asking ───────────────────────────────────────────────────────────
-- Authentication is Clerk's, and it is the SAME Clerk instance the app projects
-- use. That is what makes one signed-in session able to query two projects: this
-- project's Third-Party Auth integration points at the same issuer, so the token
-- the app already holds verifies here too.
--
-- Configured in the Supabase dashboard and nowhere in this repo. Miss it and
-- this function returns null for every request, which does not fail loudly --
-- reads still work, because the read policy does not care who you are, and only
-- the popularity bump quietly stops counting.
--
-- Returns null for an unauthenticated request, the same fail-closed shape the
-- app schema relies on.
create or replace function requesting_user_id()
returns text
language sql
stable
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
    ''
  )::text;
$$;

-- ─── schema access ───────────────────────────────────────────────────────────
-- Hosted Supabase grants table privileges to the API roles at provisioning, so
-- the app would work without this. A database built from migrations alone
-- (db reset, test db, CI) has no such grants, and the read policy below would
-- fail with "permission denied" before RLS was ever consulted.
--
-- Grants and RLS are separate gates. This opens the first; 003 opens the second.
grant usage on schema public to authenticated;
