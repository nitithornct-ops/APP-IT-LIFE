-- Auditable business records must remain available for investigations and reviews.
-- This migration also moves the shared record-deletion endpoint behind one RPC so
-- the mutation and its audit row either both commit or both roll back.

alter table public.incidents
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users(id) on delete set null,
  add column archive_reason text check (archive_reason is null or char_length(archive_reason) between 3 and 1000);

alter table public.change_requests
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users(id) on delete set null,
  add column archive_reason text check (archive_reason is null or char_length(archive_reason) between 3 and 1000);

alter table public.workflow_definitions
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users(id) on delete set null,
  add column archive_reason text check (archive_reason is null or char_length(archive_reason) between 3 and 1000);

alter table public.workflow_instances
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users(id) on delete set null,
  add column archive_reason text check (archive_reason is null or char_length(archive_reason) between 3 and 1000);

alter table public.backup_logs
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users(id) on delete set null,
  add column archive_reason text check (archive_reason is null or char_length(archive_reason) between 3 and 1000);

alter table public.recovery_tests
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users(id) on delete set null,
  add column archive_reason text check (archive_reason is null or char_length(archive_reason) between 3 and 1000);

alter table public.bcp_plans
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users(id) on delete set null,
  add column archive_reason text check (archive_reason is null or char_length(archive_reason) between 3 and 1000);

alter table public.logging_systems
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users(id) on delete set null,
  add column archive_reason text check (archive_reason is null or char_length(archive_reason) between 3 and 1000);

alter table public.log_reviews
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users(id) on delete set null,
  add column archive_reason text check (archive_reason is null or char_length(archive_reason) between 3 and 1000);

-- Tickets already use deleted_at. Retain who performed that soft delete and why.
alter table public.tickets
  add column deletion_reason text check (deletion_reason is null or char_length(deletion_reason) between 3 and 1000),
  add column deleted_by uuid references auth.users(id) on delete set null;

create index incidents_active_report_date_idx on public.incidents (report_date desc) where archived_at is null;
create index change_requests_active_request_date_idx on public.change_requests (request_date desc) where archived_at is null;
create index workflow_definitions_active_code_idx on public.workflow_definitions (workflow_code) where archived_at is null;
create index workflow_instances_active_started_at_idx on public.workflow_instances (started_at desc) where archived_at is null;
create index backup_logs_active_date_idx on public.backup_logs (backup_date desc) where archived_at is null;
create index recovery_tests_active_date_idx on public.recovery_tests (test_date desc) where archived_at is null;
create index bcp_plans_active_created_at_idx on public.bcp_plans (created_at desc) where archived_at is null;
create index logging_systems_active_code_idx on public.logging_systems (log_system_code) where archived_at is null;
create index log_reviews_active_date_idx on public.log_reviews (review_date desc) where archived_at is null;

alter table public.incidents add constraint incidents_archive_metadata_complete check (
  (archived_at is null and archived_by is null and archive_reason is null)
  or (archived_at is not null and archive_reason is not null)
);
alter table public.change_requests add constraint change_requests_archive_metadata_complete check (
  (archived_at is null and archived_by is null and archive_reason is null)
  or (archived_at is not null and archive_reason is not null)
);
alter table public.workflow_definitions add constraint workflow_definitions_archive_metadata_complete check (
  (archived_at is null and archived_by is null and archive_reason is null)
  or (archived_at is not null and archive_reason is not null)
);
alter table public.workflow_instances add constraint workflow_instances_archive_metadata_complete check (
  (archived_at is null and archived_by is null and archive_reason is null)
  or (archived_at is not null and archive_reason is not null)
);
alter table public.backup_logs add constraint backup_logs_archive_metadata_complete check (
  (archived_at is null and archived_by is null and archive_reason is null)
  or (archived_at is not null and archive_reason is not null)
);
alter table public.recovery_tests add constraint recovery_tests_archive_metadata_complete check (
  (archived_at is null and archived_by is null and archive_reason is null)
  or (archived_at is not null and archive_reason is not null)
);
alter table public.bcp_plans add constraint bcp_plans_archive_metadata_complete check (
  (archived_at is null and archived_by is null and archive_reason is null)
  or (archived_at is not null and archive_reason is not null)
);
alter table public.logging_systems add constraint logging_systems_archive_metadata_complete check (
  (archived_at is null and archived_by is null and archive_reason is null)
  or (archived_at is not null and archive_reason is not null)
);
alter table public.log_reviews add constraint log_reviews_archive_metadata_complete check (
  (archived_at is null and archived_by is null and archive_reason is null)
  or (archived_at is not null and archive_reason is not null)
);

drop policy incidents_update_manage on public.incidents;
create policy incidents_update_manage on public.incidents for update to authenticated
  using (public.has_permission('incident.manage') and archived_at is null)
  with check (public.has_permission('incident.manage') and archived_at is null);

