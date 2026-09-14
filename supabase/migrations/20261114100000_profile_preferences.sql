-- Self-service profile preferences. Employment data remains owned by Employee Master.

alter table public.profiles
  add column if not exists timezone text not null default 'Asia/Bangkok',
  add column if not exists preferred_language text not null default 'th',
  add column if not exists notification_in_app_enabled boolean not null default true;

do $$
begin
  alter table public.profiles
    add constraint profiles_timezone_check
    check (timezone in ('Asia/Bangkok', 'Asia/Tokyo', 'Asia/Singapore', 'UTC', 'Europe/London', 'America/New_York'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.profiles
    add constraint profiles_preferred_language_check
    check (preferred_language in ('th', 'en'));
exception when duplicate_object then null;
end $$;

-- The browser can only update preferences for the caller's own account.
create or replace function public.update_my_preferences(
  timezone_input text,
  preferred_language_input text,
  notification_in_app_enabled_input boolean
)
returns table (
  timezone text,
  preferred_language text,
  notification_in_app_enabled boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if timezone_input is null or timezone_input not in (
    'Asia/Bangkok', 'Asia/Tokyo', 'Asia/Singapore', 'UTC', 'Europe/London', 'America/New_York'
  ) then
    raise exception using errcode = '22023', message = 'timezone is invalid';
  end if;
  if preferred_language_input is null or preferred_language_input not in ('th', 'en') then
    raise exception using errcode = '22023', message = 'preferred language is invalid';
  end if;

  return query
  update public.profiles p
  set timezone = timezone_input,
      preferred_language = preferred_language_input,
      notification_in_app_enabled = notification_in_app_enabled_input,
      updated_by = caller_id
  where p.id = caller_id
    and p.status = 'active'
  returning p.timezone, p.preferred_language, p.notification_in_app_enabled, p.updated_at;

  if not found then
    raise exception using errcode = '42501', message = 'account is inactive or profile is missing';
  end if;
end;
$$;

revoke all on function public.update_my_preferences(text, text, boolean) from public, anon;
grant execute on function public.update_my_preferences(text, text, boolean) to authenticated;

-- Recreate the caller-only profile projection to expose preferences and the
-- authoritative Employee Master link without granting direct profile reads.
drop function if exists public.my_profile();

create function public.my_profile()
returns table (
  id uuid,
  employee_code text,
  full_name text,
  email text,
  username text,
  phone text,
  department_id uuid,
  position_id uuid,
  supervisor_id uuid,
  status text,
  avatar_url text,
  employee_id uuid,
  mfa_enabled boolean,
  timezone text,
  preferred_language text,
  notification_in_app_enabled boolean,
  created_at timestamptz,
  updated_at timestamptz,
  onboarding_completed_at timestamptz,
  onboarding_dismissed_at timestamptz
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select p.id, p.employee_code, p.full_name, p.email, p.username, p.phone,
         p.department_id, p.position_id, p.supervisor_id, p.status, p.avatar_url,
         p.employee_id, p.mfa_enabled, p.timezone, p.preferred_language,
         p.notification_in_app_enabled, p.created_at, p.updated_at,
         p.onboarding_completed_at, p.onboarding_dismissed_at
  from public.profiles p
  where p.id = auth.uid();
$$;

revoke all on function public.my_profile() from public, anon;
grant execute on function public.my_profile() to authenticated;
