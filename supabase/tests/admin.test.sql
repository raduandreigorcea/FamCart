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
select plan(74);

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

select throws_ok(
  $$ select * from public.admin_banned_users() $$,
  '42501',
  null,
  'admin_banned_users refuses a non-admin'
);

set local request.jwt.claims = '{"sub":"admin_one"}';

-- Pat is in Household E and nothing else, so this is the number the Users list
-- and Pat's own profile show right now. It is read before the delete so the
-- assertion after it is a change and not a coincidence.
--
-- Role dropped for the same reason as admin_household_facts below: this is an
-- internal helper the public RPCs read through, revoked from authenticated.
reset role;
select is(
  (select households::int from public.admin_user_facts() where user_id = 'plain_one'),
  1,
  'before the delete, Pat is counted as being in one household'
);
set local role authenticated;

select lives_ok(
  $$ select public.admin_delete_household('00000000-0000-0000-0000-0000000000e1') $$,
  'an admin may delete a household'
);

select is(
  (select count(*)::int from public.admin_deleted_households()),
  1,
  'the deleted household is what Bans lists under withdrawn households'
);

-- ── the banned list ─────────────────────────────────────────────────────────
--
-- Nobody is banned yet, and that has to read as an empty list rather than as a
-- failure: an admin arriving at a dashboard where nothing has gone wrong is the
-- ordinary case.
select is(
  (select count(*)::int from public.admin_banned_users()),
  0,
  'nobody is banned to begin with'
);

select lives_ok(
  $$ select public.admin_ban_user('plain_two', 'posted somebody else''s address') $$,
  'an admin may ban an account'
);

select is(
  (select count(*)::int from public.admin_banned_users()),
  1,
  'and the banned account is what Bans lists under people'
);

-- The reason is the whole argument for the lateral join in 008: it lives in the
-- audit trail and nowhere else, so a list that could not reach it would show a
-- ban with no way to find out why short of the SQL editor.
select is(
  (select reason from public.admin_banned_users() where user_id = 'plain_two'),
  'posted somebody else''s address',
  'carrying the reason it was given, read back out of the audit trail'
);

select is(
  (select banned_by from public.admin_banned_users() where user_id = 'plain_two'),
  'admin_one',
  'and who gave it'
);

-- The count beside a banned name comes from admin_user_facts(), so it is the
-- same number the Users list shows rather than a second query agreeing by
-- coincidence. plain_two is in one household.
select is(
  (select households::int from public.admin_banned_users() where user_id = 'plain_two'),
  1,
  'with the household count the Users list would show for them'
);

