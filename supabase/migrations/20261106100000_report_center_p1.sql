-- ============================================================================
-- Report Center P1: governed filters, scheduled generation, snapshots, KPI
-- definitions and the fixed Monthly Executive Pack template.
-- Drag/drop report design remains intentionally out of scope.
-- ============================================================================

insert into public.permissions (key, module_key, action, description, status)
values
  ('report.schedule', 'report', 'schedule', 'ตั้งเวลาและดูประวัติการสร้างรายงาน', 'active')
on conflict (key) do update set
  module_key = excluded.module_key,
  action = excluded.action,
  description = excluded.description,
  status = excluded.status;

insert into public.role_permissions (role_id, permission_id, effect)
select r.id, p.id, 'allow'
from public.roles r
cross join public.permissions p
where r.key in ('super_admin', 'it_admin', 'technician', 'manager', 'executive', 'auditor')
  and p.key = 'report.schedule'
on conflict (role_id, permission_id) do update set effect = excluded.effect;

-- Executive Pack is a governed system report, so it can use the same append-only
-- export evidence table without pretending to be one of the source reports.
alter table public.report_exports drop constraint if exists report_exports_report_key_fkey;
alter table public.report_exports drop constraint if exists report_exports_report_key_check;
alter table public.report_exports add constraint report_exports_report_key_check check (
  report_key in (
    'service-desk', 'requests-workflows', 'assets-operations', 'asset-custody',
    'asset-verification', 'security-resilience', 'governance-compliance', 'executive-pack'
  )
);

create table public.report_saved_filters (
  id uuid primary key default gen_random_uuid(),
  report_key text not null,
  name text not null check (char_length(trim(name)) between 1 and 100),
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object'),
  is_shared boolean not null default false,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_saved_filters_report_key_check check (
    report_key in (
      'service-desk', 'requests-workflows', 'assets-operations', 'asset-custody',
      'asset-verification', 'security-resilience', 'governance-compliance', 'executive-pack'
    )
  ),
  constraint report_saved_filters_owner_name_unique unique (owner_id, report_key, name)
);

create table public.report_schedules (
  id uuid primary key default gen_random_uuid(),
  report_key text not null,
  name text not null check (char_length(trim(name)) between 1 and 100),
  frequency text not null check (frequency in ('weekly', 'monthly')),
  day_of_week smallint check (day_of_week is null or day_of_week between 0 and 6),
  day_of_month smallint check (day_of_month is null or day_of_month between 1 and 31),
  run_hour smallint not null default 8 check (run_hour between 0 and 23),
  timezone text not null default 'Asia/Bangkok',
  format text not null default 'PDF' check (format in ('CSV', 'PDF', 'PRINT')),
  save_to_drive boolean not null default false,
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object'),
  enabled boolean not null default true,
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete cascade,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_schedules_report_key_check check (
    report_key in (
      'service-desk', 'requests-workflows', 'assets-operations', 'asset-custody',
      'asset-verification', 'security-resilience', 'governance-compliance', 'executive-pack'
    )
  ),
  constraint report_schedules_frequency_day_check check (
    (frequency = 'weekly' and day_of_week is not null)
    or (frequency = 'monthly' and day_of_month is not null)
  )
);

create table public.report_snapshots (
  id uuid primary key default gen_random_uuid(),
  report_key text not null,
  snapshot_kind text not null default 'manual' check (snapshot_kind in ('manual', 'monthly', 'scheduled', 'executive_pack')),
  title text not null,
  period_start date,
  period_end date,
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object'),
  dataset jsonb not null check (jsonb_typeof(dataset) = 'object'),
  generated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint report_snapshots_report_key_check check (
    report_key in (
      'service-desk', 'requests-workflows', 'assets-operations', 'asset-custody',
      'asset-verification', 'security-resilience', 'governance-compliance', 'executive-pack'
    )
  )
);

create table public.report_schedule_runs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.report_schedules(id) on delete cascade,
  scheduled_for timestamptz not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  snapshot_id uuid references public.report_snapshots(id) on delete set null,
  artifact_name text,
  artifact_drive_id text,
  artifact_drive_url text,
  artifact_error text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint report_schedule_runs_schedule_slot_unique unique (schedule_id, scheduled_for)
);

