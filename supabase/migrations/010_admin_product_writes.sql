-- Letting an admin add, correct and remove a product.
--
-- WHY THIS IS A NEW FILE RATHER THAN MORE OF 008
--
-- 008 is a restatement already recorded as applied on both projects, so anything
-- added inside it reaches an existing database only after a
-- `migration repair --status reverted 008` and a `--include-all` push. That dance
-- is documented and it works, but it is a re-run of the entire admin surface to
-- ship three new functions. These are additions, `create or replace` is
-- re-runnable on its own, and a new file applies everywhere with a plain push.
-- 009 set the same precedent against 003.
--
-- WHY THERE ARE RPCs HERE AT ALL
--
-- product_catalog has exactly one RLS policy and it is a SELECT. There is no
-- insert, update or delete policy, deliberately: every write in 006 goes through
-- a `security definer` function that owns a rule -- add_custom_product() counts a
-- household's contributions against a ceiling, promote_product_from_scoped()
-- waits for three distinct accounts in three distinct households. A dashboard
-- cannot write this table directly and should not be able to.
--
-- It also could not compute what it would need to write. search_text is derived
-- by product_search_text(), whose EXECUTE is revoked from `authenticated` on
-- purpose (006 line 261): a client that can compute the merge key can craft a
-- name that collides with an existing product. So the derivation has to happen
-- on this side of the boundary regardless.
--
-- WHAT AN ADMIN MAY NOT DO, AND WHY
--
-- add_count is never writable here. It is earned usage -- the count of real adds
-- by real households -- and it is half of the generated `popularity` column. An
-- admin who could set it could manufacture the appearance of demand, and the
-- promotion gate in 006 reads the same signal. base_weight is the editorial
-- thumb on the scale and is the correct knob; it is what the seed uses and what
-- these functions expose.
--
-- Nor may an admin create a household-scoped row. Scoped rows record that a
-- specific household asked for something, and one invented from this dashboard
-- would be a contribution nobody made, counting toward a promotion nobody
-- requested. Admin-created rows are global and curated, which is what they are.
--
-- DELETING IS SAFE, WHICH IS WORTH STATING
--
-- Nothing in this schema has a foreign key to product_catalog, and
-- shopping_list_items store `name` and `maker` as plain text (004). Removing a
-- product therefore removes a SUGGESTION and never touches anybody's list. That
-- is why this is an ordinary delete rather than another soft-delete column.

