-- A moderator removing a list must not cost its owner the ability to have
-- one at all.
--
-- WHAT WAS WRONG
--
-- lists_one_per_owner (003) was a unique index on created_by with no
-- predicate, so it counted soft-deleted rows. admin_delete_list only sets
-- deleted_at, and nothing in this schema ever purges a list -- there is no
-- retention job for them, unlike the 30-day checkout purge in 005. So the row
-- stayed forever and kept its owner's one ownership slot forever with it.
--
-- The owner could not even see what was blocking them: the lists SELECT
-- policy ends in `and deleted_at is null`, correctly, so the row holding the
-- slot is invisible to the only person it affects. What they got instead was
-- create_list failing with "You can only own one list. Leave or
-- delete your current one before creating another" -- about a list they
-- could not see, telling them to do the thing that had already happened.
--
-- 003's create_list header calls that exact sentence the worst outcome of
-- an older orphan bug. Soft deletion reintroduced it through a different door.
--
-- The effect was a permanent, silent ban on creating a list, applied to
-- someone whose list was moderated rather than to someone who was. Those
-- are different judgements and only one of them was made: banning an ACCOUNT is
-- what profiles.banned_at is for, and create_list checks it separately and
-- says so out loud.
--
-- WHAT CHANGES
--
-- The slot now counts live lists. A moderated list stops occupying it
-- the moment it is deleted, and the owner may create another immediately.
--
-- ANSWERING 003'S OBJECTION
--
-- 003 rejected a partial index on the grounds that it would let the owner
-- create a replacement, so a later restore would violate the index and fail --
-- "a restore that can be blocked by something the user did in the meantime is
-- not a restore."
--
-- That is a real cost and it is accepted here, because the two failures are not
-- comparable. Unconditional restore was bought by making the owner permanently
-- unable to create a list, with no explanation and no way out. The price
-- now falls on an admin, who gets a named error explaining exactly why, on the
-- rare occasion they restore a list whose owner has since moved on -- and
-- who has other options at that point. It no longer falls silently on the user.
--
-- admin_restore_list is rewritten below to raise that named error rather
-- than let a raw 23505 surface, because "duplicate key value violates unique
-- constraint" is not something a dashboard can act on.

-- ─── the slot counts live lists ─────────────────────────────────────────
-- Dropped and recreated rather than edited in 003. 003 is a restatement already
-- recorded as applied, so a change inside it never reaches an existing database
-- (see CLAUDE.md); and its `create unique index if not exists` would skip on a
-- fresh one anyway once this file has run, since the name already exists. An
-- explicit drop is the only form that lands in both places.
drop index if exists public.lists_one_per_owner;

create unique index if not exists lists_one_per_owner
  on public.lists (created_by)
  where deleted_at is null;

comment on index public.lists_one_per_owner is
  'One LIVE list owned per account. Partial on deleted_at is null so a '
  'moderated list stops occupying its owner''s slot: being moderated is '
  'not the same as being banned, and profiles.banned_at is what bans an '
  'account. See 009 for why this overrides the reasoning in 003.';

-- ─── restore, when the slot has been taken since ─────────────────────────────
-- Same body as 008's, plus one check ahead of the update.
--
-- The check is a plain select rather than a catch of 23505: the constraint
-- would fire anyway, but only after the audit decision has been made, and the
-- error it raises names an index rather than a situation. This says what
-- happened in terms the dashboard can put on screen.
--
-- Deliberately NOT resolved by deleting the owner's newer list, or by
-- restoring in some detached state. Both would have this function destroy or
-- corrupt something to complete an undo, which is worse than declining and
-- saying why.
create or replace function public.admin_restore_list(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner text;
begin
  perform public.admin_guard();

  select created_by into v_owner
  from public.lists
  where id = p_id and deleted_at is not null;

  -- Idempotent, matching the original: already live, or no such list.
  if not found then
    return;
  end if;

  if exists (
    select 1 from public.lists
    where created_by = v_owner and deleted_at is null
  ) then
    raise exception
      'This list''s owner has created another one since it was deleted. Restoring it would give them two.'
      using errcode = 'P0001', detail = 'owner_slot_taken';
  end if;

  update public.lists
  set deleted_at = null
  where id = p_id and deleted_at is not null;

  perform public.log_security_event(
    'admin_list_restored',
    p_id,
    jsonb_build_object('actor', requesting_user_id())
  );
end;
$$;
