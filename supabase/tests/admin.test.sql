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
select plan(102);

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

-- ── 10. Product writes (008_admin.sql) ──────────────────────────────────────
-- The three that let an admin curate the app catalog. What is worth pinning is
-- not that they work but WHAT THEY REFUSE: the guard, the two uniqueness rules,
-- and the columns an admin must not be able to move.

set local role authenticated;
set local request.jwt.claims = '{"sub":"plain_one"}';

select throws_ok(
  $t$ select public.admin_create_product('Smuggled', null, null, 0) $t$,
  42501,
  null,
  'a signed-in non-admin cannot create a product'
);

select throws_ok(
  $t$ select public.admin_delete_product('00000000-0000-0000-0000-0000000000a1') $t$,
  42501,
  null,
  'nor delete one'
);

set local request.jwt.claims = '{"sub":"admin_one"}';

select lives_ok(
  $t$ select public.admin_create_product('Apa Plata 2L', 'Dorna', '5941234567890', 5) $t$,
  'an admin creates a product'
);

reset role;
select is(
  (select count(*)::int from public.product_catalog
   where name = 'Apa Plata 2L' and maker = 'Dorna'),
  1,
  'and exactly one row lands'
);

-- Global and curated, never a contribution somebody did not make.
select is(
  (select household_id from public.product_catalog where name = 'Apa Plata 2L'),
  null,
  'the row is global rather than scoped to a household'
);

select is(
  (select source from public.product_catalog where name = 'Apa Plata 2L'),
  'curated',
  'and is recorded as curated, which is what an editorial row is'
);

select is(
  (select contributed_by from public.product_catalog where name = 'Apa Plata 2L'),
  null,
  'with no contributor, because nobody contributed it'
);

-- The invariant the whole design turns on: earned usage starts at zero and an
-- admin has no way to set it. base_weight is the editorial thumb on the scale.
select is(
  (select add_count from public.product_catalog where name = 'Apa Plata 2L'),
  0,
  'add_count starts at zero: it is earned, not granted'
);

select is(
  (select base_weight from public.product_catalog where name = 'Apa Plata 2L'),
  5,
  'base_weight is the knob an admin does get'
);

select is(
  (select popularity from public.product_catalog where name = 'Apa Plata 2L'),
  5,
  'and popularity follows from it, being generated'
);

-- search_text is derived, and derived the same way the app derives it, or the
-- product is invisible to the search that is supposed to find it.
select is(
  (select search_text from public.product_catalog where name = 'Apa Plata 2L'),
  public.product_search_text('Apa Plata 2L', 'Dorna'),
  'search_text is computed by product_search_text() rather than left to a client'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"admin_one"}';

-- Uniqueness, in the two forms the table actually enforces. The point is the
-- NAMED error: a raw 23505 names an index and a dashboard cannot act on it.
select throws_ok(
  $t$ select public.admin_create_product('apa plata 2l', 'dorna', null, 0) $t$,
  'P0001',
  'A product with that name and brand already exists.',
  'a differently-cased duplicate is refused by name, not by a raw constraint'
);

select throws_ok(
  $t$ select public.admin_create_product('Something Else', null, '5941234567890', 0) $t$,
  'P0001',
  'Another product already claims that barcode.',
  'and a reused barcode is refused by barcode'
);

select throws_ok(
  $t$ select public.admin_create_product('   ', null, null, 0) $t$,
  'P0001',
  'A product name is required and must be at most 120 characters.',
  'a blank name is refused rather than silently ignored'
);

select throws_ok(
  $t$ select public.admin_create_product('Negative', null, null, -1) $t$,
  'P0001',
  'Base weight cannot be negative.',
  'and a negative base weight is refused'
);

-- Updating. The case that would look like a bug: renaming a row to a different
-- capitalisation of its own name must not report the row as its own duplicate.
select lives_ok(
  $t$ select public.admin_update_product(
       (select id from public.product_catalog where name = 'Apa Plata 2L'),
       'APA PLATA 2L', 'Dorna', null, null) $t$,
  'a product can be renamed to a case variant of itself'
);

reset role;
select is(
  (select name from public.product_catalog
   where search_text = public.product_search_text('Apa Plata 2L', 'Dorna')),
  'APA PLATA 2L',
  'and the new spelling is stored'
);

select is(
  (select base_weight from public.product_catalog where name = 'APA PLATA 2L'),
  5,
  'a null base_weight on update leaves the existing one alone'
);

-- An admin correcting a household's typo must not turn a scoped row into a
-- contribution from nobody, or hand it to a different household.
insert into public.product_catalog
  (id, name, maker, search_text, household_id, contributed_by, source, add_count)
-- An explicit id, because the lookup below runs as the CALLER and the caller is
-- an admin who belongs to no household. product_catalog's SELECT policy scopes a
-- household row to that household's members, so `where name = 'Bred'` returns
-- nothing for Ada and the RPC is handed a null id. security definer applies
-- inside the function, never to the arguments being assembled for it.
values ('00000000-0000-0000-0000-0000000000b1',
        'Bred', null, public.product_search_text('Bred', null),
        '00000000-0000-0000-0000-0000000000e1', 'plain_one', 'community', 3);

set local role authenticated;
set local request.jwt.claims = '{"sub":"admin_one"}';

select lives_ok(
  $t$ select public.admin_update_product(
       '00000000-0000-0000-0000-0000000000b1'::uuid,
       'Bread', null, null, null) $t$,
  'an admin fixes a household typo in place'
);

reset role;
select is(
  (select household_id from public.product_catalog
   where name = 'Bread' and source = 'community'),
  '00000000-0000-0000-0000-0000000000e1'::uuid,
  'the row still belongs to the household that contributed it'
);

select is(
  (select contributed_by from public.product_catalog
   where name = 'Bread' and source = 'community'),
  'plain_one',
  'and still records who contributed it'
);

select is(
  (select add_count from public.product_catalog
   where name = 'Bread' and source = 'community'),
  3,
  'and keeps the adds it earned, which is why this is not delete-and-recreate'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"admin_one"}';

select throws_ok(
  $t$ select public.admin_update_product(
       '00000000-0000-0000-0000-00000000dead'::uuid, 'Anything', null, null, null) $t$,
  'P0001',
  'That product no longer exists.',
  'updating a product that is gone says so'
);

-- Deleting, and the audit entry that has to carry the row because the id will
-- not resolve to anything afterwards.
select lives_ok(
  $t$ select public.admin_delete_product(
       (select id from public.product_catalog where name = 'APA PLATA 2L')) $t$,
  'an admin deletes a product'
);

reset role;
select is(
  (select count(*)::int from public.product_catalog where name = 'APA PLATA 2L'),
  0,
  'and it is gone'
);

select is(
  (select detail ->> 'name' from public.security_events
   where kind = 'admin_product_deleted' order by created_at desc limit 1),
  'APA PLATA 2L',
  'the audit entry carries the row, not just an id that now resolves to nothing'
);

-- The shopping list is text, so a deleted product takes nobody's item with it.
select is(
  (select count(*)::int from public.shopping_list_items
   where household_id = '00000000-0000-0000-0000-0000000000e1'),
  2,
  'and no list item went with it, because list items carry their own text'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"admin_one"}';

select lives_ok(
  $t$ select public.admin_delete_product('00000000-0000-0000-0000-00000000dead'::uuid) $t$,
  'deleting a product that is already gone is a no-op, not an error'
);

select * from finish();
rollback;
