-- Close the lifecycle gap for rows that were already inactive before the P1
-- trigger was installed, and prevent future links to inactive identities.

update public.line_users l
set linked_user_id = null,
    unlinked_at = now(),
    unlinked_reason = 'employee_terminated',
    updated_by = null
from public.profiles p
join public.employees e on e.id = p.employee_id
where l.linked_user_id = p.id
  and (e.status = 'inactive' or e.employment_status = 'terminated');

update public.line_users l
set linked_user_id = null,
    unlinked_at = now(),
    unlinked_reason = 'profile_inactive',
    updated_by = null
from public.profiles p
where l.linked_user_id = p.id
  and (p.status = 'inactive' or p.employment_status = 'terminated');

create or replace function public.guard_line_link_to_active_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.linked_user_id is not null and exists (
    select 1
    from public.profiles p
    left join public.employees e on e.id = p.employee_id
    where p.id = new.linked_user_id
      and (
        p.status = 'inactive'
        or p.employment_status = 'terminated'
        or e.status = 'inactive'
        or e.employment_status = 'terminated'
      )
  ) then
    raise exception 'Cannot link a LINE account to an inactive profile';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_line_users_guard_active_profile on public.line_users;
create trigger trg_line_users_guard_active_profile
  before insert or update of linked_user_id on public.line_users
  for each row execute function public.guard_line_link_to_active_profile();

revoke all on function public.guard_line_link_to_active_profile() from public, anon, authenticated;
grant execute on function public.guard_line_link_to_active_profile() to service_role;
