-- ─── family membership limit ──────────────────────────────────────────────────
-- A user can belong to at most 3 families. Owning is separately capped at 1
-- (families_one_per_owner, migration 001); this caps total membership, so a user
-- can own one family and join up to two more, or join up to three.
--
-- Enforced by a trigger rather than a policy so it holds against every write path
-- (the join RPC, the creator seeding their own row).
--
-- The count is serialized per user with a transaction-scoped advisory lock keyed
-- on the user id: without it, two concurrent joins each read a stale count under
-- READ COMMITTED (neither sees the other's uncommitted row) and both slip past,
-- leaving the user over the cap. The lock makes the second join wait for the
-- first to commit, so it then sees the up-to-date count.
--
-- Idempotent: safe to re-run in the SQL editor.

create or replace function public.enforce_family_membership_limit()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  member_limit constant integer := 3;
begin
  -- An idempotent re-join (join_family_with_code upserts ON CONFLICT DO NOTHING)
  -- is not a new membership, so it must not trip the cap. The BEFORE trigger fires
  -- before the conflict is resolved, so guard on the existing row explicitly.
  if exists (
    select 1 from public.family_members
    where family_id = new.family_id and user_id = new.user_id
  ) then
    return new;
  end if;

  -- Serialize concurrent membership inserts for this user (see header note). The
  -- lock is released automatically at transaction end. hashtextextended keeps the
  -- text user_id inside the bigint key space the advisory-lock API expects.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id, 0));

  if (
    select count(*) from public.family_members where user_id = new.user_id
  ) >= member_limit then
    raise exception 'You can be part of at most % families.', member_limit
      using errcode = 'P0001', detail = 'family_membership_limit_exceeded';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_family_membership_limit on public.family_members;
create trigger trg_enforce_family_membership_limit
before insert on public.family_members
for each row
execute function public.enforce_family_membership_limit();
