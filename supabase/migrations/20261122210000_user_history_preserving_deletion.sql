-- Auth soft deletion keeps the profile FK target and all business history.
alter table public.profiles add column account_deleted_at timestamptz;

create function public.sync_deleted_auth_account()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    begin
      perform public.assert_user_deletion_safe(new.id);
    exception when sqlstate 'P0001' then
      -- Only business dependencies may be retained. All other guards still apply.
      if sqlerrm not like 'USER_HAS_DEPENDENCIES:%' then
        raise;
      end if;
    end;
    update public.profiles
    set account_deleted_at = new.deleted_at, status = 'inactive'
    where id = new.id;
  end if;
  return new;
end;
$$;

create trigger sync_deleted_auth_account
after update of deleted_at on auth.users
for each row execute function public.sync_deleted_auth_account();

create function public.guard_deleted_profile()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.account_deleted_at is not null and (
    new.account_deleted_at is distinct from old.account_deleted_at or new.status <> 'inactive'
  ) then
    raise exception 'USER_ACCOUNT_DELETED';
  end if;
  return new;
end;
$$;

create trigger guard_deleted_profile
before update on public.profiles
for each row execute function public.guard_deleted_profile();

revoke all on function public.sync_deleted_auth_account() from public, anon, authenticated;
revoke all on function public.guard_deleted_profile() from public, anon, authenticated;
