-- RLS / security-invariant tests for FamCart.
--
-- Run with the Supabase CLI against the local stack (it applies migrations first):
--   supabase test db
--
-- These assert the guarantees the app leans on but can't verify from the client:
--   1. A member of one family cannot read another family's items (no cross-tenant leak).
--   2. The invite-code RPC returns only id + name for an exact code match.
--   3. The per-member active-item cap is enforced by the DB trigger, not just the UI.
--
-- Tests run inside a transaction that is rolled back, so they leave no data behind.

begin;
select plan(3);

-- ── Seed as the migration/superuser role (bypasses RLS) ──────────────────────
insert into public.families (id, name, invite_code, created_by) values
  ('00000000-0000-0000-0000-0000000000a1', 'Family A', 'AAAAAAA2', 'user_a'),
  ('00000000-0000-0000-0000-0000000000b1', 'Family B', 'BBBBBBB2', 'user_b');

insert into public.family_members (family_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'user_a', 'moderator'),
  ('00000000-0000-0000-0000-0000000000b1', 'user_b', 'moderator');

insert into public.shopping_list_items (family_id, name, added_by) values
  ('00000000-0000-0000-0000-0000000000b1', 'family B secret', 'user_b');

-- Cap Family A at one active item so the trigger is easy to trip.
update public.families
set max_items_per_member = 1
where id = '00000000-0000-0000-0000-0000000000a1';

-- ── Act as user_a (authenticated role + JWT sub claim) ───────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"user_a"}';

-- 1. Cross-tenant read is blocked.
select is(
  (select count(*)::int from public.shopping_list_items
   where family_id = '00000000-0000-0000-0000-0000000000b1'),
  0,
  'user_a cannot read Family B items'
);

-- 2. Invite RPC returns only Family B's id + name for its code.
select is(
  (select name from public.find_family_by_invite_code('BBBBBBB2')),
  'Family B',
  'invite RPC resolves an exact code to family name'
);

-- 3. Per-member active-item cap is enforced (limit is 1; second insert must fail).
insert into public.shopping_list_items (family_id, name, added_by)
values ('00000000-0000-0000-0000-0000000000a1', 'first item', 'user_a');

select throws_ok(
  $$ insert into public.shopping_list_items (family_id, name, added_by)
     values ('00000000-0000-0000-0000-0000000000a1', 'second item', 'user_a') $$,
  'P0001',
  'You reached your limit of 1 active items.',
  'DB trigger blocks exceeding the per-member active-item cap'
);

select * from finish();
rollback;
