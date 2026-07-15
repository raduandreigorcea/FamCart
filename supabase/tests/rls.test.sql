-- RLS / security-invariant tests for FamCart.
--
-- Run with the Supabase CLI against the local stack (it applies migrations first):
--   supabase test db
--
-- These assert the guarantees the app leans on but can't verify from the client:
--   1. A member of one family cannot read another family's items (no cross-tenant leak).
--   2. The invite-code RPC returns only id + name for an exact code match.
--   3. The per-member active-item cap is enforced by the DB trigger, not just the UI.
--   4. Purchase history is written only by buy_items(): the RPC is scoped to
--      the caller's families, and direct inserts (forged names/timestamps) are
--      rejected outright.
--   5. The invite code is checked by the database at join time: a direct
--      membership insert fails even with a known family uuid (the removed-
--      member-rejoin vector), and join_family_with_code() is the only way in.
--   6. The product catalog is readable by any signed-in user but writable
--      only by the service role (the seed script).
--
-- Tests run inside a transaction that is rolled back, so they leave no data behind.

begin;
select plan(13);

-- ── Seed as the migration/superuser role (bypasses RLS) ──────────────────────
insert into public.families (id, name, invite_code, created_by) values
  ('00000000-0000-0000-0000-0000000000a1', 'Family A', 'AAAAAAA2', 'user_a'),
  ('00000000-0000-0000-0000-0000000000b1', 'Family B', 'BBBBBBB2', 'user_b');

insert into public.family_members (family_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'user_a', 'moderator'),
  ('00000000-0000-0000-0000-0000000000b1', 'user_b', 'moderator');

-- Checked, so only the membership check in buy_items() can protect it.
insert into public.shopping_list_items (id, family_id, name, added_by, checked) values
  ('00000000-0000-0000-0000-0000000000b2',
   '00000000-0000-0000-0000-0000000000b1', 'family B secret', 'user_b', true);

-- Cap Family A at one active item so the trigger is easy to trip.
update public.families
set max_items_per_member = 1
where id = '00000000-0000-0000-0000-0000000000a1';

-- One catalog row, seeded the way scripts/seed-products.mjs would.
insert into public.product_catalog (name, maker, search_text)
values ('Apa Plata 2L', 'Dorna', 'apa plata 2l dorna');

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

-- ── 4. Purchase history is written only through buy_items ────────────────────

-- 4a. buy_items is scoped to the caller's families, even for checked items
-- named by id (buy_items is SECURITY DEFINER, so this guard is all there is).
select is(
  public.buy_items(array['00000000-0000-0000-0000-0000000000b2']::uuid[]),
  0,
  'buy_items ignores items in families the caller is not a member of'
);

-- 4b. Buying own checked item archives it...
update public.shopping_list_items
set checked = true
where family_id = '00000000-0000-0000-0000-0000000000a1' and added_by = 'user_a';

select is(
  public.buy_items(array(
    select id from public.shopping_list_items
    where family_id = '00000000-0000-0000-0000-0000000000a1' and added_by = 'user_a'
  )),
  1,
  'buy_items archives the caller''s checked item'
);

-- 4c. ...into history, server-stamped with a checkout id.
select is(
  (select count(*)::int from public.purchase_history
   where family_id = '00000000-0000-0000-0000-0000000000a1'
     and purchased_by = 'user_a'
     and checkout_id is not null),
  1,
  'the purchase landed in history with a checkout id'
);

-- 4d. Direct inserts (forged author fields / future timestamps) are rejected.
select throws_ok(
  $$ insert into public.purchase_history (checkout_id, family_id, name, purchased_by)
     values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a1', 'forged', 'user_a') $$,
  '42501',
  null,
  'clients cannot insert purchase history directly'
);

-- ── 5. The invite code is a real credential at join time ─────────────────────

-- 5a. Knowing a family uuid is not enough to (re)join it: the direct insert a
-- removed member could replay is blocked by RLS.
select throws_ok(
  $$ insert into public.family_members (family_id, user_id, role)
     values ('00000000-0000-0000-0000-0000000000b1', 'user_a', 'member') $$,
  '42501',
  null,
  'direct membership insert without being the family creator is rejected'
);

-- 5b. The join RPC admits a valid code...
select is(
  (select name from public.join_family_with_code('BBBBBBB2', 'User A', null)),
  'Family B',
  'join RPC resolves a valid invite code and returns the family'
);

select is(
  (select count(*)::int from public.family_members
   where family_id = '00000000-0000-0000-0000-0000000000b1' and user_id = 'user_a'),
  1,
  'join RPC created the membership row'
);

-- 5c. ...and an unknown code joins nothing.
select is(
  (select count(*)::int from public.join_family_with_code('ZZZZZZZ2', 'User A', null)),
  0,
  'join RPC returns nothing for an unknown code'
);

-- ── 6. The product catalog is read-only for clients ──────────────────────────

select is(
  (select count(*)::int from public.product_catalog
   where name = 'Apa Plata 2L' and maker = 'Dorna'),
  1,
  'signed-in users can read the product catalog'
);

select throws_ok(
  $$ insert into public.product_catalog (name, maker, search_text)
     values ('forged product', 'nobody', 'forged product nobody') $$,
  '42501',
  null,
  'clients cannot insert into the product catalog'
);

select * from finish();
rollback;
