-- Per-user MFA control. The flag is intentionally separate from auth.users factors:
-- enabling it requests enrollment on the user's next login, while disabling it also
-- removes any existing TOTP factors through the server-side admin API.
alter table public.profiles
  add column if not exists mfa_enabled boolean not null default false;

comment on column public.profiles.mfa_enabled is
  'ผู้ดูแลเปิดใช้ MFA รายบัญชีหรือไม่ — factor/secret จริงเก็บและจัดการโดย Supabase Auth';

-- my_profile() is a SECURITY DEFINER read of the caller's own profile. Recreate it
-- because PostgreSQL does not allow CREATE OR REPLACE to change a function's return type.
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
  mfa_enabled boolean,
  created_at timestamptz,
  updated_at timestamptz,
  onboarding_completed_at timestamptz,
  onboarding_dismissed_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.employee_code, p.full_name, p.email, p.username, p.phone,
         p.department_id, p.position_id, p.supervisor_id, p.status, p.avatar_url,
         p.mfa_enabled, p.created_at, p.updated_at,
         p.onboarding_completed_at, p.onboarding_dismissed_at
  from public.profiles p
  where p.id = auth.uid();
$$;

revoke all on function public.my_profile() from public, anon;
grant execute on function public.my_profile() to authenticated;
