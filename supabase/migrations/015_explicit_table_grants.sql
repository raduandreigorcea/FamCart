-- Explicit table grants for the client-facing role.
--
-- Hosted Supabase grants table privileges to the API roles at project
-- provisioning, so the app worked without these. A database built from
-- migrations alone (supabase test db / db reset) has no such grants, and
-- every RLS policy subquery fails with "permission denied" before row-level
-- evaluation starts. Grants control table access; RLS remains the authority
-- on which rows are visible and writable.

grant usage on schema public to authenticated;

grant select, insert, update, delete
  on public.families, public.family_members, public.shopping_list_items
  to authenticated;
