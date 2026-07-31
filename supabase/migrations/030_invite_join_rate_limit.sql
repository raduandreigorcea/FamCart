-- Throttle invite-code guessing, and remove the last unthrottled code oracle.
--
-- The code space is 32^8 (~1.1 trillion; alphabet A-HJ-NP-Z2-9), so blind brute
-- force was never the realistic threat. The gap was that nothing *noticed*: a
-- signed-in user could call the join RPC in a tight loop forever, and no record
-- of it existed anywhere. This adds a per-user ceiling on failed attempts and
-- writes every attempt to security_events (migration 029).
--
-- Scope, honestly stated: the limit is per Clerk user, because PostgREST does not
-- hand the database a client IP. Someone willing to mint many Clerk accounts can
-- still spread attempts across them — Clerk's own signup rate limiting is what
-- covers that, and 1.1 trillion codes is what makes the whole exercise pointless.
-- The goal here is a ceiling plus a trail, not an impregnable gate.
--
-- Idempotent: safe to re-run in the SQL editor.

-- ─── drop the enumeration oracle ─────────────────────────────────────────────
-- find_family_by_invite_code() was kept in migration 020 on the reasoning that it
-- "reveals nothing a valid code does not already grant". True for a code you
-- already hold — but for a code you are *guessing* it is a free yes/no test, which
-- is exactly the primitive a brute-forcer wants, and it is cheaper to call than
-- the join RPC. The "name preview" it was kept for never got built, and nothing
-- in src/ has referenced it since 020 moved joining server-side. Removing it means
-- every invite-code check now goes through the throttled, audited path below.
drop function if exists public.find_family_by_invite_code(text);

-- ─── throttled join ──────────────────────────────────────────────────────────
-- Replaces the version from migration 026 (which added the profiles upsert).
-- Behaviour is unchanged for legitimate callers; only the throttle and the audit
-- writes are new.
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
  -- Ten wrong codes in fifteen minutes. A real person mistyping an 8-character
  -- code does not get near this; a script does so immediately.
  max_failures  constant integer  := 10;
  window_length constant interval := interval '15 minutes';
  v_user   text := requesting_user_id();
  v_family record;
  v_recent_failures integer;
begin
  if v_user is null then
    return;
  end if;

  select count(*)::integer into v_recent_failures
  from public.security_events
  where actor = v_user
    and kind = 'invite_code_failed'
    and created_at > now() - window_length;

  if v_recent_failures >= max_failures then
    perform public.log_security_event(
      'invite_rate_limited',
      null,
      jsonb_build_object('failures_in_window', v_recent_failures)
    );
    -- Return empty rather than raising, for two reasons.
    --
    -- 1. Correctness: RAISE would abort the transaction, and the audit row just
    --    written above would roll back with it — the log would be blank at exactly
    --    the moment it mattered. Postgres has no autonomous transactions, so a
    --    clean return is the only way the record survives.
    -- 2. Security: the caller cannot distinguish "throttled" from "wrong code", so
    --    the throttle itself leaks nothing about whether guesses were landing.
    --
    -- The cost is that a user who really did mistype ten times sees "No family
    -- found with that invite code" until the window clears. Rare enough, and a
    -- softer failure than a scary error.
    return;
  end if;

  select f.id, f.name into v_family
  from public.families f
  where f.invite_code = p_code;

  if not found then
    -- The code itself is deliberately not logged: it is a credential, and an
    -- audit table that accumulates near-miss guesses would become a place worth
    -- stealing. The count is what tells the story.
    perform public.log_security_event('invite_code_failed');
    return;
  end if;

  insert into public.profiles (user_id, display_name, image_url, updated_at)
  values (
    v_user,
    coalesce(nullif(left(btrim(p_display_name), 80), ''), 'Member'),
    case when p_image_url ~ '^https://' and char_length(p_image_url) <= 2048 then p_image_url else null end,
    now()
  )
  on conflict (user_id) do update
    set display_name = excluded.display_name,
        image_url = excluded.image_url,
        updated_at = now();

  insert into public.family_members (family_id, user_id, role)
  values (v_family.id, v_user, 'member')
  on conflict (family_id, user_id) do nothing;  -- already a member: idempotent

  perform public.log_security_event('invite_join_succeeded', v_family.id);

  return query select v_family.id, v_family.name;
end;
$$;

revoke all on function public.join_family_with_code(text, text, text) from public;
grant execute on function public.join_family_with_code(text, text, text) to authenticated;