create table public.report_kpi_definitions (
  key text primary key,
  report_key text,
  label text not null,
  description text not null,
  formula text not null,
  unit text not null default 'count',
  target numeric,
  direction text not null default 'informational' check (direction in ('higher_is_better', 'lower_is_better', 'informational')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  sort_order integer not null default 100 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_kpi_definitions_report_key_check check (report_key is null or report_key in (
    'service-desk', 'requests-workflows', 'assets-operations', 'asset-custody',
    'asset-verification', 'security-resilience', 'governance-compliance', 'executive-pack'
  ))
);

create index report_saved_filters_owner_report_idx on public.report_saved_filters(owner_id, report_key, updated_at desc);
create index report_schedules_due_idx on public.report_schedules(enabled, next_run_at);
create index report_schedules_creator_idx on public.report_schedules(created_by, updated_at desc);
create index report_snapshots_report_period_idx on public.report_snapshots(report_key, period_end desc, created_at desc);
create index report_snapshots_creator_idx on public.report_snapshots(created_by, created_at desc);
create index report_schedule_runs_schedule_idx on public.report_schedule_runs(schedule_id, scheduled_for desc);
create index report_kpi_definitions_report_order_idx on public.report_kpi_definitions(report_key, status, sort_order);

create trigger trg_report_saved_filters_set_updated_at
  before update on public.report_saved_filters
  for each row execute function public.set_updated_at();
create trigger trg_report_schedules_set_updated_at
  before update on public.report_schedules
  for each row execute function public.set_updated_at();
create trigger trg_report_kpi_definitions_set_updated_at
  before update on public.report_kpi_definitions
  for each row execute function public.set_updated_at();

alter table public.report_saved_filters enable row level security;
alter table public.report_schedules enable row level security;
alter table public.report_snapshots enable row level security;
alter table public.report_schedule_runs enable row level security;
alter table public.report_kpi_definitions enable row level security;

create policy report_saved_filters_select_own_or_shared on public.report_saved_filters
  for select to authenticated
  using (owner_id = auth.uid() or (is_shared and public.has_permission('report.view')));
create policy report_saved_filters_write_own on public.report_saved_filters
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and public.has_permission('report.view'));

create policy report_schedules_select_own_or_schedule on public.report_schedules
  for select to authenticated
  using (created_by = auth.uid() or public.has_permission('report.schedule'));
create policy report_schedules_write_with_schedule on public.report_schedules
  for all to authenticated
  using (created_by = auth.uid() and public.has_permission('report.schedule'))
  with check (created_by = auth.uid() and public.has_permission('report.schedule'));

create policy report_snapshots_select_with_report on public.report_snapshots
  for select to authenticated
  using (created_by = auth.uid() or public.has_permission('report.view'));

create policy report_schedule_runs_select_with_schedule on public.report_schedule_runs
  for select to authenticated
  using (
    exists (
      select 1 from public.report_schedules s
      where s.id = schedule_id and (s.created_by = auth.uid() or public.has_permission('report.schedule'))
    )
  );

create policy report_kpi_definitions_select_with_report on public.report_kpi_definitions
  for select to authenticated
  using (public.has_permission('report.view'));

insert into public.report_kpi_definitions
  (key, report_key, label, description, formula, unit, target, direction, sort_order)
values
  ('report.total_records', 'executive-pack', 'รายการรวม', 'จำนวนรายการที่เกิดขึ้นในงวดรายงาน', 'นับจำนวน record ที่เข้าเงื่อนไขของรายงาน', 'รายการ', null, 'informational', 10),
  ('report.open_records', 'executive-pack', 'รายการคงค้าง', 'จำนวนรายการที่ยังไม่อยู่ในสถานะสิ้นสุด', 'นับ record ที่ terminal = false', 'รายการ', null, 'lower_is_better', 20),
  ('report.overdue_records', 'executive-pack', 'เกินกำหนด', 'จำนวนรายการที่เกินกำหนดหรือเกิน SLA', 'นับ record ที่ overdue = true', 'รายการ', 0, 'lower_is_better', 30),
  ('report.critical_records', 'executive-pack', 'ความเสี่ยงสูง/วิกฤต', 'จำนวนรายการสำคัญที่ยังเปิดอยู่', 'นับ record ที่ critical = true และยังไม่ปิด', 'รายการ', 0, 'lower_is_better', 40),
  ('report.data_freshness', 'executive-pack', 'ความสดของข้อมูล', 'เวลาที่ source ล่าสุดถูกปรับปรุง', 'max(updated_at) แยกตาม source', 'เวลา', null, 'informational', 50)
on conflict (key) do update set
  report_key = excluded.report_key,
  label = excluded.label,
  description = excluded.description,
  formula = excluded.formula,
  unit = excluded.unit,
  target = excluded.target,
  direction = excluded.direction,
  sort_order = excluded.sort_order,
  status = 'active';

comment on table public.report_saved_filters is 'User-owned or shared governed filter presets for Report Center.';
comment on table public.report_schedules is 'Cron-safe report generation schedules; delivery artifacts are tracked as snapshots.';
comment on table public.report_snapshots is 'Immutable report dataset snapshots for audit and monthly close evidence.';
comment on table public.report_kpi_definitions is 'Human-readable KPI contract shown beside Executive Pack metrics.';
