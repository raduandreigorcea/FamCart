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
--      only by the service role (the seed script) and the catalog RPCs.
--   7. A family's contributed products stay theirs: add_custom_product() scopes
--      them to a family the caller is actually in, other families cannot see
--      them, and they go global only once enough distinct accounts (contributed_by)
--      add the same product.
--   8. A user can own at most one family (migration 001) -- a complementary
--      product rule alongside the contributed_by promotion gate.
--
-- Tests run inside a transaction that is rolled back, so they leave no data behind.

begin;
select plan(33);

-- ── Seed as the migration/superuser role (bypasses RLS) ──────────────────────
-- Three families, because promoting a contributed product to the global catalog
-- takes three distinct ones (migration 022).
insert into public.families (id, name, invite_code, created_by) values
  ('00000000-0000-0000-0000-0000000000a1', 'Family A', 'AAAAAAA2', 'user_a'),
  ('00000000-0000-0000-0000-0000000000b1', 'Family B', 'BBBBBBB2', 'user_b'),
  ('00000000-0000-0000-0000-0000000000c1', 'Family C', 'CCCCCCC2', 'user_c');

insert into public.family_members (family_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'user_a', 'moderator'),
  ('00000000-0000-0000-0000-0000000000b1', 'user_b', 'moderator'),
  ('00000000-0000-0000-0000-0000000000c1', 'user_c', 'moderator');

-- Fixture for 7i: three more families, each owned by a distinct account, plus one
-- "attacker" account that is a member of all three. Promotion counts distinct
-- contributed_by, so this account contributing the same product to all three still
-- counts as one -- under the old distinct-owner count these three owners would have
-- crossed the threshold.
insert into public.families (id, name, invite_code, created_by) values
  ('00000000-0000-0000-0000-0000000000d1', 'Family D', 'DDDDDDD2', 'user_d'),
  ('00000000-0000-0000-0000-0000000000e1', 'Family E', 'EEEEEEE2', 'user_e'),
  ('00000000-0000-0000-0000-0000000000f1', 'Family F', 'FFFFFFF2', 'user_f');

insert into public.family_members (family_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'user_d', 'moderator'),
  ('00000000-0000-0000-0000-0000000000e1', 'user_e', 'moderator'),
  ('00000000-0000-0000-0000-0000000000f1', 'user_f', 'moderator'),
  ('00000000-0000-0000-0000-0000000000d1', 'attacker', 'member'),
  ('00000000-0000-0000-0000-0000000000e1', 'attacker', 'member'),
  ('00000000-0000-0000-0000-0000000000f1', 'attacker', 'member');

-- 8. One family per owner. Asserted here as the superuser, so RLS is out of the
-- way and the unique index (migration 001) is the only thing that can reject the
-- second family -- a complementary product rule alongside the contributed_by
-- promotion gate. user_a already owns Family A above.
select throws_ok(
  $$ insert into public.families (name, invite_code, created_by)
     values ('Family A2', 'AAAAAAA3', 'user_a') $$,
  '23505',
  null,
  'a user can own at most one family'
);

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

-- A client cannot bump popularity by writing the table directly...
select throws_ok(
  $$ update public.product_catalog set add_count = add_count + 100
     where name = 'Apa Plata 2L' $$,
  '42501',
  null,
  'clients cannot update the product catalog directly'
);

-- ...only through the RPC, which counts exactly one add and lifts popularity.
select public.bump_product_popularity('Apa Plata 2L', 'Dorna');

select is(
  (select popularity from public.product_catalog
   where name = 'Apa Plata 2L' and maker = 'Dorna'),
  1,
  'bump_product_popularity increments popularity by one'
);

-- The maker is part of the match: a wrong maker bumps nothing.
select public.bump_product_popularity('Apa Plata 2L', 'Wrong Maker');

select is(
  (select popularity from public.product_catalog
   where name = 'Apa Plata 2L' and maker = 'Dorna'),
  1,
  'bump_product_popularity ignores a product whose maker does not match'
);

-- ── 7. Contributed products are scoped, and go global only on merit ──────────
-- Still acting as user_a, who is now in Family A and (since 5b) Family B.

-- 7a. Contributing creates a row scoped to the family, not a global one.
select public.add_custom_product(
  '00000000-0000-0000-0000-0000000000a1', 'Olive Oil 500ml', 'Bertolli'
);

select is(
  (select count(*)::int from public.product_catalog
   where search_text = 'olive oil 500ml bertolli'
     and family_id = '00000000-0000-0000-0000-0000000000a1'),
  1,
  'add_custom_product contributes a product scoped to the caller''s family'
);

select is(
  (select count(*)::int from public.product_catalog
   where search_text = 'olive oil 500ml bertolli' and family_id is null),
  0,
  'a freshly contributed product is not global'
);

-- 7b. The server derives search_text, so the client cannot forge the value that
-- would become everyone's matching key on promotion. Diacritics are folded.
select public.add_custom_product(
  '00000000-0000-0000-0000-0000000000a1', 'Ulei de Măsline', null
);

select is(
  (select search_text from public.product_catalog
   where family_id = '00000000-0000-0000-0000-0000000000a1'
     and name = 'Ulei de Măsline'),
  'ulei de masline',
  'the server derives search_text and folds diacritics'
);

-- 7c. Re-adding the same product (here in a different case) counts a repeat
-- rather than splitting the family's suggestions across near-duplicate rows.
select public.add_custom_product(
  '00000000-0000-0000-0000-0000000000a1', 'OLIVE OIL 500ML', 'bertolli'
);

