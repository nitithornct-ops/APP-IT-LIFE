-- Deleting a LINE account was impossible: both FKs from the ticket tables were ON DELETE SET NULL,
-- but a LINE-channel ticket carries no other identity (requester_id is null since
-- 20260925_line_identity_without_employee_link), so nulling requester_line_user_id violated
-- tickets_requester_identity_check (23514) and rolled the whole delete back. The same happened to
-- ticket_worklogs_actor_identity_check for the "เปิด Ticket" worklog. The API surfaced this only as
-- the generic "ลบรายการไม่สำเร็จ" because routes/recordDeletions.ts maps 23503 but not 23514.
--
-- Decision: a LINE account delete now removes the tickets it opened. The audit_logs row written by
-- mutate_record_deletion is the surviving evidence and records how much was cascaded.

alter table public.tickets drop constraint tickets_requester_line_user_id_fkey;
alter table public.tickets
  add constraint tickets_requester_line_user_id_fkey
  foreign key (requester_line_user_id) references public.line_users(id) on delete cascade;

alter table public.ticket_worklogs drop constraint ticket_worklogs_actor_line_user_id_fkey;
alter table public.ticket_worklogs
  add constraint ticket_worklogs_actor_line_user_id_fkey
  foreign key (actor_line_user_id) references public.line_users(id) on delete cascade;

comment on constraint tickets_requester_line_user_id_fkey on public.tickets is
  'Cascade, not set null: a LINE ticket has no second identity column to fall back on.';

-- The cascade above still cannot reach three dependents on its own:
--   * problem_tickets.ticket_id and ticket_sla_dispatches.ticket_id are ON DELETE RESTRICT
--   * file_attachments points at a ticket through (module, target_table, target_id) text columns,
--     so no FK cascade exists and the rows would be orphaned.
-- Clearing them in a BEFORE DELETE trigger keeps a plain `delete from line_users` working from the
-- Supabase console too, not only through mutate_record_deletion.
create or replace function public.cascade_line_user_ticket_dependents()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ticket_ids uuid[];
begin
  select coalesce(array_agg(id), '{}'::uuid[]) into ticket_ids
  from public.tickets
  where requester_line_user_id = old.id;

  if cardinality(ticket_ids) = 0 then
    return old;
  end if;

  delete from public.ticket_sla_dispatches where ticket_id = any (ticket_ids);
  delete from public.problem_tickets where ticket_id = any (ticket_ids);
  -- Matched on target_table alone: module is client-supplied on the generic upload route
  -- (routes/files.ts), so it is not a reliable discriminator for ticket attachments.
  delete from public.file_attachments
  where target_table = 'tickets'
    and target_id = any (select id::text from unnest(ticket_ids) as id);

  return old;
end;
$$;

revoke all on function public.cascade_line_user_ticket_dependents() from public, anon, authenticated;

drop trigger if exists trg_line_users_cascade_ticket_dependents on public.line_users;
create trigger trg_line_users_cascade_ticket_dependents
  before delete on public.line_users
  for each row execute function public.cascade_line_user_ticket_dependents();

comment on function public.cascade_line_user_ticket_dependents() is
  'Clears the RESTRICT-guarded and FK-less ticket dependents so deleting a LINE account cascades cleanly.';

-- Record what the cascade removed, so the audit row keeps evidence the tickets themselves no longer hold.
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
  cascade_detail jsonb := '{}'::jsonb;
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
    if resource_input = 'line-links' then
      -- Read before the delete: the FK cascade and trg_line_users_cascade_ticket_dependents
      -- remove these rows, so the audit row is the only place the count survives.
      select jsonb_build_object(
        'cascadedTickets', (select count(*) from public.tickets where requester_line_user_id = record_id_input),
        -- Both FK paths, not just the actor one: a doomed ticket takes its staff-authored status
        -- updates and conversation entries with it through ticket_worklogs.ticket_id.
        'cascadedWorklogs', (
          select count(*) from public.ticket_worklogs worklog
          where worklog.actor_line_user_id = record_id_input
             or worklog.ticket_id in (
               select id from public.tickets where requester_line_user_id = record_id_input
             )
        ),
        'cascadedTicketNumbers', (
          select coalesce(jsonb_agg(ticket_no order by ticket_no), '[]'::jsonb)
          from public.tickets where requester_line_user_id = record_id_input
        )
      ) into cascade_detail;
    end if;
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
    jsonb_build_object('resource', resource_input, 'mode', deletion_mode, 'reason', reason_input) || cascade_detail,
    'success',
    request_id_input
  );

  return jsonb_build_object('id', record_id_input, 'resource', resource_input, 'mode', deletion_mode) || cascade_detail;
end;
$$;

revoke all on function public.mutate_record_deletion(text, uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.mutate_record_deletion(text, uuid, uuid, text, text, text)
  to service_role;