-- The original FOR ALL policies also granted DELETE to permissioned browser
-- sessions. Split them so destructive actions can only pass through the audited
-- service-role RPC. Archived rows are read-only through ordinary JWT sessions.
drop policy backup_logs_write_with_permission on public.backup_logs;
create policy backup_logs_insert_with_permission on public.backup_logs for insert to authenticated
  with check (public.has_permission('backup.manage') and archived_at is null);
create policy backup_logs_update_with_permission on public.backup_logs for update to authenticated
  using (public.has_permission('backup.manage') and archived_at is null)
  with check (public.has_permission('backup.manage') and archived_at is null);

drop policy recovery_tests_write_with_permission on public.recovery_tests;
create policy recovery_tests_insert_with_permission on public.recovery_tests for insert to authenticated
  with check (public.has_permission('backup.manage') and archived_at is null);
create policy recovery_tests_update_with_permission on public.recovery_tests for update to authenticated
  using (public.has_permission('backup.manage') and archived_at is null)
  with check (public.has_permission('backup.manage') and archived_at is null);

drop policy bcp_plans_write_with_permission on public.bcp_plans;
create policy bcp_plans_insert_with_permission on public.bcp_plans for insert to authenticated
  with check (public.has_permission('backup.manage') and archived_at is null);
create policy bcp_plans_update_with_permission on public.bcp_plans for update to authenticated
  using (public.has_permission('backup.manage') and archived_at is null)
  with check (public.has_permission('backup.manage') and archived_at is null);

drop policy logging_systems_write_with_permission on public.logging_systems;
create policy logging_systems_insert_with_permission on public.logging_systems for insert to authenticated
  with check (public.has_permission('monitoring.manage') and archived_at is null);
create policy logging_systems_update_with_permission on public.logging_systems for update to authenticated
  using (public.has_permission('monitoring.manage') and archived_at is null)
  with check (public.has_permission('monitoring.manage') and archived_at is null);

drop policy log_reviews_write_with_permission on public.log_reviews;
create policy log_reviews_insert_with_permission on public.log_reviews for insert to authenticated
  with check (public.has_permission('monitoring.manage') and archived_at is null);
create policy log_reviews_update_with_permission on public.log_reviews for update to authenticated
  using (public.has_permission('monitoring.manage') and archived_at is null)
  with check (public.has_permission('monitoring.manage') and archived_at is null);

drop policy workflow_definitions_write on public.workflow_definitions;
create policy workflow_definitions_insert_manage on public.workflow_definitions for insert to authenticated
  with check (public.has_permission('workflow.manage') and archived_at is null);
create policy workflow_definitions_update_manage on public.workflow_definitions for update to authenticated
  using (public.has_permission('workflow.manage') and archived_at is null)
  with check (public.has_permission('workflow.manage') and archived_at is null);

drop policy workflow_steps_write on public.workflow_steps;
create policy workflow_steps_insert_manage on public.workflow_steps for insert to authenticated
  with check (public.has_permission('workflow.manage'));
create policy workflow_steps_update_manage on public.workflow_steps for update to authenticated
  using (public.has_permission('workflow.manage'))
  with check (public.has_permission('workflow.manage'));

drop policy workflow_instances_write on public.workflow_instances;
create policy workflow_instances_insert_manage on public.workflow_instances for insert to authenticated
  with check (public.has_permission('workflow.manage') and archived_at is null);
create policy workflow_instances_update_manage on public.workflow_instances for update to authenticated
  using (public.has_permission('workflow.manage') and archived_at is null)
  with check (public.has_permission('workflow.manage') and archived_at is null);

revoke delete on public.backup_logs, public.recovery_tests, public.bcp_plans,
  public.logging_systems, public.log_reviews, public.workflow_definitions,
  public.workflow_steps, public.workflow_instances from authenticated;

-- The original Change workflow trigger locks terminal records. Archiving is an
-- audit-only metadata update, so explicitly permit only that narrow mutation.
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

  if new.archived_at is distinct from old.archived_at
     and old.archived_at is null
     and new.archived_at is not null
     and nullif(btrim(new.archive_reason), '') is not null
     and new.archived_by is not null
     and (to_jsonb(new) - array['archived_at', 'archived_by', 'archive_reason', 'updated_at', 'updated_by'])
       = (to_jsonb(old) - array['archived_at', 'archived_by', 'archive_reason', 'updated_at', 'updated_by']) then
    return new;
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

