-- ─── foundation ──────────────────────────────────────────────────────────────
-- The primitives every other migration in this directory assumes exist.
--
-- About this set as a whole: these seven files describe the schema as it IS, not
-- the order in which it was discovered. They replace thirty-four incremental
-- migrations that had accumulated eight objects created and later dropped
-- outright, four separate definitions of buy_items(), three of
-- join_household_with_code(), and one policy written three times. Nothing here
-- undoes anything else here; each file states one intent and is safe to re-run.
--
-- They are ordered by dependency, and that order is load-bearing:
--
--   001 foundation           extensions, the JWT helper, the schema grant
--   002 security_audit       the audit trail, the throttle, and who reads them
--   003 households_and_members who exists and who may change what
--   004 shopping_list        the list itself
--   005 purchase_history     what was bought
--   006 product_catalog      the searchable catalog
--   007 realtime             what Realtime broadcasts
--
-- 002 sits early because 003 and 006 both write to it. The set it replaces had
-- that backwards, introducing the audit trail and the rate limiter long after
-- the functions that needed them.

-- pg_trgm powers the substring match on product_catalog.search_text; unaccent
-- lets the server derive that search_text itself, which it must — a
-- client-supplied one would become everyone's matching key once a contributed
-- product is promoted to global. Both land in `extensions` rather than `public`
-- so the schema stays application-owned.
create extension if not exists pg_trgm  with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ─── who is asking ───────────────────────────────────────────────────────────
-- Authentication is Clerk's; the database only ever sees the verified JWT it
-- issued. Every policy, trigger and RPC in this schema identifies the caller
-- through this one function, so there is a single definition of "you".
--
-- Returns null for an unauthenticated request, which is what makes the policies
-- fail closed: `user_id = requesting_user_id()` is never true for null.
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
-- Hosted Supabase grants table privileges to the API roles when a project is
-- provisioned, so the app worked without this. A database built from migrations
-- alone (supabase db reset, supabase test db, CI) has no such grants, and every
-- RLS policy subquery fails with "permission denied" before row-level evaluation
-- even starts.
--
-- Grants and RLS are separate gates. This opens the first one; each table below
-- opens the second, and RLS remains the authority on which rows are visible.
grant usage on schema public to authenticated;
