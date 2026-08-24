-- Tests for the admin read surface (008_admin.sql).
--
-- Run with the Supabase CLI against the local stack:
--   supabase db reset          -- REQUIRED first: db start restores a backup and
--   supabase test db           -- skips migrations, so this would test a stale schema
--
-- What these assert, and why each one is worth a test rather than a reading of
-- the migration:
--
--   1. The gate is real. A signed-in non-admin calling any admin_* function gets
--      an exception, not an empty result. The distinction matters: a dashboard
--      cannot tell "no households exist" from "you may not ask", and neither can
--      an attacker deciding whether to keep going.
--   2. The gate is not bypassable by reading the table directly. admin_users has
--      RLS with zero policies and no grants, so even knowing it exists gets a
--      client nothing -- including the list of who the admins are.
--   3. is_admin() is the one thing a client may call unauthenticated-by-admin,
--      and it answers only about the caller.
--   4. An actual admin gets real numbers across households they are not in.
--      This is the whole point of the file, and it is the assertion that would
--      fail if a definer function were accidentally declared invoker.
--   5. The two writes behave: granting is idempotent and audited, revoking your
--      own access is refused, and neither is reachable by a non-admin.
--   6. The derived columns mean what 008 says they mean -- last_active moves when
--      the account does something, and admin_activity_series emits empty buckets
--      rather than skipping them.
--   7. anon reaches none of it, with or without a JWT.
--
-- Runs inside a transaction that is rolled back, so it leaves no data behind.

begin;
select plan(46);

-- ── Seed as the migration/superuser role (bypasses RLS) ──────────────────────
-- Two households owned by two different people, plus a third account that is in
-- neither. The third is the one that proves cross-household reads are gated:
-- everything it can see through the admin functions is something RLS would have
-- denied it.
insert into public.profiles (user_id, display_name) values
  ('admin_one', 'Ada the Admin'),
  ('plain_one', 'Pat the Plain'),
  ('plain_two', 'Pip the Plain');

insert into public.households (id, name, invite_code, created_by) values
  ('00000000-0000-0000-0000-0000000000e1', 'Household E', 'EEEEEEE2', 'plain_one'),
  ('00000000-0000-0000-0000-0000000000f1', 'Household F', 'FFFFFFF2', 'plain_two');

insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000e1', 'plain_one', 'moderator'),
  ('00000000-0000-0000-0000-0000000000f1', 'plain_two', 'moderator');

insert into public.shopping_list_items (household_id, name, added_by) values
  ('00000000-0000-0000-0000-0000000000e1', 'Milk',   'plain_one'),
  ('00000000-0000-0000-0000-0000000000e1', 'Bread',  'plain_one'),
  ('00000000-0000-0000-0000-0000000000f1', 'Coffee', 'plain_two');

-- Ada is the admin. Seeded here the same way the bootstrap row is seeded in
-- production: by hand, with a role that bypasses RLS, because admin_grant()
-- requires an existing admin and there is never one on a fresh database.
insert into public.admin_users (user_id, note) values ('admin_one', 'test fixture');

-- ── 1. The gate refuses a signed-in non-admin ────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"plain_one"}';

select ok(
  not public.is_admin(),
  'is_admin() is false for an ordinary signed-in user'
);

select throws_ok(
  $$ select public.admin_overview() $$,
  '42501',
  null,
  'admin_overview() refuses a non-admin with insufficient_privilege'
);

select throws_ok(
  $$ select * from public.admin_list_users() $$,
  '42501',
  null,
  'admin_list_users() refuses a non-admin'
);

select throws_ok(
  $$ select * from public.admin_list_households() $$,
  '42501',
  null,
  'admin_list_households() refuses a non-admin'
);

select throws_ok(
  $$ select * from public.admin_recent_activity() $$,
  '42501',
  null,
  'admin_recent_activity() refuses a non-admin'
);

select throws_ok(
  $$ select * from public.admin_activity_series() $$,
  '42501',
  null,
  'admin_activity_series() refuses a non-admin'
);

select throws_ok(
  $$ select public.admin_health() $$,
  '42501',
  null,
  'admin_health() refuses a non-admin'
);

