-- Governance Center P0/P1: connect the existing registers into one evidence chain.
-- No new domain is introduced. The migration adds governed relationships and the
-- workflows that were intentionally missing from the first Governance release.

-- -----------------------------------------------------------------------------
-- Relationship spine: Risk -> Control -> Evidence -> Finding -> CAPA -> Change
-- -----------------------------------------------------------------------------
alter table public.governance_risks
  add column if not exists control_id uuid references public.governance_controls(id) on delete set null;

alter table public.audit_findings
  add column if not exists risk_id uuid references public.governance_risks(id) on delete set null,
  add column if not exists control_id uuid references public.governance_controls(id) on delete set null,
  add column if not exists evidence_id uuid references public.governance_evidence_items(id) on delete set null;

alter table public.compliance_corrective_actions
  add column if not exists finding_id uuid references public.audit_findings(id) on delete set null,
  add column if not exists control_id uuid references public.governance_controls(id) on delete set null,
  add column if not exists change_request_id uuid references public.change_requests(id) on delete set null;

create table public.governance_control_tests (
  id uuid primary key default gen_random_uuid(),
  test_code text not null unique,
  control_id uuid not null references public.governance_controls(id) on delete restrict,
  evidence_id uuid references public.governance_evidence_items(id) on delete set null,
  finding_id uuid references public.audit_findings(id) on delete set null,
  test_date date not null default current_date,
  tester_id uuid references public.profiles(id) on delete set null,
  tester_email text,
  test_procedure text not null,
  sample_size integer check (sample_size is null or sample_size >= 0),
  result text not null default 'ไม่ผ่าน' check (result in ('ผ่าน','บางส่วน','ไม่ผ่าน')),
  status text not null default 'รอตรวจยืนยัน' check (status in ('ร่าง','รอตรวจยืนยัน','ยืนยันแล้ว')),
  notes text,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_by_email text,
  verified_at timestamptz,
  verification_evidence_url text check (verification_evidence_url is null or verification_evidence_url like 'https://%'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.governance_evidence_items
  add column if not exists finding_id uuid references public.audit_findings(id) on delete set null,
  add column if not exists control_test_id uuid references public.governance_control_tests(id) on delete set null;

create index if not exists governance_risks_control_idx on public.governance_risks(control_id);
create index if not exists audit_findings_governance_chain_idx on public.audit_findings(risk_id, control_id, evidence_id);
create index if not exists corrective_actions_governance_chain_idx on public.compliance_corrective_actions(finding_id, control_id, change_request_id);
create index governance_control_tests_control_idx on public.governance_control_tests(control_id, status, test_date desc);
create index governance_evidence_expiry_idx on public.governance_evidence_items(expires_at, status);

-- -----------------------------------------------------------------------------
-- Risk acceptance approval
-- -----------------------------------------------------------------------------
create table public.governance_risk_acceptances (
  id uuid primary key default gen_random_uuid(),
  acceptance_code text not null unique,
  risk_id uuid not null references public.governance_risks(id) on delete restrict,
  rationale text not null,
  expires_at date not null,
  requested_by_id uuid references public.profiles(id) on delete set null,
  requested_by_email text,
  requested_at timestamptz not null default now(),
  status text not null default 'รออนุมัติ' check (status in ('รออนุมัติ','อนุมัติ','ปฏิเสธ','หมดอายุ','ยกเลิก')),
  approved_by_id uuid references public.profiles(id) on delete set null,
  approved_by_email text,
  approved_at timestamptz,
  approval_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint risk_acceptance_approval_consistent check (
    (status = 'รออนุมัติ' and approved_at is null) or
    (status in ('อนุมัติ','ปฏิเสธ') and approved_at is not null) or
    status in ('หมดอายุ','ยกเลิก')
  )
);

create unique index governance_risk_acceptance_pending_unique
  on public.governance_risk_acceptances(risk_id)
  where status = 'รออนุมัติ';
create index governance_risk_acceptance_status_idx
  on public.governance_risk_acceptances(status, expires_at);

-- -----------------------------------------------------------------------------
-- PDPA DPIA workflow, annual attestation and governance calendar
-- -----------------------------------------------------------------------------
create table public.privacy_dpia_assessments (
  id uuid primary key default gen_random_uuid(),
  dpia_code text not null unique,
  ropa_id uuid not null references public.privacy_ropa(id) on delete restrict,
  data_asset_id uuid references public.governance_data_assets(id) on delete set null,
  screening_result text not null check (screening_result in ('ต้องทำ DPIA','ไม่ต้องทำ DPIA','ต้องทบทวน')),
  risk_level text not null check (risk_level in ('ต่ำ','ปานกลาง','สูง','วิกฤต')),
  owner text not null,
  due_date date,
  processing_description text,
  necessity_proportionality text,
  safeguards text,
  residual_risk text,
  evidence_url text check (evidence_url is null or evidence_url like 'https://%'),
  status text not null default 'ร่าง' check (status in ('ร่าง','รอตรวจ','อนุมัติ','ต้องแก้ไข','ยกเลิก')),
  requested_by_id uuid references public.profiles(id) on delete set null,
  requested_by_email text,
  submitted_at timestamptz,
  approved_by_id uuid references public.profiles(id) on delete set null,
  approved_by_email text,
  approved_at timestamptz,
  approval_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint dpia_submission_consistent check (status = 'ร่าง' or submitted_at is not null),
  constraint dpia_approval_consistent check (status not in ('อนุมัติ','ต้องแก้ไข') or approved_at is not null)
);

create index privacy_dpia_workflow_idx on public.privacy_dpia_assessments(status, due_date);

create table public.governance_annual_attestations (
  id uuid primary key default gen_random_uuid(),
  attestation_code text not null unique,
  attestation_year integer not null check (attestation_year between 2020 and 2200),
  scope text not null,
  statement text not null,
  attestor_id uuid not null references public.profiles(id) on delete restrict,
  attestor_email text,
  status text not null default 'ร่าง' check (status in ('ร่าง','ส่งตรวจ','อนุมัติ','ปฏิเสธ')),
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_by_email text,
  reviewed_at timestamptz,
  review_comment text,
  evidence_url text check (evidence_url is null or evidence_url like 'https://%'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint annual_attestation_submission_consistent check (status = 'ร่าง' or submitted_at is not null),
  constraint annual_attestation_review_consistent check (status not in ('อนุมัติ','ปฏิเสธ') or reviewed_at is not null),
  constraint annual_attestation_scope_unique unique (attestation_year, scope)
);

create index annual_attestation_status_idx on public.governance_annual_attestations(status, attestation_year desc);

create table public.governance_calendar_events (
  id uuid primary key default gen_random_uuid(),
  event_code text not null unique,
  title text not null,
  event_type text not null check (event_type in ('ทบทวนความเสี่ยง','ทดสอบ Control','ทบทวนหลักฐาน','Audit','DPIA','DSR','Attestation','อื่นๆ')),
  domain text not null,
  start_date date not null,
  end_date date not null,
  owner text,
  related_record_type text,
  related_record_id text,
  status text not null default 'วางแผน' check (status in ('วางแผน','กำลังดำเนินการ','เสร็จสิ้น','ยกเลิก')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint governance_calendar_date_order check (end_date >= start_date)
);

create index governance_calendar_date_idx on public.governance_calendar_events(start_date, end_date, status);

-- -----------------------------------------------------------------------------
-- Permissions and RLS
-- -----------------------------------------------------------------------------
insert into public.permissions (key, module_key, action, description, status) values
  ('evidence.manage', 'evidence', 'manage', 'จัดการ Control Library, Control Test และ Evidence', 'active'),
  ('risk.accept', 'risk', 'accept', 'อนุมัติหรือปฏิเสธ Risk Acceptance', 'active')
on conflict (key) do update set module_key = excluded.module_key, action = excluded.action,
  description = excluded.description, status = excluded.status;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'governance_control_tests','governance_risk_acceptances','privacy_dpia_assessments',
    'governance_annual_attestations','governance_calendar_events'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', 'trg_' || table_name || '_set_updated_at', table_name);
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

create policy governance_controls_write on public.governance_controls
  for all to authenticated using (public.has_permission('evidence.manage'))
  with check (public.has_permission('evidence.manage'));

create policy governance_evidence_items_write on public.governance_evidence_items
  for all to authenticated using (public.has_permission('evidence.manage'))
  with check (public.has_permission('evidence.manage'));

create policy governance_control_tests_select on public.governance_control_tests
  for select to authenticated using (public.has_permission('evidence.view'));
create policy governance_control_tests_write on public.governance_control_tests
  for all to authenticated using (public.has_permission('evidence.manage'))
  with check (public.has_permission('evidence.manage'));

create policy governance_risk_acceptances_select on public.governance_risk_acceptances
  for select to authenticated using (public.has_permission('risk.view'));
create policy governance_risk_acceptances_write on public.governance_risk_acceptances
  for all to authenticated using (public.has_permission('risk.manage') or public.has_permission('risk.accept'))
  with check (public.has_permission('risk.manage') or public.has_permission('risk.accept'));

create policy privacy_dpia_select on public.privacy_dpia_assessments
  for select to authenticated using (public.has_permission('privacy.view'));
create policy privacy_dpia_write on public.privacy_dpia_assessments
  for all to authenticated using (public.has_permission('privacy.manage'))
  with check (public.has_permission('privacy.manage'));

create policy annual_attestation_select on public.governance_annual_attestations
  for select to authenticated using (public.has_permission('compliance.view'));
create policy annual_attestation_write on public.governance_annual_attestations
  for all to authenticated using (public.has_permission('compliance.manage'))
  with check (public.has_permission('compliance.manage'));

create policy governance_calendar_select on public.governance_calendar_events
  for select to authenticated using (public.has_permission('operations.view'));
create policy governance_calendar_write on public.governance_calendar_events
  for all to authenticated using (public.has_permission('operations.manage'))
  with check (public.has_permission('operations.manage'));

comment on table public.governance_control_tests is 'Control effectiveness tests with independent verification evidence.';
comment on table public.governance_risk_acceptances is 'Time-bounded risk acceptance requests and approval evidence.';
comment on table public.privacy_dpia_assessments is 'DPIA workflow linked to a RoPA record and optional classified data asset.';
comment on table public.governance_annual_attestations is 'Annual governance attestation with reviewer evidence.';
comment on table public.governance_calendar_events is 'Governance calendar milestones across the existing domains.';