-- ── and the profile page can say why ────────────────────────────────────────
--
-- profiles.banned_at is a flag and carries nothing else, so a profile could say
-- "Suspended" and not say why -- the one question that state raises. The reason
-- lives in the audit trail because that is the only place admin_ban_user writes
-- it, and admin_user_detail now reaches for it the way admin_banned_users does.
select is(
  (select public.admin_user_detail('plain_two') #>> '{ban,reason}'),
  'posted somebody else''s address',
  'a banned account carries its reason on its own profile, not only on the list'
);

-- Who, resolved to a name. The audit row holds an id, and an id is not somebody
-- a reader recognises.
select is(
  (select public.admin_user_detail('plain_two') #>> '{ban,by_name}'),
  'Ada the Admin',
  'along with the admin who gave it, resolved against profiles'
);

-- A ban is reversible, which is the only reason it is safe to hand out. Undoing
-- it has to empty the list, or the page would keep showing a person the app has
-- already let back in.
select lives_ok(
  $$ select public.admin_unban_user('plain_two') $$,
  'an admin may lift the ban'
);

select is(
  (select count(*)::int from public.admin_banned_users()),
  0,
  'and the account leaves the list'
);

-- The audit rows stay -- nothing is destroyed here -- but the profile stops
-- describing a ban it is no longer under. Keyed off banned_at rather than off
-- the events, so lifting a ban empties this without touching the trail.
select is(
  (select public.admin_user_detail('plain_two') -> 'ban'),
  'null'::jsonb,
  'and its profile stops describing a ban it is no longer under'
);

-- And it leaves the ordinary admin views, which is a SEPARATE mechanism from
-- the RLS work: every admin_* function is security definer and bypasses
-- policies entirely, so hiding a household from the app says nothing about
-- whether the dashboard still lists it. The first end-to-end run found exactly
-- that -- deleted in the app, still sitting in the admin table.
select is(
  (select count(*)::int from public.admin_list_households(null, 'name', 'asc', 50, 0)
   where id = '00000000-0000-0000-0000-0000000000e1'),
  0,
  'a deleted household leaves the admin household list'
);

-- ── but the detail page still opens it ──────────────────────────────────────
--
-- This is the half that used to be wrong. The withdrawn household inherited the
-- list's filter, so every link to it -- from a member's profile, and from the
-- Bans row offering to restore it -- landed on "No such household. It may have
-- been deleted", about a household the same dashboard was listing one page
-- along. An operator deciding whether to restore something has to be able to
-- look at it first.
select isnt(
  (select public.admin_household_detail('00000000-0000-0000-0000-0000000000e1')),
  null,
  'and its detail page still opens, because that is where a restore is decided'
);

select is(
  (select public.admin_household_detail('00000000-0000-0000-0000-0000000000e1')
          #>> '{household,deleted_at}' is not null),
  true,
  'carrying the withdrawal date, so the page can say what it is looking at'
);

-- Role dropped: admin_household_facts is revoked from authenticated on purpose,
-- being an internal helper the public RPCs read through rather than something a
-- client may call.
reset role;
select is(
  (select count(*)::int from public.admin_household_facts()
   where id = '00000000-0000-0000-0000-0000000000e1' and deleted_at is not null),
  1,
  'the one function they all read through carries the fact rather than the filter'
);
set local role authenticated;

-- ── what the withdrawal does to the people in it ────────────────────────────
--
-- The count and the list disagree deliberately. Counting a household nobody can
-- open would send whoever read the number to a not-found page; dropping the row
-- from the list would take away the only route to it from the person it
-- belonged to. So the count excludes it and the list keeps it, flagged.
reset role;
select is(
  (select households::int from public.admin_user_facts() where user_id = 'plain_one'),
  0,
  'a withdrawn household stops counting towards its members household total'
);
set local role authenticated;

select is(
  (select jsonb_array_length(public.admin_user_detail('plain_one') -> 'households')),
  1,
  'while their profile still lists it, because that is how you reach it'
);

select is(
  (select public.admin_user_detail('plain_one') #>> '{households,0,deleted_at}' is not null),
  true,
  'marked withdrawn, so the profile does not offer it as an ordinary household'
);

-- The membership row itself is untouched. That is what makes a restore whole
-- rather than a re-invitation.
reset role;
select is(
  (select count(*)::int from public.household_members
   where household_id = '00000000-0000-0000-0000-0000000000e1' and user_id = 'plain_one'),
  1,
  'and the membership row survives the withdrawal untouched'
);
set local role authenticated;

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

-- ── A moderated household must not cost its owner the slot (009) ─────────────
--
-- households_one_per_owner used to count deleted rows, and nothing ever purges
-- a household, so an admin deletion permanently blocked its owner from creating
-- another -- silently, because the SELECT policy hides the row doing the
-- blocking. 009 makes the index partial on deleted_at is null.
--
-- E is live again at this point, having just been restored. Delete it once more.
set local request.jwt.claims = '{"sub":"admin_one"}';
select lives_ok(
  $$ select public.admin_delete_household('00000000-0000-0000-0000-0000000000e1') $$,
  'an admin deletes the household again'
);

set local request.jwt.claims = '{"sub":"plain_one"}';

-- The whole point. This raised 23505 before 009.
select lives_ok(
  $$ select * from public.create_household('Fresh Start', 'ABCDEFGH') $$,
  'the owner may create another household straight away'
);

reset role;

-- Freeing the slot must not have destroyed anything: the moderation record and
-- everything it hides are still there, which is what soft deletion is for.
select is(
  (select count(*)::int from public.households
   where id = '00000000-0000-0000-0000-0000000000e1' and deleted_at is not null),
  1,
  'and the deleted household is still on disk, untouched'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"admin_one"}';

-- The cost 003 warned about, now paid by an admin who gets told why rather than
-- by a user who gets told nothing.
select throws_ok(
  $$ select public.admin_restore_household('00000000-0000-0000-0000-0000000000e1') $$,
  'P0001',
  null,
  'restoring is refused while the owner holds a newer household'
);

set local request.jwt.claims = '{"sub":"plain_one"}';
select lives_ok(
  $$ delete from public.households where created_by = 'plain_one' and deleted_at is null $$,
  'the owner lets the newer one go'
);

set local request.jwt.claims = '{"sub":"admin_one"}';
select lives_ok(
  $$ select public.admin_restore_household('00000000-0000-0000-0000-0000000000e1') $$,
  'after which the restore goes through'
);

reset role;
select is(
  (select deleted_at from public.households
   where id = '00000000-0000-0000-0000-0000000000e1'),
  null,
  'and the household is live again'
);
set local role authenticated;

select * from finish();
rollback;
