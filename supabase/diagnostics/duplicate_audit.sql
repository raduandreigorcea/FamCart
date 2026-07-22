-- ─────────────────────────────────────────────────────────────────────────────
-- Duplicate / stray-row audit for FamCart.
--
-- Every statement here is a read-only SELECT: safe to run against production,
-- nothing is written or deleted. Paste a section into the Supabase SQL editor
-- (or run the whole file) and read the result.
--
-- Convention: for most checks, EMPTY RESULT = CLEAN. Checks marked "[info]"
-- can legitimately return rows — they surface state to eyeball, not a defect.
--
-- Section A runs against the schema as it is today. Section B additionally needs
-- migration 026 (the profiles table) applied; it will error on "relation
-- profiles does not exist" until then.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══ SECTION A — works on the current schema ═════════════════════════════════

-- A1. product_catalog: two contributed rows for the same family that normalize
-- to the same key (would read as two identical suggestions to that family).
-- Guarded by the unique index product_catalog_family_search — expect EMPTY.
select family_id, search_text, count(*) as copies, array_agg(id) as ids
from public.product_catalog
where family_id is not null
group by family_id, search_text
having count(*) > 1
order by copies desc;

-- A2. product_catalog: two GLOBAL rows that normalize to the same key (everyone
-- sees the duplicate). Guarded by product_catalog_global_search — expect EMPTY.
select search_text, count(*) as copies, array_agg(id) as ids
from public.product_catalog
where family_id is null
group by search_text
having count(*) > 1
order by copies desc;

-- A3. product_catalog: a family-scoped row whose product already exists globally.
-- Promotion is supposed to collapse the scoped rows into the global; any rows
-- here mean a family sees the same product twice (their scoped one + the global).
-- A real de-dup candidate if it returns anything.
select s.id as scoped_id, s.family_id, s.name, s.maker, s.search_text, s.add_count
from public.product_catalog s
join public.product_catalog g
  on g.family_id is null and g.search_text = s.search_text
where s.family_id is not null
order by s.search_text;

-- A4. shopping_list_items: duplicate ACTIVE rows for the same product in a family
-- (same trimmed/lowercased name + maker, unchecked). Guarded by
-- shopping_list_items_unique_active_name — expect EMPTY.
select
  family_id,
  lower(btrim(name)) as name_key,
  lower(btrim(coalesce(maker, ''))) as maker_key,
  count(*) as copies,
  array_agg(id) as ids
from public.shopping_list_items
where checked = false
group by family_id, lower(btrim(name)), lower(btrim(coalesce(maker, '')))
having count(*) > 1
order by copies desc;

-- A5. family_members: the same user listed twice in one family.
-- Guarded by the unique(family_id, user_id) constraint — expect EMPTY.
select family_id, user_id, count(*) as copies
from public.family_members
group by family_id, user_id
having count(*) > 1;

-- A6. families: two families sharing an invite code.
-- Guarded by the unique invite_code constraint — expect EMPTY.
select invite_code, count(*) as copies, array_agg(id) as ids
from public.families
group by invite_code
having count(*) > 1;

-- A7. families: more than one owned by the same account.
-- Guarded by families_one_per_owner — expect EMPTY.
select created_by, count(*) as families_owned, array_agg(id) as ids
from public.families
group by created_by
having count(*) > 1;

-- A8. Users over the 3-family membership cap.
-- Guarded by the enforce_family_membership_limit trigger — expect EMPTY.
select user_id, count(*) as family_count
from public.family_members
group by user_id
having count(*) > 3
order by family_count desc;

-- A9. [info] Families with no members at all (an orphan the create flow normally
-- cleans up). Not a duplicate, but a stray row worth knowing about.
select f.id, f.name, f.created_by, f.created_at
from public.families f
where not exists (
  select 1 from public.family_members fm where fm.family_id = f.id
)
order by f.created_at;

-- A10. [info] How much the profile de-dup is worth: users who belong to more than
-- one family. Before migration 026 each of these stored their name+avatar once
-- PER row below; after 026 it is stored once. The sum of (copies - 1) is roughly
-- how many redundant profile copies 026 removes.
select user_id, count(*) as copies_across_families
from public.family_members
group by user_id
having count(*) > 1
order by copies_across_families desc;


-- ═══ SECTION B — requires migration 026 (profiles) applied ═══════════════════

-- B1. family_members whose user has NO profile row. After 026 this must be EMPTY
-- (the FK family_members_user_id_profiles_fkey enforces it); running it is a
-- quick confirmation the backfill covered everyone.
select fm.user_id, count(*) as memberships
from public.family_members fm
left join public.profiles p on p.user_id = fm.user_id
where p.user_id is null
group by fm.user_id;

-- B2. [info] Orphan profiles: a profile row for someone who is in no family right
-- now. Harmless (e.g. someone who left, or an old list-item author the backfill
-- captured), but this is where you'd prune if you ever want to.
select p.user_id, p.display_name, p.updated_at
from public.profiles p
where not exists (
  select 1 from public.family_members fm where fm.user_id = p.user_id
)
order by p.updated_at;

-- B3. [info] Active list items whose author is no longer a member of that family.
-- After 026 their row avatar falls back to an initial (the roster can't resolve
-- them). Not a duplicate — shows where a "?" avatar will appear.
select s.family_id, s.added_by, count(*) as items
from public.shopping_list_items s
where not exists (
  select 1 from public.family_members fm
  where fm.family_id = s.family_id and fm.user_id = s.added_by
)
group by s.family_id, s.added_by
order by items desc;