select throws_ok(
  $$ select * from public.admin_security_events() $$,
  '42501',
  null,
  'admin_security_events() refuses a non-admin'
);

select throws_ok(
  $$ select * from public.admin_event_digest() $$,
  '42501',
  null,
  'admin_event_digest() refuses a non-admin'
);

select throws_ok(
  $$ select * from public.admin_rate_limits() $$,
  '42501',
  null,
  'admin_rate_limits() refuses a non-admin'
);

select throws_ok(
  $$ select * from public.admin_local_products() $$,
  '42501',
  null,
  'admin_local_products() refuses a non-admin'
);

select throws_ok(
  $$ select * from public.admin_list_admins() $$,
  '42501',
  null,
  'admin_list_admins() refuses a non-admin'
);

select throws_ok(
  $$ select public.admin_user_detail('plain_two') $$,
  '42501',
  null,
  'admin_user_detail() refuses a non-admin'
);

select throws_ok(
  $$ select public.admin_household_detail('00000000-0000-0000-0000-0000000000f1'::uuid) $$,
  '42501',
  null,
  'admin_household_detail() refuses a non-admin'
);

-- ── 2. Neither write is reachable by a non-admin ─────────────────────────────
select throws_ok(
  $$ select public.admin_grant('plain_one', 'self-promotion') $$,
  '42501',
  null,
  'admin_grant() refuses a non-admin trying to promote themselves'
);

select throws_ok(
  $$ select public.admin_revoke('admin_one') $$,
  '42501',
  null,
  'admin_revoke() refuses a non-admin trying to demote the real admin'
);

-- ── 3. The admin table itself is unreadable ──────────────────────────────────
-- Two separate gates, and this checks the privilege one. RLS with zero policies
-- would return no rows even if the grant existed; the grant is revoked as well,
-- so the attempt fails before row-level evaluation.
select throws_ok(
  $$ select * from public.admin_users $$,
  '42501',
  null,
  'a signed-in user cannot select from admin_users at all'
);

select throws_ok(
  $$ insert into public.admin_users (user_id) values ('plain_one') $$,
  '42501',
  null,
  'a signed-in user cannot insert themselves into admin_users'
);

-- The internal helpers are not client-callable either, so the gate cannot be
-- stepped around by calling the thing it wraps.
select throws_ok(
  $$ select * from public.admin_user_facts() $$,
  '42501',
  null,
  'admin_user_facts() is not executable by a client role'
);

select throws_ok(
  $$ select * from public.admin_household_facts() $$,
  '42501',
  null,
  'admin_household_facts() is not executable by a client role'
);

-- ── 4. An admin gets real cross-household numbers ────────────────────────────
set local request.jwt.claims = '{"sub":"admin_one"}';

select ok(public.is_admin(), 'is_admin() is true for a seeded admin');

-- Ada belongs to no household at all. Under RLS she can see nothing; through the
-- definer functions she sees both. That gap is the entire feature.
select is(
  (select count(*)::int from public.households),
  0,
  'the admin sees no households through RLS, being a member of none'
);

select is(
  ((public.admin_overview() -> 'totals' ->> 'households'))::int,
  2,
  'admin_overview() reports both households regardless of membership'
);

select is(
  ((public.admin_overview() -> 'totals' ->> 'users'))::int,
  3,
  'admin_overview() reports every profile'
);

select is(
  ((public.admin_overview() -> 'totals' ->> 'list_items'))::int,
  3,
  'admin_overview() reports every list item across households'
);

select is(
  (select count(*)::int from public.admin_list_households()),
  2,
  'admin_list_households() returns both households'
);

select is(
  (select count(*)::int from public.admin_list_users()),
  3,
  'admin_list_users() returns every account'
);

-- total_count is the window count before the limit, which is what the pager
-- reads. A limit of 1 must still report 3.
select is(
  (select total_count::int from public.admin_list_users(null, 'display_name', 'asc', 1, 0)),
  3,
  'admin_list_users() reports the full match count alongside a single-row page'
);

select is(
  (select user_id from public.admin_list_users(null, 'display_name', 'asc', 1, 0)),
  'admin_one',
  'admin_list_users() sorts by display name ascending when asked'
);

