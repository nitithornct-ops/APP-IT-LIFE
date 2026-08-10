-- ============================================================================
-- Phase 6 Module 16: Backup, Recovery, BCP/DR, Logging & Monitoring
-- Normalize ผู้รับผิดชอบและ CI พร้อมคงฟิลด์ legacy สำหรับการย้ายข้อมูลภายหลัง
-- ============================================================================

create table public.backup_logs (
  id uuid primary key default gen_random_uuid(),
  backup_code text not null unique,
  system_name text not null,
  configuration_item_id uuid references public.configuration_items(id) on delete set null,
  backup_type text not null check (backup_type in ('Full', 'Incremental', 'Differential', 'System Snapshot')),
  backup_date date not null,
  result text not null check (result in ('สำเร็จ', 'สำเร็จบางส่วน', 'ล้มเหลว')),
  data_size text,
  storage_location text,
  operator_id uuid not null references public.profiles(id) on delete restrict,
  next_backup_due date,
  evidence_link text,
  snapshot_file_id text,
  source_system_id text,
  checksum text,
  row_count integer check (row_count is null or row_count >= 0),
  notes text,
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint backup_logs_next_due_valid check (next_backup_due is null or next_backup_due >= backup_date),
  constraint backup_logs_evidence_https check (evidence_link is null or evidence_link ~* '^https://')
);

create table public.recovery_tests (
  id uuid primary key default gen_random_uuid(),
  recovery_code text not null unique,
  backup_log_id uuid references public.backup_logs(id) on delete set null,
  system_name text not null,
  configuration_item_id uuid references public.configuration_items(id) on delete set null,
  test_date date not null,
  scenario text,
  result text not null check (result in ('ผ่าน', 'ผ่านบางส่วน', 'ไม่ผ่าน')),
  rto_actual text,
  rpo_actual text,
  tester_id uuid not null references public.profiles(id) on delete restrict,
  next_test_due date,
  evidence_link text,
  findings text,
  notes text,
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint recovery_tests_next_due_valid check (next_test_due is null or next_test_due >= test_date),
  constraint recovery_tests_evidence_https check (evidence_link is null or evidence_link ~* '^https://')
);

create table public.bcp_plans (
  id uuid primary key default gen_random_uuid(),
  plan_code text not null unique,
  plan_name text not null,
  scope text,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  last_review_date date,
  next_review_due date,
  last_invoked_date timestamptz,
  invoke_reason text,
  document_link text,
  status text not null default 'ใช้งาน' check (status in ('ใช้งาน', 'ระงับ', 'ยกเลิก')),
  notes text,
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint bcp_plans_review_date_valid check (next_review_due is null or last_review_date is null or next_review_due >= last_review_date),
  constraint bcp_plans_document_https check (document_link is null or document_link ~* '^https://'),
  constraint bcp_plans_invocation_reason_valid check (last_invoked_date is null or invoke_reason is not null)
);

create table public.logging_systems (
  id uuid primary key default gen_random_uuid(),
  log_system_code text not null unique,
  system_name text not null,
  configuration_item_id uuid references public.configuration_items(id) on delete set null,
  log_type text,
  log_location text,
  review_frequency text not null check (review_frequency in ('รายวัน', 'รายสัปดาห์', 'รายเดือน', 'รายไตรมาส')),
  responsible_id uuid not null references public.profiles(id) on delete restrict,
  last_review_date date,
  next_review_due date not null,
  retention_period text,
  status text not null default 'ใช้งาน' check (status in ('ใช้งาน', 'ระงับ')),
  notes text,
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint logging_systems_review_date_valid check (last_review_date is null or next_review_due >= last_review_date)
);

