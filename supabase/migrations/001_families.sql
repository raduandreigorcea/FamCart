-- Helper: extract Clerk user ID from the JWT "sub" claim
create or replace function requesting_user_id()
returns text
language sql
stable
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
    ''
  )::text;
$$;

-- ─── families ────────────────────────────────────────────────────────────────
create table if not exists public.families (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  invite_code text        not null unique,
  created_by  text        not null,   -- Clerk user ID
  created_at  timestamptz not null default now()
);

alter table public.families enable row level security;

-- ─── family_members ──────────────────────────────────────────────────────────
create table if not exists public.family_members (
  id        uuid        primary key default gen_random_uuid(),
  family_id uuid        not null references public.families(id) on delete cascade,
  user_id   text        not null,   -- Clerk user ID
  role      text        not null default 'member'
              check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  unique (family_id, user_id)
);

alter table public.family_members enable row level security;

-- ─── RLS policies: families ───────────────────────────────────────────────────

-- Members can read their own family
create policy "family members can read their family"
  on public.families for select
  using (
    id in (
      select family_id from public.family_members
      where user_id = requesting_user_id()
    )
  );

-- Creators can read families they own. This covers the create-family
-- INSERT ... RETURNING before the creator's family_members row exists, and is
-- scoped so it never exposes other tenants' rows. Joining by invite code goes
-- through find_family_by_invite_code() (below), not a blanket SELECT policy.
create policy "family owners can read own families"
  on public.families for select
  using (created_by = requesting_user_id());

-- Authenticated users can create a family
create policy "authenticated users can create a family"
  on public.families for insert
  with check (created_by = requesting_user_id());

-- ...but only one. A unique index rather than a policy check, so two concurrent
-- inserts cannot both slip past it. Deleting a family frees the slot, and joining
-- another family (family_members) is unaffected: this caps ownership, not
-- membership. A product rule in its own right, and a complement to the
-- contributed_by promotion gate in the product catalog (migration 022).
create unique index if not exists families_one_per_owner
  on public.families (created_by);

-- ─── RLS policies: family_members ─────────────────────────────────────────────

-- Users can read their own memberships
create policy "users can read own memberships"
  on public.family_members for select
  using (user_id = requesting_user_id());

-- Users can insert their own membership. Role is pinned to 'member' for anyone
-- joining: only the family creator may seed themselves as an elevated role (the
-- create-family flow inserts the creator as a moderator). Without this, a member
-- could leave and re-insert themselves as 'moderator'/'admin' to self-escalate.
create policy "users can insert own membership"
  on public.family_members for insert
  with check (
    user_id = requesting_user_id()
    and (
      role = 'member'
      or exists (
        select 1 from public.families f
        where f.id = family_id
          and f.created_by = requesting_user_id()
      )
    )
  );

-- ─── invite-code lookup ───────────────────────────────────────────────────────
-- Scoped, definer-owned lookup for the join flow: returns only id + name for an
-- exact invite-code match, so authenticated users cannot enumerate families via
-- a blanket SELECT policy.
create or replace function public.find_family_by_invite_code(code text)
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.name
  from public.families f
  where requesting_user_id() is not null
    and f.invite_code = code
  limit 1;
$$;

revoke all on function public.find_family_by_invite_code(text) from public;
grant execute on function public.find_family_by_invite_code(text) to authenticated;
