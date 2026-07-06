-- Add moderator role and allow owner/moderator operational settings.

alter table public.family_members
  drop constraint if exists family_members_role_check;

alter table public.family_members
  add constraint family_members_role_check
  check (role in ('admin', 'moderator', 'member'));

-- Normalize legacy creator role naming.
update public.family_members
set role = 'moderator'
where role = 'admin';

create or replace function public.is_family_owner_or_moderator(target_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.families f
    where f.id = target_family_id
      and (
        f.created_by = requesting_user_id()
        or exists (
          select 1
          from public.family_members fm
          where fm.family_id = target_family_id
            and fm.user_id = requesting_user_id()
            and fm.role in ('admin', 'moderator')
        )
      )
  );
$$;

grant execute on function public.is_family_owner_or_moderator(uuid) to anon, authenticated;

create or replace function public.prevent_family_owner_change()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'Family owner cannot be changed.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace function public.prevent_moderator_family_name_change()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if requesting_user_id() is distinct from old.created_by
     and new.name is distinct from old.name then
    raise exception 'Only the family owner can change the family name.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace function public.prevent_moderator_promotion_to_moderator()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  owner_user_id text;
begin
  select f.created_by
    into owner_user_id
  from public.families f
  where f.id = new.family_id;

  if requesting_user_id() is distinct from owner_user_id
     and new.role is distinct from old.role then
    raise exception 'Only the family owner can change member roles.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_family_owner_change on public.families;

create trigger trg_prevent_family_owner_change
before update on public.families
for each row
execute function public.prevent_family_owner_change();

drop trigger if exists trg_prevent_moderator_family_name_change on public.families;

create trigger trg_prevent_moderator_family_name_change
before update on public.families
for each row
execute function public.prevent_moderator_family_name_change();

drop trigger if exists trg_prevent_moderator_promotion_to_moderator on public.family_members;

create trigger trg_prevent_moderator_promotion_to_moderator
before update on public.family_members
for each row
execute function public.prevent_moderator_promotion_to_moderator();

drop policy if exists "family owner can update family" on public.families;
drop policy if exists "family owner or moderator can update family" on public.families;
create policy "family owner or moderator can update family"
  on public.families for update
  using (public.is_family_owner_or_moderator(id))
  with check (true);

-- Members may always remove themselves; the owner may remove anyone; a moderator
-- may remove only plain members (never the owner, never another moderator).
drop policy if exists "family owner or self can delete memberships" on public.family_members;
drop policy if exists "family owner or moderator or self can delete memberships" on public.family_members;
create policy "family owner or moderator or self can delete memberships"
  on public.family_members for delete
  using (
    user_id = requesting_user_id()
    or exists (
      select 1 from public.families f
      where f.id = family_id
        and f.created_by = requesting_user_id()
    )
    or (
      public.is_family_owner_or_moderator(family_id)
      and role = 'member'
      and user_id is distinct from (
        select f.created_by from public.families f where f.id = family_id
      )
    )
  );

drop policy if exists "family owner or moderator can update memberships" on public.family_members;
create policy "family owner or moderator can update memberships"
  on public.family_members for update
  using (public.is_family_owner_or_moderator(family_id))
  with check (public.is_family_owner_or_moderator(family_id));
