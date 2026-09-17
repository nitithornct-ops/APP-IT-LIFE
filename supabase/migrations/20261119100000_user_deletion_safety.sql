-- User deletion is deliberately narrower than ordinary record deletion.
-- A profile can only be removed after it is inactive and no business record
-- depends on it through a CASCADE/RESTRICT foreign key. This prevents deleting
-- an account from silently deleting tickets, tasks, approvals or evidence.

create or replace function public.assert_user_deletion_safe(user_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_status text;
  dependent_count bigint;
  blocker record;
  blockers jsonb := '[]'::jsonb;
  remaining_super_admins integer;
begin
  select p.status
    into target_status
  from public.profiles p
  where p.id = user_id_input
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'USER_NOT_FOUND';
  end if;

  if target_status <> 'inactive' then
    raise exception using errcode = 'P0001', message = 'USER_MUST_BE_INACTIVE';
  end if;

  -- Keep the existing last-admin invariant intact even when the account is
  -- removed by Auth (which cascades the profile and its role assignments).
  if exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = user_id_input
      and r.key = 'super_admin'
  ) then
    select count(*)::integer
      into remaining_super_admins
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.user_id
    where r.key = 'super_admin'
      and p.status = 'active'
      and ur.user_id <> user_id_input;

    if remaining_super_admins = 0 then
      raise exception using errcode = 'P0001', message = 'LAST_SUPER_ADMIN';
    end if;
  end if;

  -- Inspect the live FK catalog so new modules inherit the same protection.
-- SET NULL references are safe and intentionally do not block deletion. The
-- default NO ACTION behavior is included because it prevents Auth deletion
-- just as RESTRICT does, even though it does not cascade data.
  for blocker in
    select
      n.nspname as schema_name,
      cls.relname as table_name,
      att.attname as column_name,
      con.confdeltype as delete_action
    from pg_constraint con
    join pg_class cls on cls.oid = con.conrelid
    join pg_namespace n on n.oid = cls.relnamespace
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
    where con.contype = 'f'
      and con.confrelid = 'public.profiles'::regclass
      and con.confdeltype in ('a', 'c', 'r')
      and not (con.conrelid = 'public.profiles'::regclass and att.attname = 'id')
      and not (
        n.nspname = 'public'
        and cls.relname in ('user_roles', 'user_permission_overrides', 'user_access_registry')
      )
      and array_length(con.conkey, 1) = 1
      and array_length(con.confkey, 1) = 1
  loop
    execute format(
      'select count(*) from %I.%I where %I = $1',
      blocker.schema_name,
      blocker.table_name,
      blocker.column_name
    ) into dependent_count using user_id_input;

    if dependent_count > 0 then
      blockers := blockers || jsonb_build_array(jsonb_build_object(
        'table', blocker.table_name,
        'column', blocker.column_name,
        'count', dependent_count,
        'deleteAction', blocker.delete_action
      ));
    end if;
  end loop;

  if jsonb_array_length(blockers) > 0 then
    raise exception using errcode = 'P0001', message = 'USER_HAS_DEPENDENCIES:' || blockers::text;
  end if;

  return jsonb_build_object('safe', true);
end;
$$;

revoke all on function public.assert_user_deletion_safe(uuid) from public, anon, authenticated;
grant execute on function public.assert_user_deletion_safe(uuid) to service_role;

comment on function public.assert_user_deletion_safe(uuid)
  is 'Checks that an inactive user can be permanently deleted without cascading business records.';