create table public.log_reviews (
  id uuid primary key default gen_random_uuid(),
  review_code text not null unique,
  logging_system_id uuid not null references public.logging_systems(id) on delete cascade,
  review_date date not null,
  reviewer_id uuid not null references public.profiles(id) on delete restrict,
  period text not null,
  anomaly_found boolean not null default false,
  anomaly_detail text,
  action_taken text,
  status text not null default 'ปกติ' check (status in ('ปกติ', 'กำลังดำเนินการ', 'แก้ไขแล้ว', 'ยอมรับความเสี่ยง')),
  evidence_link text,
  notes text,
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint log_reviews_anomaly_detail_valid check (not anomaly_found or anomaly_detail is not null),
  constraint log_reviews_status_valid check ((not anomaly_found and status = 'ปกติ') or (anomaly_found and status <> 'ปกติ')),
  constraint log_reviews_evidence_https check (evidence_link is null or evidence_link ~* '^https://')
);

create unique index backup_logs_legacy_id_unique on public.backup_logs (legacy_id) where legacy_id is not null;
create unique index recovery_tests_legacy_id_unique on public.recovery_tests (legacy_id) where legacy_id is not null;
create unique index bcp_plans_legacy_id_unique on public.bcp_plans (legacy_id) where legacy_id is not null;
create unique index logging_systems_legacy_id_unique on public.logging_systems (legacy_id) where legacy_id is not null;
create unique index log_reviews_legacy_id_unique on public.log_reviews (legacy_id) where legacy_id is not null;
create index backup_logs_date_result_idx on public.backup_logs (backup_date desc, result);
create index backup_logs_next_due_idx on public.backup_logs (next_backup_due) where next_backup_due is not null;
create index recovery_tests_next_due_idx on public.recovery_tests (next_test_due) where next_test_due is not null;
create index bcp_plans_next_review_idx on public.bcp_plans (next_review_due) where status = 'ใช้งาน';
create index logging_systems_next_review_idx on public.logging_systems (next_review_due) where status = 'ใช้งาน';
create index log_reviews_system_date_idx on public.log_reviews (logging_system_id, review_date desc);
create index log_reviews_open_anomaly_idx on public.log_reviews (status, review_date desc) where anomaly_found;

create trigger trg_backup_logs_set_updated_at before update on public.backup_logs for each row execute function public.set_updated_at();
create trigger trg_recovery_tests_set_updated_at before update on public.recovery_tests for each row execute function public.set_updated_at();
create trigger trg_bcp_plans_set_updated_at before update on public.bcp_plans for each row execute function public.set_updated_at();
create trigger trg_logging_systems_set_updated_at before update on public.logging_systems for each row execute function public.set_updated_at();
create trigger trg_log_reviews_set_updated_at before update on public.log_reviews for each row execute function public.set_updated_at();

alter table public.backup_logs enable row level security;
alter table public.recovery_tests enable row level security;
alter table public.bcp_plans enable row level security;
alter table public.logging_systems enable row level security;
alter table public.log_reviews enable row level security;

create policy backup_logs_select_with_permission on public.backup_logs for select to authenticated using (public.has_permission('backup.view'));
create policy backup_logs_write_with_permission on public.backup_logs for all to authenticated using (public.has_permission('backup.manage')) with check (public.has_permission('backup.manage'));
create policy recovery_tests_select_with_permission on public.recovery_tests for select to authenticated using (public.has_permission('backup.view'));
create policy recovery_tests_write_with_permission on public.recovery_tests for all to authenticated using (public.has_permission('backup.manage')) with check (public.has_permission('backup.manage'));
create policy bcp_plans_select_with_permission on public.bcp_plans for select to authenticated using (public.has_permission('backup.view'));
create policy bcp_plans_write_with_permission on public.bcp_plans for all to authenticated using (public.has_permission('backup.manage')) with check (public.has_permission('backup.manage'));
create policy logging_systems_select_with_permission on public.logging_systems for select to authenticated using (public.has_permission('monitoring.view'));
create policy logging_systems_write_with_permission on public.logging_systems for all to authenticated using (public.has_permission('monitoring.manage')) with check (public.has_permission('monitoring.manage'));
create policy log_reviews_select_with_permission on public.log_reviews for select to authenticated using (public.has_permission('monitoring.view'));
create policy log_reviews_write_with_permission on public.log_reviews for all to authenticated using (public.has_permission('monitoring.manage')) with check (public.has_permission('monitoring.manage'));
