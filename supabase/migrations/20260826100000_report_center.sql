-- ============================================================================
-- Phase 6 Module 20: Unified Report Center
-- Standard governed reports, CSV/print export evidence and RLS.
-- Drag/drop Field/PDF Designer remains deferred until after Go-live.
-- ============================================================================

insert into public.permissions (key, module_key, action, description, status)
values ('report.view', 'report', 'view', 'ดู Report Center และรายงานมาตรฐานตามสิทธิ์ของแหล่งข้อมูล', 'active')
on conflict (key) do update set
  module_key = excluded.module_key,
  action = excluded.action,
  description = excluded.description,
  status = excluded.status;

insert into public.role_permissions (role_id, permission_id, effect)
select r.id, p.id, 'allow'
from public.roles r
cross join public.permissions p
where r.key in ('super_admin', 'it_admin') and p.key = 'report.view'
on conflict (role_id, permission_id) do update set effect = excluded.effect;

insert into public.role_permissions (role_id, permission_id, effect)
select r.id, p.id, 'allow'
from (values
  ('technician', 'report.view'), ('technician', 'report.export'),
  ('approver', 'report.view'),
  ('manager', 'report.view'),
  ('executive', 'report.view'),
  ('auditor', 'report.view'),
  ('dpo', 'report.view')
) as mapping(role_key, permission_key)
join public.roles r on r.key = mapping.role_key
join public.permissions p on p.key = mapping.permission_key
on conflict (role_id, permission_id) do update set effect = excluded.effect;

create table public.report_definitions (
  key text primary key,
  label text not null,
  description text not null,
  required_permissions text[] not null default '{}',
  default_columns jsonb not null default '[]'::jsonb check (jsonb_typeof(default_columns) = 'array'),
  status text not null default 'active' check (status in ('active', 'inactive')),
  sort_order integer not null default 100 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint report_definitions_key_format check (key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table public.report_exports (
  id uuid primary key default gen_random_uuid(),
  export_code text not null unique,
  report_key text not null references public.report_definitions(key) on delete restrict,
  format text not null check (format in ('CSV', 'PRINT')),
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object'),
  row_count integer not null default 0 check (row_count >= 0),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_email text,
  created_at timestamptz not null default now()
);

create index report_definitions_status_order_idx on public.report_definitions(status, sort_order);
create index report_exports_actor_created_idx on public.report_exports(actor_id, created_at desc);
create index report_exports_report_created_idx on public.report_exports(report_key, created_at desc);

create trigger trg_report_definitions_set_updated_at
  before update on public.report_definitions
  for each row execute function public.set_updated_at();

alter table public.report_definitions enable row level security;
alter table public.report_exports enable row level security;

create policy report_definitions_select_with_permission on public.report_definitions
  for select to authenticated
  using (public.has_permission('report.view'));

-- Definitions are system-controlled metadata. Direct writes stay service-role only.
-- Users can review their own export trail; audit readers can review all export evidence.
create policy report_exports_select_own_or_audit on public.report_exports
  for select to authenticated
  using (actor_id = auth.uid() or public.has_permission('audit.view'));

insert into public.report_definitions
  (key, label, description, required_permissions, default_columns, status, sort_order)
values
  ('service-desk', 'Service Desk', 'ปริมาณงาน สถานะ SLA ความเร่งด่วน และความพึงพอใจของ Ticket', array['ticket.view'], '["source","code","title","status","category","owner","dueDate","recordDate"]', 'active', 10),
  ('requests-workflows', 'Requests & Workflows', 'คำขอบริการ คำขอสิทธิ์ และกระบวนการอนุมัติในมุมมองเดียว', array['service_request.view','access_request.view','workflow.view'], '["source","code","title","status","category","owner","dueDate","recordDate"]', 'active', 20),
  ('assets-operations', 'Assets & Operations', 'สินทรัพย์ แผนบำรุงรักษา สต็อก และ License ที่ต้องดูแล', array['asset.view','maintenance.view','inventory.view','license.view'], '["source","code","title","status","category","owner","dueDate","recordDate"]', 'active', 30),
  ('security-resilience', 'Security & Resilience', 'Incident, Vulnerability, Backup และ Recovery ที่กระทบความมั่นคงปลอดภัย', array['incident.view','vulnerability.view','backup.view'], '["source","code","title","status","category","owner","dueDate","recordDate"]', 'active', 40),
  ('governance-compliance', 'Governance & Compliance', 'ความเสี่ยง ข้อกำหนด ข้อค้นพบ Audit และหลักฐานควบคุม', array['risk.view','compliance.view','audit_management.view','evidence.view'], '["source","code","title","status","category","owner","dueDate","recordDate"]', 'active', 50)
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  required_permissions = excluded.required_permissions,
  default_columns = excluded.default_columns,
  status = excluded.status,
  sort_order = excluded.sort_order;

comment on table public.report_definitions is 'Governed standard report catalog; drag/drop designer is deferred post Go-live.';
comment on table public.report_exports is 'Append-only evidence trail for CSV and browser print/PDF report exports.';
