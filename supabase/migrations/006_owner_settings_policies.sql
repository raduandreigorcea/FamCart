-- Helper for membership checks inside RLS policies
create or replace function public.is_member_of_family(target_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.family_members fm
    where fm.family_id = target_family_id
      and fm.user_id = requesting_user_id()
  );
$$;

grant execute on function public.is_member_of_family(uuid) to anon, authenticated;

-- families: owner can update/delete family-level settings
create policy "family owner can update family"
  on public.families for update
  using (created_by = requesting_user_id())
  with check (created_by = requesting_user_id());

create policy "family owner can delete family"
  on public.families for delete
  using (created_by = requesting_user_id());

-- family_members: replace restrictive read policy with family-wide read
-- so all members can see who is in the family (avatars in top nav)
drop policy if exists "users can read own memberships" on public.family_members;
create policy "family members can read family memberships"
  on public.family_members for select
  using (public.is_member_of_family(family_id));

-- family owner can remove members; members can remove themselves
drop policy if exists "family owner or self can delete memberships" on public.family_members;
create policy "family owner or self can delete memberships"
  on public.family_members for delete
  using (
    user_id = requesting_user_id()
    or exists (
      select 1 from public.families f
      where f.id = family_id
        and f.created_by = requesting_user_id()
    )
  );
