-- MFA is explicitly opt-in. Keep the database default and the Auth trigger
-- aligned so every newly-created profile starts with MFA disabled.
alter table public.profiles
  alter column mfa_enabled set default false;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, status, mfa_enabled)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    'active',
    false
  );
  return new;
end;
$$;
