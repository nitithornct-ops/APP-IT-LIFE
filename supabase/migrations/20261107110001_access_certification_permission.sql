-- Access Certification separates campaign administration from reviewer sign-off.

insert into public.permissions (key, module_key, action, description, status, is_privileged)
values (
  'access_registry.review',
  'access_registry',
  'review',
  'รับรองหรือเพิกถอนสิทธิ์ตาม Access Certification Campaign',
  'active',
  true
)
on conflict (key) do update set is_privileged = true;

insert into public.role_permissions (role_id, permission_id, effect)
select r.id, p.id, 'allow'
from public.roles r
join public.permissions p on p.key = 'access_registry.review'
where r.key in ('approver', 'manager')
on conflict (role_id, permission_id) do nothing;

create or replace function public.sync_permission_privilege_metadata()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.key in (
    'user.manage',
    'role.manage',
    'access_registry.manage',
    'access_registry.review',
    'approval_group.manage',
    'employee.manage',
    'audit.view',
    'report.export',
    'evidence.export',
    'workflow.approve',
    'access_request.approve',
    'change.approve',
    'service_request.approve',
    'data_class.approve',
    'risk.accept'
  ) then
    new.is_privileged := true;
  end if;
  return new;
end;
$$;
