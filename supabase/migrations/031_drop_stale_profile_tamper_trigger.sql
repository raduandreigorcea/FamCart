-- Drop prevent_member_profile_tamper: it has been broken since migration 026.
--
-- The trigger guarded family_members.display_name / image_url against a member
-- editing someone else's copy. Migration 026 moved both columns to profiles and
-- dropped them from family_members, but left this trigger in place. PL/pgSQL
-- resolves record fields at execution time, so it did not fail at migration —
-- it failed on the next UPDATE of any family_members row:
--
--   ERROR: record "new" has no field "display_name"
--
-- Which is every promote/demote in the app. Role management (migration 011) has
-- been dead in production since 026 shipped, and the error surfaced raw to the
-- user because it arrives as an ordinary Postgres message.
--
-- No replacement is needed. The columns it protected now live in profiles, whose
-- own RLS policy ("update own profile", migration 026) restricts updates to
-- user_id = requesting_user_id() — the same guarantee, enforced one layer down
-- and without a trigger that can drift out of sync with the schema again.
--
-- The other family_members triggers are unaffected: prevent_moderator_promotion_
-- to_moderator (role changes are owner-only) and enforce_family_membership_limit
-- both reference only columns that still exist.

drop trigger if exists trg_prevent_member_profile_tamper on public.family_members;
drop function if exists public.prevent_member_profile_tamper();
