-- ============================================================================
-- Phase 6 Module 19: Governance, Risk, Compliance, PDPA and Operations
-- E1-E12 are delivered as one governed center. The drag/drop Field/PDF Designer
-- is intentionally deferred until after Go-live; versioned JSON template storage
-- remains in place so later Designer work does not require a data migration.
-- ============================================================================

create table public.governance_data_assets (
  id uuid primary key default gen_random_uuid(), data_code text not null unique,
  data_name text not null, system_name text not null,
  classification text not null check (classification in ('ลับมาก','ลับ','ไม่ลับ')),
  data_owner text not null, custodian text, storage_method text,
  retention_days integer check (retention_days is null or retention_days between 1 and 36500),
  contains_personal_data boolean not null default false,
  next_review_date date, status text not null default 'ใช้งาน', notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null
);

create table public.data_destruction_requests (
  id uuid primary key default gen_random_uuid(), request_code text not null unique,
  data_asset_id uuid not null references public.governance_data_assets(id) on delete restrict,
  data_name text not null, classification text not null, reason text not null,
  requester_id uuid references public.profiles(id) on delete set null, requester_email text, requested_at timestamptz not null default now(),
  status text not null default 'รออนุมัติ' check (status in ('รออนุมัติ','อนุมัติแล้ว รอดำเนินการ','ปฏิเสธ','ทำลายแล้ว')),
  approved_by_id uuid references public.profiles(id) on delete set null, approved_by_email text, approved_at timestamptz, approval_comment text,
  destruction_method text, evidence_url text check (evidence_url is null or evidence_url like 'https://%'),
  destroyed_by_id uuid references public.profiles(id) on delete set null, destroyed_by_email text, destroyed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null,
  constraint destruction_lifecycle_consistent check (
    (status = 'รออนุมัติ' and approved_at is null and destroyed_at is null) or
    (status in ('อนุมัติแล้ว รอดำเนินการ','ปฏิเสธ') and approved_at is not null and destroyed_at is null) or
    (status = 'ทำลายแล้ว' and approved_at is not null and destroyed_at is not null and evidence_url is not null)
  )
);

create table public.legal_register (
  id uuid primary key default gen_random_uuid(), law_code text not null unique,
  law_name text not null, short_name text, authority text, version text, effective_date date,
  applicability_status text not null, owner text, source_url text check (source_url is null or source_url like 'https://%'),
  next_review_date date, status text not null default 'ใช้งาน', notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null
);

create table public.compliance_obligations (
  id uuid primary key default gen_random_uuid(), obligation_code text not null unique,
  law_id uuid not null references public.legal_register(id) on delete restrict,
  clause text, requirement text not null, control_domain text, control_owner text, frequency text,
  evidence_required boolean not null default true, related_module text, applicability_status text not null,
  due_date date, status text not null default 'เปิด', notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null
);

create table public.compliance_assessments (
  id uuid primary key default gen_random_uuid(), assessment_code text not null unique,
  obligation_id uuid not null references public.compliance_obligations(id) on delete restrict,
  assessment_date date not null, result text not null, control_description text,
  evidence_url text check (evidence_url is null or evidence_url like 'https://%'), gap_description text, next_review_due date, notes text,
  assessor_id uuid references public.profiles(id) on delete set null, assessor_email text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null
);

