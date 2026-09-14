-- Preserve username normalization when excluding external vendor accounts.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.raw_user_meta_data ->> 'account_type' = 'vendor_portal' then
    return new;
  end if;

  insert into public.profiles (id, email, full_name, username, status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    nullif(btrim(lower(new.raw_user_meta_data ->> 'username')), ''),
    'active'
  );
  return new;
end;
$$;
