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

-- Anyone authenticated can look up a family by invite code (needed for joining)
create policy "authenticated users can look up by invite code"
  on public.families for select
  using (requesting_user_id() is not null);

-- Authenticated users can create a family
create policy "authenticated users can create a family"
  on public.families for insert
  with check (created_by = requesting_user_id());

-- ─── RLS policies: family_members ─────────────────────────────────────────────

-- Users can read their own memberships
create policy "users can read own memberships"
  on public.family_members for select
  using (user_id = requesting_user_id());

-- Users can insert their own membership
create policy "users can insert own membership"
  on public.family_members for insert
  with check (user_id = requesting_user_id());