-- ─── create ──────────────────────────────────────────────────────────────────
-- Global and curated. Returns the new id so the dashboard can select the row it
-- just made rather than re-searching for it.
create or replace function public.admin_create_product(
  p_name        text,
  p_maker       text default null,
  p_barcode     text default null,
  p_base_weight integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name    text := btrim(coalesce(p_name, ''));
  v_maker   text := nullif(btrim(coalesce(p_maker, '')), '');
  v_barcode text := nullif(btrim(coalesce(p_barcode, '')), '');
  v_search  text;
  v_id      uuid;
begin
  perform public.admin_guard();

  -- Raised rather than returned as null. add_custom_product() returns quietly on
  -- bad input because it runs behind a keyboard and a silent no-op is kinder
  -- than an error mid-typing; this runs behind a form that can show a message,
  -- and a create that silently does nothing is the worst of both.
  if v_name = '' or char_length(v_name) > 120 then
    raise exception 'A product name is required and must be at most 120 characters.'
      using errcode = 'P0001', detail = 'bad_name';
  end if;

  if v_maker is not null and char_length(v_maker) > 60 then
    raise exception 'A brand must be at most 60 characters.'
      using errcode = 'P0001', detail = 'bad_maker';
  end if;

  if coalesce(p_base_weight, 0) < 0 then
    raise exception 'Base weight cannot be negative.'
      using errcode = 'P0001', detail = 'bad_base_weight';
  end if;

  v_search := public.product_search_text(v_name, v_maker);
  if v_search = '' or char_length(v_search) > 200 then
    raise exception 'That name and brand do not reduce to a usable search key.'
      using errcode = 'P0001', detail = 'bad_search_text';
  end if;

  -- The same lock add_custom_product() takes, for the same reason: a concurrent
  -- promotion can insert a global row for this key between the check below and
  -- the insert.
  perform pg_advisory_xact_lock(hashtext(v_search));

  -- Checked rather than caught as a 23505, because the constraint names an index
  -- and this names the situation. Two different collisions are possible and they
  -- need different sentences.
  if exists (
    select 1 from public.product_catalog
    where household_id is null and search_text = v_search
  ) then
    raise exception 'A product with that name and brand already exists.'
      using errcode = 'P0001', detail = 'duplicate_name';
  end if;

  if v_barcode is not null and exists (
    select 1 from public.product_catalog
    where household_id is null and barcode = v_barcode
  ) then
    raise exception 'Another product already claims that barcode.'
      using errcode = 'P0001', detail = 'duplicate_barcode';
  end if;

  insert into public.product_catalog
    (name, maker, search_text, household_id, contributed_by,
     base_weight, add_count, source, barcode)
  values
    (v_name, v_maker, v_search, null, null,
     greatest(coalesce(p_base_weight, 0), 0), 0, 'curated', v_barcode)
  returning id into v_id;

  perform public.log_security_event(
    'admin_product_created',
    null,
    jsonb_build_object(
      'actor', requesting_user_id(),
      'product', v_id,
      'name', v_name,
      'maker', v_maker
    )
  );

  return v_id;
end;
$$;

comment on function public.admin_create_product(text, text, text, integer) is
  'Add a global curated product. Admin only. add_count is not writable: it is '
  'earned usage and half of the generated popularity column.';

revoke all on function public.admin_create_product(text, text, text, integer)
  from public, anon;
grant execute on function public.admin_create_product(text, text, text, integer)
  to authenticated;

-- ─── update ──────────────────────────────────────────────────────────────────
-- Any row, scoped or global. Correcting a household's typo is a real job and
-- refusing it would send an admin to delete-and-recreate, which loses the row's
-- earned add_count and its contributed_by.
create or replace function public.admin_update_product(
  p_id          uuid,
  p_name        text,
  p_maker       text default null,
  p_barcode     text default null,
  p_base_weight integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name     text := btrim(coalesce(p_name, ''));
  v_maker    text := nullif(btrim(coalesce(p_maker, '')), '');
  v_barcode  text := nullif(btrim(coalesce(p_barcode, '')), '');
  v_search   text;
  v_row      public.product_catalog%rowtype;
begin
  perform public.admin_guard();

  select * into v_row from public.product_catalog where id = p_id;
  if not found then
    raise exception 'That product no longer exists.'
      using errcode = 'P0001', detail = 'not_found';
  end if;

  if v_name = '' or char_length(v_name) > 120 then
    raise exception 'A product name is required and must be at most 120 characters.'
      using errcode = 'P0001', detail = 'bad_name';
  end if;

  if v_maker is not null and char_length(v_maker) > 60 then
    raise exception 'A brand must be at most 60 characters.'
      using errcode = 'P0001', detail = 'bad_maker';
  end if;

  if coalesce(p_base_weight, v_row.base_weight) < 0 then
    raise exception 'Base weight cannot be negative.'
      using errcode = 'P0001', detail = 'bad_base_weight';
  end if;

  v_search := public.product_search_text(v_name, v_maker);
  if v_search = '' or char_length(v_search) > 200 then
    raise exception 'That name and brand do not reduce to a usable search key.'
      using errcode = 'P0001', detail = 'bad_search_text';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_search));

  -- Collision checks exclude this row, or renaming a product to a different
  -- capitalisation of its own name would report itself as a duplicate. The
  -- scoped and global keys are two different unique indexes, so which one to
  -- check follows the row being edited.
  if v_row.household_id is null then
    if exists (
      select 1 from public.product_catalog
      where household_id is null and search_text = v_search and id <> p_id
    ) then
      raise exception 'Another product already has that name and brand.'
        using errcode = 'P0001', detail = 'duplicate_name';
    end if;

    if v_barcode is not null and exists (
      select 1 from public.product_catalog
      where household_id is null and barcode = v_barcode and id <> p_id
    ) then
      raise exception 'Another product already claims that barcode.'
        using errcode = 'P0001', detail = 'duplicate_barcode';
    end if;
  else
    if exists (
      select 1 from public.product_catalog
      where household_id = v_row.household_id and search_text = v_search and id <> p_id
    ) then
      raise exception 'That household already has a product with that name and brand.'
        using errcode = 'P0001', detail = 'duplicate_name';
    end if;
  end if;

  -- add_count, contributed_by, household_id and source are all left alone. The
  -- first is earned, the second and third are a record of who asked for this and
  -- cannot be edited into being true, and the fourth is a licensing fact.
  update public.product_catalog
  set name        = v_name,
      maker       = v_maker,
      search_text = v_search,
      barcode     = v_barcode,
      base_weight = greatest(coalesce(p_base_weight, base_weight), 0)
  where id = p_id;

  perform public.log_security_event(
    'admin_product_updated',
    v_row.household_id,
    jsonb_build_object(
      'actor', requesting_user_id(),
      'product', p_id,
      'from', jsonb_build_object('name', v_row.name, 'maker', v_row.maker),
      'to', jsonb_build_object('name', v_name, 'maker', v_maker)
    )
  );
end;
$$;

comment on function public.admin_update_product(uuid, text, text, text, integer) is
  'Correct a product in place, scoped or global. Admin only. Leaves add_count, '
  'contributed_by, household_id and source untouched.';

revoke all on function public.admin_update_product(uuid, text, text, text, integer)
  from public, anon;
grant execute on function public.admin_update_product(uuid, text, text, text, integer)
  to authenticated;

-- ─── delete ──────────────────────────────────────────────────────────────────
-- A hard delete, unlike households. See the header: nothing references this
-- table and list items carry their own text, so this removes a suggestion and
-- nothing else. A soft delete would mean teaching every read path to filter, for
-- a row nobody can lose anything by.
create or replace function public.admin_delete_product(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.product_catalog%rowtype;
begin
  perform public.admin_guard();

  select * into v_row from public.product_catalog where id = p_id;

  -- Idempotent, matching admin_restore_household: a second click, or two admins
  -- on the same row, is not an error worth showing anybody.
  if not found then
    return;
  end if;

  delete from public.product_catalog where id = p_id;

  -- The whole row goes into the audit detail rather than just its id, because
  -- after this statement the id resolves to nothing and an entry saying only
  -- that a uuid was deleted answers no question anyone would later ask.
  perform public.log_security_event(
    'admin_product_deleted',
    v_row.household_id,
    jsonb_build_object(
      'actor', requesting_user_id(),
      'product', p_id,
      'name', v_row.name,
      'maker', v_row.maker,
      'barcode', v_row.barcode,
      'source', v_row.source,
      'add_count', v_row.add_count,
      'household_id', v_row.household_id,
      'contributed_by', v_row.contributed_by
    )
  );
end;
$$;

comment on function public.admin_delete_product(uuid) is
  'Remove a product from the app catalog. Admin only, idempotent, and a hard '
  'delete: nothing references this table and list items carry their own text.';

revoke all on function public.admin_delete_product(uuid) from public, anon;
grant execute on function public.admin_delete_product(uuid) to authenticated;
