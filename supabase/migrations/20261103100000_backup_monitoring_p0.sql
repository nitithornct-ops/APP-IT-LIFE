-- Backup & Monitoring P0 automation.
-- Additive migration: existing backup/recovery/BCP rows remain valid and readable.

create table public.backup_import_batches (
  id uuid primary key default gen_random_uuid(),
  import_code text not null unique,
  source_system text not null check (char_length(source_system) between 1 and 150),
  idempotency_key text not null unique check (char_length(idempotency_key) between 1 and 250),
  status text not null default 'PROCESSING' check (status in ('PROCESSING', 'SUCCEEDED', 'PARTIAL', 'FAILED')),
  total_count integer not null default 0 check (total_count >= 0),
  imported_count integer not null default 0 check (imported_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  error_summary text,
  received_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint backup_import_batches_counts_valid check (imported_count + skipped_count + failed_count <= total_count),
  constraint backup_import_batches_completion_valid check ((status = 'PROCESSING' and completed_at is null) or (status <> 'PROCESSING' and completed_at is not null))
);

create table public.backup_policies (
  id uuid primary key default gen_random_uuid(),
  policy_code text not null unique,
  configuration_item_id uuid not null unique references public.configuration_items(id) on delete cascade,
  expected_backup_policy text not null default 'ยังไม่ได้กำหนด' check (char_length(expected_backup_policy) between 1 and 500),
  rto_target_hours numeric(10,2) check (rto_target_hours is null or rto_target_hours >= 0),
  rpo_target_hours numeric(10,2) check (rpo_target_hours is null or rpo_target_hours >= 0),
  backup_schedule text not null default 'ทุกวัน' check (char_length(backup_schedule) between 1 and 150),
  schedule_interval_minutes integer not null default 1440 check (schedule_interval_minutes between 5 and 525600),
  storage_capacity_bytes bigint check (storage_capacity_bytes is null or storage_capacity_bytes >= 0),
  storage_used_bytes bigint check (storage_used_bytes is null or storage_used_bytes >= 0),
  storage_alert_threshold_percent numeric(5,2) not null default 80 check (storage_alert_threshold_percent between 1 and 100),
  restore_verification_required boolean not null default true,
  alerts_enabled boolean not null default true,
  missed_backup_alert boolean not null default true,
  failure_alert boolean not null default true,
  auto_create_incident boolean not null default true,
  owner_id uuid references public.profiles(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint backup_policies_storage_valid check (
    storage_used_bytes is null or storage_capacity_bytes is null or storage_used_bytes <= storage_capacity_bytes
  )
);

alter table public.backup_logs
  add column if not exists source_run_id text,
  add column if not exists import_batch_id uuid references public.backup_import_batches(id) on delete set null,
  add column if not exists backup_started_at timestamptz,
  add column if not exists backup_completed_at timestamptz,
  add column if not exists data_size_bytes bigint,
  add column if not exists storage_used_bytes bigint,
  add column if not exists storage_capacity_bytes bigint;

alter table public.recovery_tests
  add column if not exists restore_verified boolean not null default false,
  add column if not exists restore_verified_at timestamptz,
  add column if not exists restore_verification_notes text;

alter table public.bcp_plans
  add column if not exists dr_exercise_schedule text,
  add column if not exists last_dr_exercise_date date,
  add column if not exists next_dr_exercise_due date,
  add column if not exists dr_exercise_result text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'backup_logs_source_run_id_valid' and conrelid = 'public.backup_logs'::regclass) then
    alter table public.backup_logs add constraint backup_logs_source_run_id_valid check (source_run_id is null or char_length(source_run_id) between 1 and 250);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'backup_logs_automated_metrics_valid' and conrelid = 'public.backup_logs'::regclass) then
    alter table public.backup_logs add constraint backup_logs_automated_metrics_valid check (
      (data_size_bytes is null or data_size_bytes >= 0)
      and (storage_used_bytes is null or storage_used_bytes >= 0)
      and (storage_capacity_bytes is null or storage_capacity_bytes >= 0)
      and (storage_used_bytes is null or storage_capacity_bytes is null or storage_used_bytes <= storage_capacity_bytes)
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'backup_logs_time_order_valid' and conrelid = 'public.backup_logs'::regclass) then
    alter table public.backup_logs add constraint backup_logs_time_order_valid check (
      backup_completed_at is null or backup_started_at is null or backup_completed_at >= backup_started_at
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'recovery_tests_restore_verification_valid' and conrelid = 'public.recovery_tests'::regclass) then
    alter table public.recovery_tests add constraint recovery_tests_restore_verification_valid check (
      (not restore_verified and restore_verified_at is null)
      or (restore_verified and restore_verified_at is not null)
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bcp_plans_dr_exercise_result_valid' and conrelid = 'public.bcp_plans'::regclass) then
    alter table public.bcp_plans add constraint bcp_plans_dr_exercise_result_valid check (
      dr_exercise_result is null or dr_exercise_result in ('ผ่าน', 'ผ่านบางส่วน', 'ไม่ผ่าน', 'ยังไม่ได้ทดสอบ')
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bcp_plans_dr_exercise_dates_valid' and conrelid = 'public.bcp_plans'::regclass) then
    alter table public.bcp_plans add constraint bcp_plans_dr_exercise_dates_valid check (
      next_dr_exercise_due is null or last_dr_exercise_date is null or next_dr_exercise_due >= last_dr_exercise_date
    );
  end if;
end $$;

create unique index if not exists backup_logs_source_run_id_unique
  on public.backup_logs (source_run_id) where source_run_id is not null;
create index if not exists backup_logs_import_batch_idx on public.backup_logs (import_batch_id) where import_batch_id is not null;
create index if not exists backup_logs_completed_at_idx on public.backup_logs (backup_completed_at desc) where backup_completed_at is not null;
create index if not exists backup_policies_status_idx on public.backup_policies (status, configuration_item_id);
create index if not exists backup_policies_owner_idx on public.backup_policies (owner_id) where owner_id is not null;

create table public.backup_evidence_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_code text not null unique,
  source_table text not null check (source_table in ('backup_logs', 'recovery_tests', 'bcp_plans')),
  source_record_id uuid not null,
  captured_at timestamptz not null default now(),
  payload jsonb not null,
  checksum text not null check (char_length(checksum) between 32 and 128),
  generated boolean not null default true,
  import_batch_id uuid references public.backup_import_batches(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint backup_evidence_snapshots_source_checksum_unique unique (source_table, source_record_id, checksum)
);

create index if not exists backup_evidence_snapshots_source_idx
  on public.backup_evidence_snapshots (source_table, source_record_id, captured_at desc);

create table public.backup_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_key text not null unique,
  alert_type text not null check (alert_type in ('MISSED_BACKUP', 'BACKUP_FAILURE', 'STORAGE_CAPACITY', 'RESTORE_VERIFICATION', 'DR_EXERCISE')),
  policy_id uuid references public.backup_policies(id) on delete set null,
  configuration_item_id uuid references public.configuration_items(id) on delete set null,
  backup_log_id uuid references public.backup_logs(id) on delete set null,
  bcp_plan_id uuid references public.bcp_plans(id) on delete set null,
  status text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED')),
  severity text not null default 'สูง' check (severity in ('ปานกลาง', 'สูง', 'วิกฤต')),
  title text not null check (char_length(title) <= 200),
  message text not null check (char_length(message) <= 2000),
  observed_at timestamptz not null default now(),
  resolved_at timestamptz,
  incident_id uuid unique references public.incidents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint backup_alerts_resolution_valid check ((status = 'OPEN' and resolved_at is null) or (status = 'RESOLVED' and resolved_at is not null))
);

alter table public.incidents
  add column if not exists source_backup_alert_id uuid unique references public.backup_alerts(id) on delete set null;

create index if not exists backup_alerts_status_idx on public.backup_alerts (status, observed_at desc);
create index if not exists backup_alerts_policy_idx on public.backup_alerts (policy_id, alert_type, status);
create index if not exists backup_alerts_ci_idx on public.backup_alerts (configuration_item_id, alert_type, status);

create trigger trg_backup_import_batches_set_updated_at before update on public.backup_import_batches for each row execute function public.set_updated_at();
create trigger trg_backup_policies_set_updated_at before update on public.backup_policies for each row execute function public.set_updated_at();
create trigger trg_backup_alerts_set_updated_at before update on public.backup_alerts for each row execute function public.set_updated_at();

-- Capture immutable evidence after every material write. md5 is deliberately used here because
-- it is available in the managed Postgres runtime without changing the project's extensions.
create or replace function public.capture_backup_evidence_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  snapshot_payload jsonb;
begin
  snapshot_payload := to_jsonb(new);
  insert into public.backup_evidence_snapshots (
    snapshot_code, source_table, source_record_id, captured_at, payload, checksum,
    generated, import_batch_id, created_by
  ) values (
    'EVI-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 16)),
    tg_table_name,
    new.id,
    clock_timestamp(),
    snapshot_payload,
    md5(snapshot_payload::text),
    true,
    case when tg_table_name = 'backup_logs' then nullif(snapshot_payload ->> 'import_batch_id', '')::uuid else null end,
    coalesce(nullif(snapshot_payload ->> 'updated_by', '')::uuid, nullif(snapshot_payload ->> 'created_by', '')::uuid)
  )
  on conflict (source_table, source_record_id, checksum) do nothing;
  return new;
end;
$$;

create trigger trg_backup_logs_capture_evidence
  after insert or update on public.backup_logs
  for each row execute function public.capture_backup_evidence_snapshot();
create trigger trg_recovery_tests_capture_evidence
  after insert or update on public.recovery_tests
  for each row execute function public.capture_backup_evidence_snapshot();
create trigger trg_bcp_plans_capture_evidence
  after insert or update on public.bcp_plans
  for each row execute function public.capture_backup_evidence_snapshot();

-- Existing CIs already marked as requiring backup receive a visible baseline policy.
-- Targets remain null when the source CI did not define them; users can complete them in the UI.
insert into public.backup_policies (
  policy_code, configuration_item_id, expected_backup_policy,
  rto_target_hours, rpo_target_hours, backup_schedule,
  schedule_interval_minutes, owner_id, created_by, updated_by
)
select
  'POL-' || upper(substr(md5(ci.id::text), 1, 12)),
  ci.id,
  coalesce(nullif(btrim(ci.backup_reference), ''), 'ยังไม่ได้กำหนด'),
  ci.rto_hours,
  ci.rpo_hours,
  'ทุกวัน',
  1440,
  null,
  null,
  null
from public.configuration_items ci
where coalesce(ci.backup_required, false)
on conflict (configuration_item_id) do nothing;

-- Snapshot the rows that existed before this migration so an auditor can see the baseline.
insert into public.backup_evidence_snapshots (
  snapshot_code, source_table, source_record_id, captured_at, payload, checksum, generated, created_by
)
select
  'EVI-' || upper(substr(md5(bl.id::text), 1, 16)), 'backup_logs', bl.id, coalesce(bl.updated_at, bl.created_at), to_jsonb(bl), md5(to_jsonb(bl)::text), true, coalesce(bl.updated_by, bl.created_by)
from public.backup_logs bl
on conflict (source_table, source_record_id, checksum) do nothing;
insert into public.backup_evidence_snapshots (
  snapshot_code, source_table, source_record_id, captured_at, payload, checksum, generated, created_by
)
select
  'EVI-' || upper(substr(md5(rt.id::text), 1, 16)), 'recovery_tests', rt.id, coalesce(rt.updated_at, rt.created_at), to_jsonb(rt), md5(to_jsonb(rt)::text), true, coalesce(rt.updated_by, rt.created_by)
from public.recovery_tests rt
on conflict (source_table, source_record_id, checksum) do nothing;
insert into public.backup_evidence_snapshots (
  snapshot_code, source_table, source_record_id, captured_at, payload, checksum, generated, created_by
)
select
  'EVI-' || upper(substr(md5(bp.id::text), 1, 16)), 'bcp_plans', bp.id, coalesce(bp.updated_at, bp.created_at), to_jsonb(bp), md5(to_jsonb(bp)::text), true, coalesce(bp.updated_by, bp.created_by)
from public.bcp_plans bp
on conflict (source_table, source_record_id, checksum) do nothing;

alter table public.backup_import_batches enable row level security;
alter table public.backup_policies enable row level security;
alter table public.backup_evidence_snapshots enable row level security;
alter table public.backup_alerts enable row level security;

create policy backup_import_batches_select_with_permission on public.backup_import_batches
  for select to authenticated using (public.has_permission('backup.view'));
create policy backup_policies_select_with_permission on public.backup_policies
  for select to authenticated using (public.has_permission('backup.view'));
create policy backup_policies_insert_with_permission on public.backup_policies
  for insert to authenticated with check (public.has_permission('backup.manage'));
create policy backup_policies_update_with_permission on public.backup_policies
  for update to authenticated using (public.has_permission('backup.manage')) with check (public.has_permission('backup.manage'));
create policy backup_evidence_snapshots_select_with_permission on public.backup_evidence_snapshots
  for select to authenticated using (public.has_permission('backup.view'));
create policy backup_alerts_select_with_permission on public.backup_alerts
  for select to authenticated using (public.has_permission('backup.view'));

revoke insert, update, delete on public.backup_import_batches, public.backup_evidence_snapshots, public.backup_alerts from authenticated;

comment on table public.backup_policies is 'Expected backup policy and monitoring targets per Configuration Item.';
comment on table public.backup_alerts is 'Durable backup monitoring alerts; incidents are linked through incident_id.';
comment on table public.backup_evidence_snapshots is 'Automatically captured, checksum-addressable evidence snapshots for audit.';
