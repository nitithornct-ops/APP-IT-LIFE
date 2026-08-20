-- Security-sensitive mutations must never commit without an audit record.  The API's
-- richer audit remains useful for request context; this trigger is the atomic,
-- minimal fallback and intentionally stores field names rather than row values/PII.

create or replace function public.audit_sensitive_table_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  before_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else '{}'::jsonb end;
  after_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else '{}'::jsonb end;
  effective_row jsonb := case when tg_op = 'DELETE' then before_row else after_row end;
  changed_fields jsonb := '[]'::jsonb;
  actor_text text;
  actor_uuid uuid;
  record_id text;
begin
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
      into changed_fields
    from (
      select key
      from jsonb_object_keys(before_row || after_row) as keys(key)
      where key not in ('updated_at', 'updated_by', 'created_at', 'created_by')
        and before_row -> key is distinct from after_row -> key
    ) changed;
  end if;

  actor_text := coalesce(
    effective_row ->> 'updated_by',
    effective_row ->> 'created_by',
    effective_row ->> 'assigned_by',
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    auth.uid()::text
  );
  if actor_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    actor_uuid := actor_text::uuid;
  end if;

  record_id := coalesce(
    effective_row ->> 'id',
    effective_row ->> 'user_id',
    effective_row ->> 'role_id',
    effective_row ->> 'request_id'
  );

  insert into public.audit_logs (
    actor_id, action, module, target_table, target_id, detail, result
  ) values (
    actor_uuid,
    'DB_' || tg_op,
    'security',
    tg_table_name,
    record_id,
    jsonb_build_object(
      'source', 'database_trigger',
      'operation', tg_op,
      'changedFields', changed_fields
    ),
    'success'
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.audit_sensitive_table_change() from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles',
    'roles',
    'user_roles',
    'role_permissions',
    'user_permission_overrides',
    'access_requests',
    'user_access_registry'
  ] loop
    execute format('drop trigger if exists trg_%I_atomic_audit on public.%I', table_name, table_name);
    execute format(
      'create trigger trg_%I_atomic_audit after insert or update or delete on public.%I '
      'for each row execute function public.audit_sensitive_table_change()',
      table_name, table_name
    );
  end loop;
end;
$$;

comment on function public.audit_sensitive_table_change() is
  'Atomic, PII-minimised fallback audit for identity and RBAC mutations.';