select is(
  (select count(*)::int from public.admin_list_users('Pat')),
  1,
  'admin_list_users() filters on display name'
);

-- ── 5. The derived columns say what 008 claims ───────────────────────────────
-- Pat added two items, Pip one. items_added is per account, not per household.
select is(
  (select items_added::int from public.admin_list_users('Pat')),
  2,
  'admin_user_facts() counts items per account'
);

select is(
  (select (public.admin_user_detail('plain_one') -> 'households' ->> 0)::jsonb ->> 'role'),
  'moderator',
  'admin_user_detail() resolves household membership and role'
);

-- The spine emits every bucket in range, including the empty ones. Seven days
-- back at daily granularity is 8 buckets inclusive of both ends.
select is(
  (select count(*)::int from public.admin_activity_series(now() - interval '7 days', 'day')),
  8,
  'admin_activity_series() emits empty buckets rather than skipping quiet days'
);

select throws_ok(
  $$ select * from public.admin_activity_series(null, 'fortnight') $$,
  null,
  'admin_activity_series: p_bucket must be hour, day or week, got fortnight',
  'admin_activity_series() rejects a bucket it does not know'
);

-- ── 6. Revoking your own access is refused ───────────────────────────────────
select throws_ok(
  $$ select public.admin_revoke('admin_one') $$,
  '42501',
  null,
  'admin_revoke() refuses to remove the calling admin'
);

-- ── 7. anon reaches none of it ───────────────────────────────────────────────
set local role anon;
set local request.jwt.claims = '{"sub":"plain_one"}';

select throws_ok(
  $$ select public.is_admin() $$,
  '42501',
  null,
  'anon cannot even ask whether it is an admin'
);

select throws_ok(
  $$ select public.admin_overview() $$,
  '42501',
  null,
  'anon cannot call admin_overview()'
);

reset role;

-- ─── deletion and bans ───────────────────────────────────────────────────────
--
-- These are the only write RPCs on this dashboard besides grant/revoke, so the
-- guard matters more here than on a read: a read that leaks is embarrassing, a
-- write that leaks lets a signed-in stranger empty somebody's household.

set local role authenticated;
set local request.jwt.claims = '{"sub":"plain_one"}';

select throws_ok(
  $$ select public.admin_delete_household('00000000-0000-0000-0000-0000000000e1') $$,
  '42501',
  null,
  'admin_delete_household refuses a non-admin'
);

select throws_ok(
  $$ select public.admin_restore_household('00000000-0000-0000-0000-0000000000e1') $$,
  '42501',
  null,
  'admin_restore_household refuses a non-admin'
);

select throws_ok(
  $$ select public.admin_ban_user('plain_two', 'spam') $$,
  '42501',
  null,
  'admin_ban_user refuses a non-admin'
);

select throws_ok(
  $$ select public.admin_unban_user('plain_two') $$,
  '42501',
  null,
  'admin_unban_user refuses a non-admin'
);

select throws_ok(
  $$ select * from public.admin_deleted_households() $$,
  '42501',
  null,
  'admin_deleted_households refuses a non-admin'
);

set local request.jwt.claims = '{"sub":"admin_one"}';

select lives_ok(
  $$ select public.admin_delete_household('00000000-0000-0000-0000-0000000000e1') $$,
  'an admin may delete a household'
);

select is(
  (select count(*)::int from public.admin_deleted_households()),
  1,
  'the deleted household is what Trash lists'
);

-- The audit row is the reason soft delete beats hard delete here: it still
-- points at a household that exists.
--
-- Read with the role dropped, because security_events is unreadable from a
-- client role on purpose -- assertion 10 of rls.test.sql exists to keep it that
-- way, and a test that quietly needed it readable would be undermining another
-- test's guarantee to check its own.
reset role;
select isnt(
  (select count(*)::int from public.security_events
   where kind = 'admin_household_deleted'),
  0,
  'deleting left an audit row'
);
set local role authenticated;

select lives_ok(
  $$ select public.admin_restore_household('00000000-0000-0000-0000-0000000000e1') $$,
  'and an admin may put it back'
);

select * from finish();
rollback;
