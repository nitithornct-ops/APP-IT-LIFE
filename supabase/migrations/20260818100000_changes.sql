-- ============================================================================
-- Phase 6 Module 12: Change Management
-- Workflow: Request -> Test sign-off -> Independent approval -> Deploy
-- Ground truth: legacy-gas/Module_Change.gs, Change.html, Config.gs > DB_SCHEMA
-- Segregation of duties is enforced again at database level.
-- ============================================================================

create table public.change_requests (
  id uuid primary key default gen_random_uuid(),
  change_number text not null unique,
  legacy_id text unique,
  title text not null check (char_length(title) <= 200),
  system_affected text not null check (char_length(system_affected) between 1 and 150),
  change_type text check (char_length(change_type) <= 60),
  description text not null check (char_length(description) between 1 and 3000),
  requester_id uuid not null references public.profiles(id) on delete restrict,
  request_date timestamptz not null default now(),
  impact_assessment text check (char_length(impact_assessment) <= 2000),
  risk_level text not null default 'ต่ำ' check (risk_level in ('สูง', 'กลาง', 'ต่ำ')),
  test_result text check (char_length(test_result) <= 1000),
  test_passed boolean,
  test_signoff_by uuid references public.profiles(id) on delete restrict,
  test_signoff_at timestamptz,
  approver_id uuid references public.profiles(id) on delete restrict,
  approve_date timestamptz,
  approve_result text check (approve_result is null or approve_result in ('อนุมัติ', 'ปฏิเสธ')),
  approval_comment text check (char_length(approval_comment) <= 500),
  deploy_date timestamptz,
  deploy_by uuid references public.profiles(id) on delete restrict,
  version text check (char_length(version) <= 60),
  rollback_plan text check (char_length(rollback_plan) <= 2000),
  status text not null default 'ยื่นคำขอ' check (status in ('ยื่นคำขอ', 'ผ่านการทดสอบ', 'อนุมัติแล้ว', 'ติดตั้งใช้งานแล้ว', 'ปฏิเสธ')),
  source_service_request_id uuid unique references public.service_requests(id) on delete set null,
  legacy_source_service_request_id text,
  workflow_instance_legacy_id text,
  notes text check (char_length(notes) <= 1500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint change_requests_test_fields_consistent check (
    status = 'ยื่นคำขอ'
    or (test_result is not null and test_passed is true and test_signoff_by is not null and test_signoff_at is not null)
  ),
  constraint change_requests_approval_fields_consistent check (
    status not in ('อนุมัติแล้ว', 'ปฏิเสธ', 'ติดตั้งใช้งานแล้ว')
    or (approver_id is not null and approve_date is not null and approve_result is not null)
  ),
  constraint change_requests_deploy_fields_consistent check (
    status <> 'ติดตั้งใช้งานแล้ว'
    or (deploy_by is not null and deploy_date is not null and version is not null)
  ),
  constraint change_requests_rejection_comment_required check (
    status <> 'ปฏิเสธ' or (approve_result = 'ปฏิเสธ' and approval_comment is not null)
  )
);

create index change_requests_status_idx on public.change_requests (status);
create index change_requests_requester_id_idx on public.change_requests (requester_id);
create index change_requests_risk_level_idx on public.change_requests (risk_level);
create index change_requests_request_date_idx on public.change_requests (request_date desc);

create trigger trg_change_requests_set_updated_at
  before update on public.change_requests
  for each row execute function public.set_updated_at();

create or replace function public.enforce_change_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'ยื่นคำขอ' then
      raise exception 'CHANGE_MUST_START_REQUESTED';
    end if;
    return new;
  end if;

  if new.change_number is distinct from old.change_number
     or new.requester_id is distinct from old.requester_id
     or new.request_date is distinct from old.request_date then
    raise exception 'CHANGE_PROVENANCE_IMMUTABLE';
  end if;

  if new.status = old.status then
    if old.status <> 'ยื่นคำขอ' then
      raise exception 'CHANGE_TERMINAL_OR_LOCKED';
    end if;
    if new.test_signoff_by is not null and new.test_signoff_by = new.requester_id then
      raise exception 'CHANGE_REQUESTER_CANNOT_TEST';
    end if;
    return new;
  end if;

  if old.status = 'ยื่นคำขอ' and new.status = 'ผ่านการทดสอบ' then
    if new.test_result is null or new.test_passed is not true or new.test_signoff_by is null or new.test_signoff_at is null then
      raise exception 'CHANGE_TEST_EVIDENCE_REQUIRED';
    end if;
    if new.test_signoff_by = new.requester_id then
      raise exception 'CHANGE_REQUESTER_CANNOT_TEST';
    end if;
    return new;
  end if;

  if old.status = 'ผ่านการทดสอบ' and new.status in ('อนุมัติแล้ว', 'ปฏิเสธ') then
    if new.approver_id is null or new.approve_date is null or new.approve_result is null then
      raise exception 'CHANGE_APPROVAL_EVIDENCE_REQUIRED';
    end if;
    if new.approver_id = new.requester_id then
      raise exception 'CHANGE_REQUESTER_CANNOT_APPROVE';
    end if;
    if new.approver_id = new.test_signoff_by then
      raise exception 'CHANGE_TESTER_CANNOT_APPROVE';
    end if;
    if new.status = 'อนุมัติแล้ว' and new.approve_result <> 'อนุมัติ' then
      raise exception 'CHANGE_APPROVAL_RESULT_MISMATCH';
    end if;
    if new.status = 'ปฏิเสธ' and (new.approve_result <> 'ปฏิเสธ' or new.approval_comment is null) then
      raise exception 'CHANGE_REJECTION_REASON_REQUIRED';
    end if;
    return new;
  end if;

  if old.status = 'อนุมัติแล้ว' and new.status = 'ติดตั้งใช้งานแล้ว' then
    if new.deploy_by is null or new.deploy_date is null or new.version is null then
      raise exception 'CHANGE_DEPLOY_EVIDENCE_REQUIRED';
    end if;
    if new.deploy_by = new.approver_id then
      raise exception 'CHANGE_APPROVER_CANNOT_DEPLOY';
    end if;
    return new;
  end if;

  raise exception 'CHANGE_INVALID_TRANSITION:%->%', old.status, new.status;
end;
$$;

create trigger trg_change_requests_enforce_workflow
  before insert or update on public.change_requests
  for each row execute function public.enforce_change_workflow();

alter table public.change_requests enable row level security;

create policy change_requests_select_with_permission on public.change_requests
  for select to authenticated
  using (public.has_permission('change.view'));

create policy change_requests_insert_own on public.change_requests
  for insert to authenticated
  with check (requester_id = auth.uid() and public.has_permission('change.create'));

-- Workflow updates use the Workers service role only after granular permission checks.
-- The database trigger still enforces ordering and segregation of duties for every write path.

create policy file_attachments_select_change_participant on public.file_attachments
  for select to authenticated
  using (
    module = 'change' and target_table = 'change_requests'
    and exists (
      select 1 from public.change_requests c where c.id::text = file_attachments.target_id
    )
  );
