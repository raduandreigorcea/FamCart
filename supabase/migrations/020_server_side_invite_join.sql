-- Make the invite code an actual credential, checked by the database.
--
-- Joining used to be a client-side two-step: resolve the code to a family id
-- via find_family_by_invite_code(), then plainly INSERT a family_members row.
-- The INSERT policy only verified "you are adding yourself as a plain member" —
-- it never saw the code. Anyone who knew a family's uuid (every past member
-- does, forever) could re-insert themselves after being removed, and rotating
-- the invite code changed nothing because no code was checked at join time.
--
-- Now joining goes through join_family_with_code(), which verifies the code in
-- the same statement, and the direct INSERT path is narrowed to the only other
-- legitimate case: a family creator seeding their own membership row right
-- after creating the family. Rotating the invite code after removing someone
-- therefore genuinely locks them out.
--
-- The whole file is idempotent, so it is safe to re-run in the SQL editor.

create or replace function public.join_family_with_code(
  p_code text,
  p_display_name text default null,
  p_image_url text default null
)
returns table (id uuid, name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user text := requesting_user_id();
  v_family record;
begin
  if v_user is null then
    return;
  end if;

  select f.id, f.name into v_family
  from public.families f
  where f.invite_code = p_code;

  if not found then
    return;
  end if;

  -- Clamp the profile fields to what the table constraints allow rather than
  -- failing the join on an overlong name or a non-https avatar URL.
  insert into public.family_members (family_id, user_id, role, display_name, image_url)
  values (
    v_family.id,
    v_user,
    'member',
    coalesce(nullif(left(btrim(p_display_name), 80), ''), 'Member'),
    case
      when p_image_url ~ '^https://' and char_length(p_image_url) <= 2048 then p_image_url
      else null
    end
  )
  on conflict (family_id, user_id) do nothing;  -- already a member: idempotent

  return query select v_family.id, v_family.name;
end;
$$;

-- Function EXECUTE defaults to PUBLIC; scope it to signed-in users.
revoke all on function public.join_family_with_code(text, text, text) from public;
grant execute on function public.join_family_with_code(text, text, text) to authenticated;

-- Narrow direct membership INSERT to creator seeding. Everyone else joins via
-- the RPC above, which is the only path that checks the invite code.
drop policy if exists "users can insert own membership" on public.family_members;
drop policy if exists "family creators can seed own membership" on public.family_members;
create policy "family creators can seed own membership"
  on public.family_members for insert
  with check (
    user_id = requesting_user_id()
    and exists (
      select 1 from public.families f
      where f.id = family_id
        and f.created_by = requesting_user_id()
    )
  );

-- find_family_by_invite_code() stays: it reveals nothing a valid code does not
-- already grant, and the join flow may still want a name preview.