create table public.compliance_corrective_actions (
  id uuid primary key default gen_random_uuid(), action_code text not null unique,
  obligation_id uuid not null references public.compliance_obligations(id) on delete restrict,
  assessment_id uuid references public.compliance_assessments(id) on delete set null,
  title text not null, root_cause text, action_plan text not null, owner text not null, priority text not null,
  due_date date, status text not null default 'เปิด', notes text,
  verified_by uuid references public.profiles(id) on delete set null, verified_by_email text, verified_at timestamptz,
  verification_evidence_url text check (verification_evidence_url is null or verification_evidence_url like 'https://%'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null
);

create table public.privacy_ropa (
  id uuid primary key default gen_random_uuid(), ropa_code text not null unique,
  process_name text not null, department text not null, data_owner text, purpose text not null, lawful_basis text not null,
  data_subjects text, personal_data text, sensitive_data text, recipients text,
  cross_border_transfer boolean not null default false, retention_period text, security_measures text,
  dpia_required boolean not null default false, dpia_status text, review_date date,
  status text not null default 'ร่าง', notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null
);

create table public.privacy_consents (
  id uuid primary key default gen_random_uuid(), consent_code text not null unique,
  data_subject_ref text not null, purpose text not null, notice_version text not null, channel text not null,
  granted_at date not null, evidence_url text check (evidence_url is null or evidence_url like 'https://%'), notes text,
  status text not null default 'ใช้งาน' check (status in ('ใช้งาน','ถอนแล้ว')),
  withdrawn_at timestamptz, withdrawn_by_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null,
  constraint consent_withdrawal_consistent check ((status = 'ใช้งาน' and withdrawn_at is null) or (status = 'ถอนแล้ว' and withdrawn_at is not null))
);

create table public.privacy_dsr (
  id uuid primary key default gen_random_uuid(), request_code text not null unique,
  request_type text not null, data_subject_ref text not null, contact text not null, owner text,
  received_at timestamptz not null default now(), due_date date not null, status text not null default 'รับคำขอ', notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null
);

create table public.governance_risks (
  id uuid primary key default gen_random_uuid(), risk_code text not null unique, title text not null,
  category text, related_asset text, related_system text, threat text, vulnerability text, owner text not null,
  likelihood integer not null check (likelihood between 1 and 5), impact integer not null check (impact between 1 and 5),
  risk_score integer not null check (risk_score between 1 and 25 and risk_score = likelihood * impact),
  treatment text, existing_controls text, treatment_plan text, treatment_owner text, due_date date,
  residual_likelihood integer check (residual_likelihood is null or residual_likelihood between 1 and 5),
  residual_impact integer check (residual_impact is null or residual_impact between 1 and 5),
  residual_score integer check (residual_score is null or residual_score between 1 and 25),
  identified_date date not null default current_date, status text not null default 'เปิด', notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null,
  constraint residual_risk_consistent check (
    (residual_likelihood is null and residual_impact is null and residual_score is null) or
    (residual_likelihood is not null and residual_impact is not null and residual_score = residual_likelihood * residual_impact)
  )
);

create table public.governance_ai_tools (
  id uuid primary key default gen_random_uuid(), tool_code text not null unique, tool_name text not null,
  vendor text, purpose text, allowed_data_types text, prohibited_data_types text not null, owner text, approval_ref text,
  status text not null default 'รออนุมัติ', notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null
);

create table public.governance_cloud_services (
  id uuid primary key default gen_random_uuid(), service_code text not null unique, service_name text not null,
  provider text not null, purpose text, allowed_data_class text not null default 'ไม่ลับ', owner text, approval_ref text,
  backup_arrangement text, exit_plan text not null, contract_expiry date, status text not null default 'รออนุมัติ', notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null
);

create table public.governance_training_plans (
  id uuid primary key default gen_random_uuid(), plan_code text not null unique,
  year integer not null check (year between 2020 and 2200), quarter text not null check (quarter in ('Q1','Q2','Q3','Q4')),
  topic text not null, target_group text, planned_date date, responsible text,
  passing_score numeric(5,2) not null default 80 check (passing_score between 0 and 100),
  status text not null default 'วางแผน', completed_at timestamptz, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null
);

create table public.governance_training_records (
  id uuid primary key default gen_random_uuid(), record_code text not null unique,
  plan_id uuid references public.governance_training_plans(id) on delete set null,
  course_title text not null, participant_id uuid references public.profiles(id) on delete set null, participant_email text,
  score numeric(5,2) check (score is null or score between 0 and 100), passed boolean, status text not null default 'ASSIGNED',
  completed_at timestamptz, certificate_url text check (certificate_url is null or certificate_url like 'https://%'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null
);

create table public.policy_acknowledgements (
  id uuid primary key default gen_random_uuid(), ack_code text not null unique,
  policy_name text not null, policy_version text not null, signature_name text not null, confirmed boolean not null check (confirmed),
  acknowledger_id uuid not null references public.profiles(id) on delete restrict, acknowledger_name text not null, acknowledger_email text,
  acknowledged_at timestamptz not null default now(), status text not null default 'รับทราบแล้ว',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null,
  constraint policy_ack_unique unique (policy_name, policy_version, acknowledger_id)
);

create table public.governance_controls (
  id uuid primary key default gen_random_uuid(), control_code text not null unique,
  domain text not null, title text not null, requirement text, owner text, frequency text,
  status text not null default 'ใช้งาน', next_review_date date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null
);

create table public.governance_evidence_items (
  id uuid primary key default gen_random_uuid(), evidence_code text not null unique,
  control_id uuid not null references public.governance_controls(id) on delete restrict,
  source_module text not null, source_record_id text, title text not null,
  evidence_url text not null check (evidence_url like 'https://%'), status text not null default 'พร้อมตรวจ',
  owner text, observed_at timestamptz not null default now(), expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null
);

create table public.audit_engagements (
  id uuid primary key default gen_random_uuid(), audit_code text not null unique, title text not null,
  audit_type text, scope text not null, criteria text, lead_auditor text, auditee text,
  planned_start date, planned_end date, status text not null default 'เปิด', closed_at timestamptz, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null
);

create table public.audit_findings (
  id uuid primary key default gen_random_uuid(), finding_code text not null unique,
  audit_id uuid not null references public.audit_engagements(id) on delete cascade, title text not null,
  finding_type text, requirement text, evidence text, root_cause text, action_plan text, owner text not null,
  due_date date, status text not null default 'เปิด', notes text,
  verified_by uuid references public.profiles(id) on delete set null, verified_by_email text, verified_at timestamptz,
  verification_evidence_url text check (verification_evidence_url is null or verification_evidence_url like 'https://%'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null
);

create table public.governance_document_templates (
  id uuid primary key default gen_random_uuid(), template_code text not null unique, name text not null,
  version integer not null default 1 check (version > 0),
  designer_mode text not null default 'STRUCTURED_METADATA' check (designer_mode in ('STRUCTURED_METADATA','DRAG_DROP')),
  design_schema jsonb not null default '{}'::jsonb check (jsonb_typeof(design_schema) = 'object'),
  status text not null default 'DEFERRED' check (status in ('DEFERRED','DRAFT','ACTIVE','RETIRED')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null,
  constraint document_template_version_unique unique (template_code, version)
);

create table public.governance_documents (
  id uuid primary key default gen_random_uuid(), document_code text not null unique, title text not null,
  document_type text, version text not null, owner text, approved_by text, effective_date date, review_date date,
  document_url text not null check (document_url like 'https://%'),
  template_id uuid references public.governance_document_templates(id) on delete set null,
  template_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(template_snapshot) = 'object'),
  status text not null default 'ร่าง', notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null
);

create table public.employee_lifecycle_events (
  id uuid primary key default gen_random_uuid(), lifecycle_code text not null unique,
  employee_id uuid not null references public.employees(id) on delete restrict, employee_code text not null,
  employee_name text not null, employee_email text, event_type text not null check (event_type in ('JOINER','MOVER','LEAVER')),
  effective_date date not null, new_department text, new_position text, reason text, notes text,
  status text not null default 'PENDING' check (status in ('PENDING','PROCESSING','COMPLETED','FAILED','CANCELLED')),
  requested_by_id uuid references public.profiles(id) on delete set null, requested_by_email text,
  completed_at timestamptz, result_detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null
);

create table public.governance_retention_policies (
  id uuid primary key default gen_random_uuid(), policy_code text not null unique,
  target_table text not null unique, retention_days integer not null check (retention_days between 30 and 36500),
  terminal_statuses text[] not null default '{}', date_column text not null default 'created_at',
  action text not null default 'DELETE' check (action in ('DELETE','ANONYMIZE')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.governance_retention_runs (
  id uuid primary key default gen_random_uuid(), run_code text not null unique,
  mode text not null check (mode in ('PREVIEW','APPLY')), preview_run_id uuid references public.governance_retention_runs(id) on delete restrict,
  status text not null check (status in ('RUNNING','COMPLETED','FAILED')),
  matched_count integer not null default 0 check (matched_count >= 0), affected_count integer not null default 0 check (affected_count >= 0),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  requested_by_id uuid references public.profiles(id) on delete set null, requested_by_email text,
  started_at timestamptz not null default now(), completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.governance_operational_checks (
  id uuid primary key default gen_random_uuid(), check_code text not null unique,
  check_name text not null, check_type text not null, status text not null check (status in ('PASS','WARN','FAIL')),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  checked_by_id uuid references public.profiles(id) on delete set null, checked_by_email text, checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null
);

create table public.integration_outbox (
  id uuid primary key default gen_random_uuid(), integration_code text not null unique,
  idempotency_key text not null unique, event_type text not null, target_module text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'), status text not null default 'PENDING' check (status in ('PENDING','PROCESSING','COMPLETED','ERROR','DEAD','CANCELLED')),
  attempt_count integer not null default 0 check (attempt_count >= 0), max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  next_attempt_at timestamptz, last_error text, result_record_id text, result_payload jsonb,
  processed_at timestamptz, cancelled_at timestamptz, cancelled_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null
);

create table public.record_links (
  id uuid primary key default gen_random_uuid(), link_code text not null unique,
  source_module text not null, source_record_id text not null, target_module text not null, target_record_id text not null,
  link_type text not null, status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null,
  constraint record_links_unique unique (source_module, source_record_id, target_module, target_record_id, link_type)
);

create index governance_data_assets_class_idx on public.governance_data_assets(classification, status);
create index destruction_requests_status_idx on public.data_destruction_requests(status, requested_at);
create index compliance_obligations_law_idx on public.compliance_obligations(law_id);
create index corrective_actions_due_idx on public.compliance_corrective_actions(status, due_date);
create index privacy_dsr_due_idx on public.privacy_dsr(status, due_date);
create index governance_risks_score_idx on public.governance_risks(status, risk_score desc);
create index evidence_items_control_idx on public.governance_evidence_items(control_id, status);
create index audit_findings_audit_idx on public.audit_findings(audit_id, status);
create index integration_outbox_worker_idx on public.integration_outbox(status, next_attempt_at, created_at);
create index record_links_source_idx on public.record_links(source_module, source_record_id);
create index record_links_target_idx on public.record_links(target_module, target_record_id);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'governance_data_assets','data_destruction_requests','legal_register','compliance_obligations','compliance_assessments',
    'compliance_corrective_actions','privacy_ropa','privacy_consents','privacy_dsr','governance_risks','governance_ai_tools',
    'governance_cloud_services','governance_training_plans','governance_training_records','policy_acknowledgements',
    'governance_controls','governance_evidence_items','audit_engagements','audit_findings','governance_document_templates',
    'governance_documents','employee_lifecycle_events','governance_retention_policies','governance_operational_checks',
    'integration_outbox','record_links'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', 'trg_' || table_name || '_set_updated_at', table_name);
  end loop;
end $$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'governance_data_assets','data_destruction_requests','legal_register','compliance_obligations','compliance_assessments',
    'compliance_corrective_actions','privacy_ropa','privacy_consents','privacy_dsr','governance_risks','governance_ai_tools',
    'governance_cloud_services','governance_training_plans','governance_training_records','policy_acknowledgements',
    'governance_controls','governance_evidence_items','audit_engagements','audit_findings','governance_document_templates',
    'governance_documents','employee_lifecycle_events','governance_retention_policies','governance_retention_runs',
    'governance_operational_checks','integration_outbox','record_links'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

-- RLS is intentionally enforced in the database as well as in the API.
do $$
declare item text[];
begin
  foreach item slice 1 in array array[
    array['governance_data_assets','data_class.view','data_class.manage'], array['data_destruction_requests','data_class.view','data_class.manage'],
    array['legal_register','compliance.view','compliance.manage'], array['compliance_obligations','compliance.view','compliance.manage'],
    array['compliance_assessments','compliance.view','compliance.manage'], array['compliance_corrective_actions','compliance.view','compliance.manage'],
    array['privacy_ropa','privacy.view','privacy.manage'], array['privacy_consents','privacy.view','privacy.manage'], array['privacy_dsr','privacy.view','privacy.manage'],
    array['governance_risks','risk.view','risk.manage'], array['governance_ai_tools','ai_cloud.view','ai_cloud.manage'], array['governance_cloud_services','ai_cloud.view','ai_cloud.manage'],
    array['governance_training_plans','awareness.view','awareness.manage'], array['governance_training_records','awareness.view','awareness.manage'],
    array['audit_engagements','audit_management.view','audit_management.manage'], array['audit_findings','audit_management.view','audit_management.manage'],
    array['governance_document_templates','governance_document.view','governance_document.manage'], array['governance_documents','governance_document.view','governance_document.manage'],
    array['employee_lifecycle_events','operations.view','operations.manage'], array['governance_retention_policies','operations.view','operations.manage'],
    array['governance_operational_checks','operations.view','operations.manage'],
    array['integration_outbox','integration.view','integration.manage'], array['record_links','integration.view','integration.manage']
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.has_permission(%L))', item[1] || '_select', item[1], item[2]);
    execute format('create policy %I on public.%I for all to authenticated using (public.has_permission(%L)) with check (public.has_permission(%L))', item[1] || '_write', item[1], item[3], item[3]);
  end loop;
end $$;

create policy governance_controls_select on public.governance_controls
  for select to authenticated using (public.has_permission('evidence.view'));
create policy governance_evidence_items_select on public.governance_evidence_items
  for select to authenticated using (public.has_permission('evidence.view'));
create policy governance_retention_runs_select on public.governance_retention_runs
  for select to authenticated using (public.has_permission('operations.view'));

create policy policy_ack_manage_all on public.policy_acknowledgements
  for all to authenticated
  using (public.has_permission('awareness.manage'))
  with check (public.has_permission('awareness.manage'));

-- Employees can create/read only their own legally-binding acknowledgement.
create policy policy_ack_self_select on public.policy_acknowledgements
  for select to authenticated using (acknowledger_id = auth.uid() and public.has_permission('awareness.participate'));
create policy policy_ack_self_insert on public.policy_acknowledgements
  for insert to authenticated with check (acknowledger_id = auth.uid() and confirmed and public.has_permission('awareness.participate'));

-- Retention requires a recent preview. APPLY currently covers only governed,
-- terminal integration messages; business records are never silently deleted.
create or replace function public.run_governance_retention(
  apply_changes boolean, preview_run_id_input uuid default null,
  requested_by_input uuid default null, requested_by_email_input text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_id uuid := gen_random_uuid(); v_code text; v_count integer := 0; v_affected integer := 0; v_preview record;
begin
  v_code := 'RET-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad((floor(random()*9000)+1000)::text, 4, '0');
  select count(*) into v_count from public.integration_outbox
    where status in ('COMPLETED','CANCELLED','DEAD') and created_at < now() - interval '365 days';
  if apply_changes then
    if preview_run_id_input is null then raise exception 'preview_run_id is required'; end if;
    select * into v_preview from public.governance_retention_runs where id = preview_run_id_input and mode = 'PREVIEW' and status = 'COMPLETED';
    if not found or v_preview.completed_at < now() - interval '1 hour' then raise exception 'a completed preview from the last hour is required'; end if;
    if v_preview.matched_count <> v_count then raise exception 'retention candidates changed; run preview again'; end if;
    delete from public.integration_outbox where status in ('COMPLETED','CANCELLED','DEAD') and created_at < now() - interval '365 days';
    get diagnostics v_affected = row_count;
  end if;
  insert into public.governance_retention_runs(id,run_code,mode,preview_run_id,status,matched_count,affected_count,detail,requested_by_id,requested_by_email,completed_at)
  values(v_id,v_code,case when apply_changes then 'APPLY' else 'PREVIEW' end,preview_run_id_input,'COMPLETED',v_count,v_affected,
    jsonb_build_object('scope','terminal integration_outbox older than 365 days','designerDeferred',true),requested_by_input,requested_by_email_input,now());
  return jsonb_build_object('id',v_id,'runCode',v_code,'mode',case when apply_changes then 'APPLY' else 'PREVIEW' end,'matched',v_count,'affected',v_affected);
end $$;

revoke all on function public.run_governance_retention(boolean,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.run_governance_retention(boolean,uuid,uuid,text) to service_role;

insert into public.governance_retention_policies(policy_code,target_table,retention_days,terminal_statuses,date_column,action)
values ('RET-OUTBOX-365','integration_outbox',365,array['COMPLETED','CANCELLED','DEAD'],'created_at','DELETE')
on conflict (policy_code) do nothing;

insert into public.governance_document_templates(template_code,name,version,designer_mode,design_schema,status)
values ('POST-GOLIVE-DESIGNER','Governance document metadata template',1,'STRUCTURED_METADATA',
  '{"schemaVersion":1,"designerDeferredUntil":"post-go-live","sections":[]}'::jsonb,'DEFERRED')
on conflict (template_code,version) do nothing;

insert into public.governance_controls(control_code,domain,title,requirement,owner,frequency,status)
values
  ('CTL-DATA-01','Data Classification','จัดชั้นและทำลายข้อมูลตามอนุมัติ','มีผู้อนุมัติและหลักฐาน HTTPS','IT / DPO','รายไตรมาส','ใช้งาน'),
  ('CTL-LEGAL-01','Legal Compliance','ทบทวนข้อกำหนดและ CAPA','Evidence Health ไม่ใช่คำรับรองทางกฎหมาย','DPO / Compliance','รายไตรมาส','ใช้งาน'),
  ('CTL-PDPA-01','Privacy','RoPA, Consent และ DSR','ติดตาม DSR ภายในกรอบเวลา','DPO','รายเดือน','ใช้งาน'),
  ('CTL-RISK-01','Risk','ประเมินความเสี่ยง 5x5 และ residual risk','คะแนนอยู่ในช่วง 1-25','Risk Owner','รายไตรมาส','ใช้งาน'),
  ('CTL-AUDIT-01','Audit','ผู้ตรวจยืนยันเป็นอิสระจากเจ้าของข้อค้นพบ','บังคับ Segregation of Duties','Internal Audit','ตามแผน Audit','ใช้งาน'),
  ('CTL-OPS-01','Operations','Retention, JML และ operational health','Retention ต้อง Preview ก่อน Apply','IT','รายเดือน','ใช้งาน')
on conflict (control_code) do nothing;

insert into public.governance_operational_checks
  (check_code,check_name,check_type,status,detail,checked_at)
values
  ('OPS-BASELINE','Operational health entry point','BASELINE','WARN',
   '{"message":"Run health-check after applying the migration"}'::jsonb,now())
on conflict (check_code) do nothing;

insert into public.governance_retention_runs
  (run_code,mode,status,matched_count,affected_count,detail,completed_at)
values
  ('RET-BASELINE','PREVIEW','COMPLETED',0,0,
   '{"scope":"baseline only; run Preview before Apply","designerDeferred":true}'::jsonb,now())
on conflict (run_code) do nothing;