select is(
  (select count(*)::int from public.product_catalog
   where search_text = 'olive oil 500ml bertolli'
     and family_id = '00000000-0000-0000-0000-0000000000a1'),
  1,
  'a differently-cased spelling folds into the family''s existing row'
);

select is(
  (select add_count from public.product_catalog
   where search_text = 'olive oil 500ml bertolli'
     and family_id = '00000000-0000-0000-0000-0000000000a1'),
  2,
  'contributing the same product again counts an add instead of duplicating it'
);

-- Push Family A past the per-family cap that promotion applies (7g), so the sum
-- carried global cannot be inflated by one family re-adding a product.
select public.add_custom_product(
  '00000000-0000-0000-0000-0000000000a1', 'Olive Oil 500ml', 'Bertolli'
);
select public.add_custom_product(
  '00000000-0000-0000-0000-0000000000a1', 'Olive Oil 500ml', 'Bertolli'
);

select is(
  (select add_count from public.product_catalog
   where search_text = 'olive oil 500ml bertolli'
     and family_id = '00000000-0000-0000-0000-0000000000a1'),
  4,
  'a family''s own add_count keeps climbing past the cap while scoped'
);

-- 7d. Contributing into a family you are not in. SECURITY DEFINER bypasses RLS,
-- so the membership check inside the RPC is the only thing stopping this;
-- user_c asserts below that it wrote nothing.
select public.add_custom_product(
  '00000000-0000-0000-0000-0000000000c1', 'Smuggled Product', null
);

-- ── Act as user_c (Family C only) ────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"user_c"}';

select is(
  (select count(*)::int from public.product_catalog
   where search_text = 'smuggled product'),
  0,
  'add_custom_product writes nothing for a family the caller is not in'
);

-- 7e. Family A's contribution is invisible to a family that did not make it —
-- the property that makes opening this write path safe.
select is(
  (select count(*)::int from public.product_catalog
   where search_text = 'olive oil 500ml bertolli'),
  0,
  'another family''s contributed product is not visible'
);

-- 7f. Two families wanting a product is not enough to inflict it on everyone.
select public.add_custom_product(
  '00000000-0000-0000-0000-0000000000c1', 'Olive Oil 500ml', 'Bertolli'
);

select is(
  (select count(*)::int from public.product_catalog
   where search_text = 'olive oil 500ml bertolli' and family_id is null),
  0,
  'two families are not enough to promote a product'
);

-- ── Act as user_b (Family B) ─────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"user_b"}';

-- 7g. The third distinct family promotes it to the global catalog.
select public.add_custom_product(
  '00000000-0000-0000-0000-0000000000b1', 'olive oil 500ml', 'BERTOLLI'
);

select is(
  (select count(*)::int from public.product_catalog
   where search_text = 'olive oil 500ml bertolli' and family_id is null),
  1,
  'a third distinct family promotes the product to the global catalog'
);

select is(
  (select count(*)::int from public.product_catalog
   where search_text = 'olive oil 500ml bertolli' and family_id is not null),
  0,
  'promotion collapses the family-scoped rows into the global one'
);

-- The promoted row keeps one of the contributed spellings. Which one is the
-- earliest by created_at, but every add_custom_product call in this suite shares
-- one transaction, so all three scoped rows carry the same now() and the tiebreak
-- falls to a random id -- assert the invariant that actually matters (the winner
-- is a real contributed spelling, case aside), not a coin-flip. In production the
-- calls are separate transactions with distinct timestamps, so the earliest wins.
select is(
  lower((select name from public.product_catalog
         where search_text = 'olive oil 500ml bertolli' and family_id is null)),
  'olive oil 500ml',
  'promotion keeps a contributed spelling'
);

-- The product arrives ranked by the usage it earned rather than at zero, but
-- each family's share is capped at 3: Family A's four adds count as three, plus
-- one each from Families C and B.
select is(
  (select add_count from public.product_catalog
   where search_text = 'olive oil 500ml bertolli' and family_id is null),
  5,
  'the promoted product carries its contributors'' adds, capped per family'
);

-- 7h. Now that it is global, contributing it again just counts against it.
select public.add_custom_product(
  '00000000-0000-0000-0000-0000000000b1', 'Olive Oil 500ml', 'Bertolli'
);

select is(
  (select count(*)::int from public.product_catalog
   where search_text = 'olive oil 500ml bertolli'),
  1,
  'contributing an already-global product does not re-create a scoped row'
);

select is(
  (select add_count from public.product_catalog
   where search_text = 'olive oil 500ml bertolli' and family_id is null),
  6,
  'contributing an already-global product counts an add against it'
);

-- ── 7i. Membership breadth is not contributor count ──────────────────────────
-- The attacker account is a member of Families D, E and F (three distinct
-- owners). Contributing the same product to each creates three scoped rows that
-- all share one contributed_by, so the distinct-contributor count is 1 and it is
-- never promoted -- the self-promotion vector the contributed_by gate closes.
set local request.jwt.claims = '{"sub":"attacker"}';
select public.add_custom_product('00000000-0000-0000-0000-0000000000d1', 'Attacker Junk', null);
select public.add_custom_product('00000000-0000-0000-0000-0000000000e1', 'Attacker Junk', null);
select public.add_custom_product('00000000-0000-0000-0000-0000000000f1', 'Attacker Junk', null);

select is(
  (select count(*)::int from public.product_catalog
   where search_text = 'attacker junk' and family_id is null),
  0,
  'one account in three families cannot self-promote a product'
);

select * from finish();
rollback;
