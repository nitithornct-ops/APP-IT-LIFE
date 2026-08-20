-- Keep profile deactivation, access-registry suspension and its high-level audit
-- in one database transaction. Supabase Auth is a separate system, so the API
-- bans the account first and compensates by unbanning it if this RPC fails.

create or replace function public.deactivate_user_access(
  user_id_input uuid,
  actor_id_input uuid,
  actor_email_input text,
  reason_input text,
  request_id_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_profile_id uuid;
  suspended_count integer;
begin
  if nullif(btrim(reason_input), '') is null or char_length(reason_input) > 1000 then
    raise exception using errcode = '22023', message = 'DEACTIVATION_REASON_INVALID';
  end if;

  select id into target_profile_id
  from public.profiles
  where id = user_id_input
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'USER_NOT_FOUND';
  end if;

  update public.profiles
  set status = 'inactive', updated_by = actor_id_input
  where id = target_profile_id;

  update public.user_access_registry
  set
    status = 'suspended',
    notes = 'พ้นสภาพ: ' || btrim(reason_input),
    updated_by = actor_id_input
  where user_id = target_profile_id
    and status = 'active';

  get diagnostics suspended_count = row_count;

  insert into public.audit_logs (
    actor_id, actor_email, action, module, target_table, target_id,
    detail, result, request_id
  ) values (
    actor_id_input, actor_email_input, 'DEACTIVATE_USER', 'access_registry',
    'profiles', target_profile_id::text,
    jsonb_build_object('suspendedCount', suspended_count),
    'success', request_id_input
  );

  return jsonb_build_object('suspendedCount', suspended_count);
end;
$$;

revoke all on function public.deactivate_user_access(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.deactivate_user_access(uuid, uuid, text, text, text)
  to service_role;

comment on function public.deactivate_user_access(uuid, uuid, text, text, text)
  is 'Atomically deactivates a profile, suspends active access grants and records the action.';
