-- Immutable audit/login evidence must survive account deletion unchanged.
-- The original ON DELETE SET NULL foreign keys caused PostgreSQL to issue an
-- UPDATE against immutable rows while deleting the referenced profile. That
-- made Auth account deletion fail with AUDIT_LOG_IMMUTABLE.
--
-- Keep the historical UUID as evidence after the profile is gone. These log
-- identifiers are intentionally historical values, not live ownership links.

alter table public.audit_logs
  drop constraint if exists audit_logs_actor_id_fkey;

alter table public.login_logs
  drop constraint if exists login_logs_user_id_fkey;

create or replace function public.validate_audit_log_actor_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.actor_id is not null and not exists (
    select 1 from public.profiles where id = new.actor_id
  ) then
    raise exception using errcode = '23503', message = 'audit_logs_actor_id_fkey';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_audit_log_actor_identity on public.audit_logs;
create trigger trg_validate_audit_log_actor_identity
  before insert on public.audit_logs
  for each row execute function public.validate_audit_log_actor_identity();

create or replace function public.validate_login_log_user_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.user_id is not null and not exists (
    select 1 from public.profiles where id = new.user_id
  ) then
    raise exception using errcode = '23503', message = 'login_logs_user_id_fkey';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_login_log_user_identity on public.login_logs;
create trigger trg_validate_login_log_user_identity
  before insert on public.login_logs
  for each row execute function public.validate_login_log_user_identity();

revoke all on function public.validate_audit_log_actor_identity() from public, anon, authenticated;
revoke all on function public.validate_login_log_user_identity() from public, anon, authenticated;
grant execute on function public.validate_audit_log_actor_identity() to service_role;
grant execute on function public.validate_login_log_user_identity() to service_role;

comment on column public.audit_logs.actor_id is
  'Historical profile UUID of the actor; retained when the profile is deleted.';

comment on column public.login_logs.user_id is
  'Historical profile UUID associated with the login attempt; retained when the profile is deleted.';