create or replace function public.mutate_record_deletion(
  resource_input text,
  record_id_input uuid,
  actor_id_input uuid,
  actor_email_input text,
  reason_input text,
  request_id_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_table text;
  target_module text;
  deletion_mode text := 'hard';
  before_row jsonb;
  affected_rows integer := 0;
  previous_status text;
  workflow_action text;
  now_value timestamptz := clock_timestamp();
begin
  reason_input := btrim(reason_input);
  if reason_input is null or char_length(reason_input) < 3 or char_length(reason_input) > 1000 then
    raise exception using errcode = '22023', message = 'RECORD_DELETION_REASON_INVALID';
  end if;

  case resource_input
    when 'access-requests' then target_table := 'access_requests'; target_module := 'access-request';
    when 'access-registry' then target_table := 'user_access_registry'; target_module := 'access-registry';
    when 'access-systems' then target_table := 'access_systems'; target_module := 'access-system';
    when 'approval-groups' then target_table := 'approval_groups'; target_module := 'approval-group';
    when 'asset-categories' then target_table := 'asset_categories'; target_module := 'asset-category';
    when 'assets' then target_table := 'assets'; target_module := 'asset';
    when 'backup-logs' then target_table := 'backup_logs'; target_module := 'backup'; deletion_mode := 'archive';
    when 'bcp-plans' then target_table := 'bcp_plans'; target_module := 'backup'; deletion_mode := 'archive';
    when 'cause-codes' then target_table := 'ticket_cause_codes'; target_module := 'cause-code';
    when 'changes' then target_table := 'change_requests'; target_module := 'change'; deletion_mode := 'archive';
    when 'ci-relationships' then target_table := 'ci_relationships'; target_module := 'cmdb';
    when 'configuration-items' then target_table := 'configuration_items'; target_module := 'cmdb';
    when 'contracts' then target_table := 'contracts'; target_module := 'contract';
    when 'departments' then target_table := 'departments'; target_module := 'department';
    when 'employee-assignments' then target_table := 'employee_assignments'; target_module := 'employee-assignment';
    when 'employees' then target_table := 'employees'; target_module := 'employee';
    when 'form-templates' then target_table := 'form_templates'; target_module := 'form';
    when 'incidents' then target_table := 'incidents'; target_module := 'incident'; deletion_mode := 'archive';
    when 'inventory-items' then target_table := 'inventory_items'; target_module := 'inventory';
    when 'issue-forms' then target_table := 'issue_forms'; target_module := 'form';
    when 'line-links' then target_table := 'line_users'; target_module := 'line';
    when 'log-reviews' then target_table := 'log_reviews'; target_module := 'monitoring'; deletion_mode := 'archive';
    when 'logging-systems' then target_table := 'logging_systems'; target_module := 'monitoring'; deletion_mode := 'archive';
    when 'known-errors' then target_table := 'known_errors'; target_module := 'problem';
    when 'maintenance-plans' then target_table := 'maintenance_plans'; target_module := 'maintenance';
    when 'positions' then target_table := 'positions'; target_module := 'position';
    when 'problems' then target_table := 'problems'; target_module := 'problem';
    when 'recovery-tests' then target_table := 'recovery_tests'; target_module := 'backup'; deletion_mode := 'archive';
    when 'roles' then target_table := 'roles'; target_module := 'role';
    when 'service-catalog' then target_table := 'service_catalog'; target_module := 'service-catalog';
    when 'service-requests' then target_table := 'service_requests'; target_module := 'service-request';
    when 'software-licenses' then target_table := 'software_licenses'; target_module := 'license';
    when 'ticket-categories' then target_table := 'ticket_categories'; target_module := 'ticket-category';
    when 'tickets' then target_table := 'tickets'; target_module := 'ticket'; deletion_mode := 'soft';
    when 'vendors' then target_table := 'vendors'; target_module := 'vendor';
    when 'vulnerabilities' then target_table := 'vulnerability_findings'; target_module := 'vulnerability';
    when 'workflow-definitions' then target_table := 'workflow_definitions'; target_module := 'workflow'; deletion_mode := 'archive';
    when 'workflow-instances' then target_table := 'workflow_instances'; target_module := 'workflow'; deletion_mode := 'archive';
    else
      raise exception using errcode = '22023', message = 'DELETE_TARGET_INVALID';
  end case;

  execute format(
    'select to_jsonb(target_row) from public.%I target_row where target_row.id = $1 for update',
    target_table
  ) into before_row using record_id_input;

  if before_row is null then
    raise exception using errcode = 'P0002', message = 'DELETE_TARGET_NOT_FOUND';
  end if;
  if resource_input = 'roles' and coalesce((before_row ->> 'is_system')::boolean, false) then
    raise exception using errcode = '23514', message = 'PROTECTED_RECORD';
  end if;
  if resource_input = 'ticket-categories' and coalesce((before_row ->> 'is_security_default')::boolean, false) then
    raise exception using errcode = '23514', message = 'PROTECTED_RECORD';
  end if;
  if deletion_mode = 'archive' and before_row ->> 'archived_at' is not null then
    raise exception using errcode = '23514', message = 'DELETE_TARGET_ALREADY_ARCHIVED';
  end if;

  if deletion_mode = 'archive' then
    case resource_input
      when 'workflow-definitions' then
        update public.workflow_definitions
        set archived_at = now_value,
            archived_by = actor_id_input,
            archive_reason = reason_input,
            status = 'ยกเลิก',
            is_default = false,
            active_to = coalesce(active_to, case when active_from > now_value then active_from else now_value end),
            updated_by = actor_id_input
        where id = record_id_input and archived_at is null;
      when 'workflow-instances' then
        previous_status := before_row ->> 'status';
        workflow_action := case when previous_status = 'กำลังดำเนินการ' then 'CANCEL_AND_ARCHIVE' else 'ARCHIVE' end;
        update public.workflow_instances
        set archived_at = now_value,
            archived_by = actor_id_input,
            archive_reason = reason_input,
            status = case when status = 'กำลังดำเนินการ' then 'ยกเลิก' else status end,
            cancelled_at = case when status = 'กำลังดำเนินการ' then now_value else cancelled_at end,
            due_at = case when status = 'กำลังดำเนินการ' then null else due_at end,
            result = coalesce(result, '{}'::jsonb) || jsonb_build_object('archiveReason', reason_input),
            updated_by = actor_id_input
        where id = record_id_input and archived_at is null;
        get diagnostics affected_rows = row_count;
        if affected_rows <> 1 then
          raise exception using errcode = 'P0002', message = 'DELETE_TARGET_NOT_FOUND';
        end if;

        update public.workflow_approvals
        set status = 'ยกเลิก', updated_by = actor_id_input
        where instance_id = record_id_input and status = 'รอพิจารณา';

        insert into public.workflow_history (
          instance_id, action, status_from, status_to, actor_id, comment, detail
        ) values (
          record_id_input,
          workflow_action,
          previous_status,
          case when previous_status = 'กำลังดำเนินการ' then 'ยกเลิก' else previous_status end,
          actor_id_input,
          reason_input,
          jsonb_build_object('source', 'record_deletion_safety')
        );
      when 'bcp-plans' then
        update public.bcp_plans
        set archived_at = now_value, archived_by = actor_id_input, archive_reason = reason_input,
            status = 'ยกเลิก', updated_by = actor_id_input
        where id = record_id_input and archived_at is null;
      when 'logging-systems' then
        update public.logging_systems
        set archived_at = now_value, archived_by = actor_id_input, archive_reason = reason_input,
            status = 'ระงับ', updated_by = actor_id_input
        where id = record_id_input and archived_at is null;
      else
        execute format(
          'update public.%I set archived_at = $2, archived_by = $3, archive_reason = $4, updated_by = $3 '
          'where id = $1 and archived_at is null',
          target_table
        ) using record_id_input, now_value, actor_id_input, reason_input;
    end case;
    if resource_input <> 'workflow-instances' then
      get diagnostics affected_rows = row_count;
    end if;
  elsif deletion_mode = 'soft' then
    update public.tickets
    set deleted_at = now_value,
        deleted_by = actor_id_input,
        deletion_reason = reason_input,
        updated_by = actor_id_input
    where id = record_id_input and deleted_at is null;
    get diagnostics affected_rows = row_count;
    if affected_rows = 0 then
      raise exception using errcode = '23514', message = 'DELETE_TARGET_ALREADY_ARCHIVED';
    end if;
  else
    execute format('delete from public.%I where id = $1', target_table) using record_id_input;
    get diagnostics affected_rows = row_count;
  end if;

  if affected_rows <> 1 then
    raise exception using errcode = 'P0002', message = 'DELETE_TARGET_NOT_FOUND';
  end if;

  insert into public.audit_logs (
    actor_id, actor_email, action, module, target_table, target_id, detail, result, request_id
  ) values (
    actor_id_input,
    actor_email_input,
    case deletion_mode when 'archive' then coalesce(workflow_action, 'ARCHIVE') when 'soft' then 'SOFT_DELETE' else 'DELETE' end,
    target_module,
    target_table,
    record_id_input::text,
    jsonb_build_object('resource', resource_input, 'mode', deletion_mode, 'reason', reason_input),
    'success',
    request_id_input
  );

  return jsonb_build_object('id', record_id_input, 'resource', resource_input, 'mode', deletion_mode);
end;
$$;

revoke all on function public.mutate_record_deletion(text, uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.mutate_record_deletion(text, uuid, uuid, text, text, text)
  to service_role;

comment on function public.mutate_record_deletion(text, uuid, uuid, text, text, text) is
  'Allowlisted record mutation with mandatory reason and an audit row in the same transaction.';
