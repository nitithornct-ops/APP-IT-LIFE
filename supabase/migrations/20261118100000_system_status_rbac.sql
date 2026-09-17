-- Restrict the detailed internal system status view to Admin roles.
-- The public liveness/readiness endpoints remain unchanged.

insert into public.permissions (key, module_key, action, description, status)
values (
  'system_status.view',
  'system_status',
  'view',
  'View internal system health and incident history (Admin only)',
  'active'
)
on conflict (key) do update set
  module_key = excluded.module_key,
  action = excluded.action,
  description = excluded.description,
  status = excluded.status;

delete from public.role_permissions rp
using public.permissions p, public.roles r
where rp.permission_id = p.id
  and rp.role_id = r.id
  and p.key = 'system_status.view'
  and r.key not in ('super_admin', 'it_admin');

insert into public.role_permissions (role_id, permission_id, effect)
select r.id, p.id, 'allow'
from public.roles r
cross join public.permissions p
where r.key in ('super_admin', 'it_admin')
  and p.key = 'system_status.view'
on conflict (role_id, permission_id) do update set effect = 'allow';
