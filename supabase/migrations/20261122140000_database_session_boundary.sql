-- Keep the opt-in MFA policy consistent across Workers, Data API and Storage.
-- This migration contains no changes to enrollment or the per-account MFA switch.
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to authenticated;

create function app_private.session_is_allowed()
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (not p.mfa_enabled or coalesce(auth.jwt()->>'aal', '') = 'aal2')
  );
$$;
revoke all on function app_private.session_is_allowed() from public, anon;
grant execute on function app_private.session_is_allowed() to authenticated;

create function app_private.require_allowed_session()
returns void
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
begin
  -- Use the connection role, not current_user (which changes in a definer).
  -- Trusted backend/owner calls retain their existing behavior.
  if current_setting('role', true) in ('anon', 'authenticated')
     and not app_private.session_is_allowed() then
    raise exception using errcode = '42501', message = 'permission denied: inactive account or required MFA verification missing';
  end if;
end;
$$;
revoke all on function app_private.require_allowed_session() from public, anon, authenticated;

-- Keep the permission resolver internal: the public wrapper checks the target,
-- while has_permission uses this resolver directly to avoid recursive checks.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.effective_permissions_for_user(uuid)'::regprocedure) into definition;
  execute replace(definition, 'FUNCTION public.effective_permissions_for_user(', 'FUNCTION app_private.resolve_permissions(');
end;
$$;
revoke all on function app_private.resolve_permissions(uuid) from public, anon, authenticated;

create or replace function public.has_permission(permission_key_input text)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select app_private.session_is_allowed() and coalesce((
    select ep.effective_effect = 'allow'
    from app_private.resolve_permissions(auth.uid()) ep
    where ep.permission_key = permission_key_input
  ), false);
$$;

create or replace function public.effective_permissions_for_user(target_user_id uuid)
returns table (
  permission_id uuid, permission_key text, module_key text, action text,
  description text, effective_effect text, source text, sources jsonb,
  is_privileged boolean, expires_at timestamptz
)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
begin
  perform app_private.require_allowed_session();
  if current_setting('role', true) in ('anon', 'authenticated')
     and target_user_id is distinct from auth.uid()
     and not (public.has_permission('role.view') or public.has_permission('role.manage') or public.has_permission('user.manage')) then
    raise exception using errcode = '42501', message = 'permission to inspect another account is required';
  end if;
  return query select * from app_private.resolve_permissions(target_user_id);
end;
$$;

-- Restrictive policies AND the session requirement with every existing policy,
-- including owner/participant branches that do not call has_permission().
do $$
declare relation record;
begin
  for relation in
    select n.nspname, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and c.relrowsecurity
      and (n.nspname = 'public' or (n.nspname = 'storage' and c.relname = 'objects'))
  loop
    execute format(
      'create policy require_active_verified_session on %I.%I as restrictive for all to authenticated using ((select app_private.session_is_allowed())) with check ((select app_private.session_is_allowed()))',
      relation.nspname, relation.relname
    );
  end loop;
end;
$$;

-- Definer RPCs bypass RLS: preserve their public signatures, defaults, volatility
-- and OIDs, but delegate to private implementations only after the session check.
-- my_profile is the caller-only MFA bootstrap projection; it intentionally remains
-- available at AAL1 so requireSession can detect enrollment/status requirements.
do $$
declare
  fn record;
  definition text;
  arguments text;
  call_arguments text;
  result_type text;
  body text;
begin
  for fn in
    select p.* from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.prorettype <> 'trigger'::regtype
      and has_function_privilege('authenticated', p.oid, 'execute')
      and p.proname not in ('my_profile', 'has_permission', 'effective_permissions_for_user')
  loop
    if fn.provariadic <> 0 or fn.prokind <> 'f' then
      raise exception 'Unsupported RPC signature: %', fn.oid::regprocedure;
    end if;
    definition := pg_get_functiondef(fn.oid);
    execute replace(definition, format('FUNCTION public.%I(', fn.proname), format('FUNCTION app_private.%I(', fn.proname));
    execute format('revoke all on function app_private.%I(%s) from public, anon, authenticated', fn.proname, pg_get_function_identity_arguments(fn.oid));
    arguments := pg_get_function_arguments(fn.oid);
    result_type := pg_get_function_result(fn.oid);
    select string_agg('$' || i, ', ' order by i) into call_arguments from generate_series(1, fn.pronargs) i;
    call_arguments := coalesce(call_arguments, '');
    if fn.proretset then
      body := format('return query select * from app_private.%I(%s);', fn.proname, call_arguments);
    elsif fn.prorettype = 'void'::regtype then
      body := format('perform app_private.%I(%s); return;', fn.proname, call_arguments);
    else
      body := format('return app_private.%I(%s);', fn.proname, call_arguments);
    end if;
    execute format(
      'create or replace function public.%I(%s) returns %s language plpgsql %s security definer set search_path = pg_catalog, public as %L',
      fn.proname, arguments, result_type,
      case fn.provolatile when 's' then 'stable' when 'i' then 'immutable' else 'volatile' end,
      'begin perform app_private.require_allowed_session(); ' || body || ' end;'
    );
  end loop;
end;
$$;

-- Trigger entrypoints are not RPCs and need no client EXECUTE grant.
do $$
declare fn record;
begin
  for fn in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.oid::regprocedure);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
