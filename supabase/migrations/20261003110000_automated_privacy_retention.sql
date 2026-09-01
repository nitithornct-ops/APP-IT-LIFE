-- Automated, idempotent PDPA retention for public guest Tickets. This scope is
-- deliberately allowlisted and does not include backup/recovery tables or artifacts.

alter table public.governance_retention_runs
  add column idempotency_key text unique;

insert into public.governance_retention_policies
  (policy_code, target_table, retention_days, terminal_statuses, date_column, action, status)
values
  ('RET-PUBLIC-TICKET-730', 'tickets', 730, array['ปิดงาน','ยกเลิก'], 'updated_at', 'ANONYMIZE', 'ACTIVE'),
  ('RET-PUBLIC-TICKET-FILES-730', 'file_attachments', 730, array[]::text[], 'created_at', 'DELETE', 'ACTIVE')
on conflict (target_table) do update set
  policy_code = excluded.policy_code,
  retention_days = excluded.retention_days,
  terminal_statuses = excluded.terminal_statuses,
  date_column = excluded.date_column,
  action = excluded.action,
  status = excluded.status,
  updated_at = now();

alter table public.tickets drop constraint if exists tickets_requester_identity_check;
alter table public.tickets add constraint tickets_requester_identity_check check (
  requester_id is not null
  or requester_line_user_id is not null
  or (guest_name is not null and public_tracking_token_hash is not null)
  or (source_channel = 'guest' and privacy_anonymized_at is not null)
);

create or replace function public.claim_automated_privacy_retention(scheduled_at_input timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  run_id uuid := gen_random_uuid();
  claimed_run_id uuid;
  run_key text := 'privacy-retention:' || to_char(date_trunc('day', scheduled_at_input at time zone 'UTC'), 'YYYYMMDD');
begin
  insert into public.governance_retention_runs (
    id, run_code, mode, status, detail, requested_by_email, started_at, idempotency_key
  ) values (
    run_id,
    'RET-AUTO-' || to_char(date_trunc('day', scheduled_at_input at time zone 'UTC'), 'YYYYMMDD'),
    'APPLY',
    'RUNNING',
    jsonb_build_object('scope', 'public guest Ticket PII and files', 'automatic', true, 'backupExcluded', true),
    'SYSTEM:PRIVACY_RETENTION',
    scheduled_at_input,
    run_key
  ) on conflict do nothing;

  if found then
    return jsonb_build_object('id', run_id, 'idempotencyKey', run_key, 'retry', false);
  end if;

  -- A failed daily run may be retried by the next five-minute Cron tick. Completed
  -- and still-running jobs remain idempotently skipped for the rest of the UTC day.
  update public.governance_retention_runs
  set status = 'RUNNING',
      matched_count = 0,
      affected_count = 0,
      started_at = scheduled_at_input,
      completed_at = null,
      detail = coalesce(detail, '{}'::jsonb) || jsonb_build_object('retryAt', scheduled_at_input)
  where idempotency_key = run_key and status = 'FAILED'
  returning id into claimed_run_id;

  if claimed_run_id is null then return null; end if;
  return jsonb_build_object('id', claimed_run_id, 'idempotencyKey', run_key, 'retry', true);
end;
$$;

create or replace function public.apply_public_ticket_privacy_retention(
  ticket_ids_input uuid[],
  attachment_ids_input uuid[],
  cutoff_input timestamptz,
  applied_at_input timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  attachment_count integer := 0;
  ticket_count integer := 0;
begin
  create temporary table retention_ticket_candidates on commit drop as
  select ticket.id
  from public.tickets ticket
  where ticket.id = any(coalesce(ticket_ids_input, '{}'::uuid[]))
    and ticket.source_channel = 'guest'
    and ticket.status in ('ปิดงาน', 'ยกเลิก')
    and ticket.updated_at < cutoff_input
    and ticket.privacy_anonymized_at is null
  for update;

  delete from public.file_attachments attachment
  using retention_ticket_candidates candidate
  where attachment.id = any(coalesce(attachment_ids_input, '{}'::uuid[]))
    and attachment.module = 'ticket'
    and attachment.target_table = 'tickets'
    and attachment.target_id = candidate.id::text;
  get diagnostics attachment_count = row_count;

  update public.ticket_worklogs worklog
  set actor_label = case when worklog.actor_label is null then null else 'ผู้แจ้ง (ทำให้ไม่ระบุตัวตนแล้ว)' end,
      detail = case when worklog.detail is null then null else '[รายละเอียดถูกลบตามนโยบายการเก็บรักษา]' end
  from retention_ticket_candidates candidate
  where worklog.ticket_id = candidate.id;

  update public.tickets ticket
  set title = '[Ticket ที่ทำให้ไม่ระบุตัวตนแล้ว]',
      description = '[รายละเอียดถูกลบตามนโยบายการเก็บรักษา]',
      guest_name = null,
      guest_department = null,
      requester_phone = null,
      requester_name_snapshot = null,
      requester_position_snapshot = null,
      department_name_snapshot = null,
      location = null,
      asset_name_snapshot = null,
      public_tracking_token_hash = null,
      resolution = case when resolution is null then null else '[รายละเอียดถูกลบตามนโยบายการเก็บรักษา]' end,
      feedback = null,
      notes = null,
      signature_storage_path = null,
      requester_signature_storage_path = null,
      requester_signature_uploaded_by = null,
      requester_signature_uploaded_at = null,
      privacy_anonymized_at = applied_at_input
  from retention_ticket_candidates candidate
  where ticket.id = candidate.id;
  get diagnostics ticket_count = row_count;

  return jsonb_build_object(
    'ticketsAnonymized', ticket_count,
    'attachmentMetadataDeleted', attachment_count,
    'affected', ticket_count + attachment_count
  );
end;
$$;

create or replace function public.complete_automated_privacy_retention(
  run_id_input uuid,
  status_input text,
  matched_input integer,
  affected_input integer,
  detail_input jsonb,
  completed_at_input timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if status_input not in ('COMPLETED', 'FAILED') then
    raise exception 'RETENTION_STATUS_INVALID';
  end if;
  update public.governance_retention_runs
  set status = status_input,
      matched_count = greatest(coalesce(matched_input, 0), 0),
      affected_count = greatest(coalesce(affected_input, 0), 0),
      detail = coalesce(detail, '{}'::jsonb) || coalesce(detail_input, '{}'::jsonb),
      completed_at = completed_at_input
  where id = run_id_input and status = 'RUNNING';
end;
$$;

revoke all on function public.claim_automated_privacy_retention(timestamptz) from public, anon, authenticated;
revoke all on function public.apply_public_ticket_privacy_retention(uuid[],uuid[],timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.complete_automated_privacy_retention(uuid,text,integer,integer,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.claim_automated_privacy_retention(timestamptz) to service_role;
grant execute on function public.apply_public_ticket_privacy_retention(uuid[],uuid[],timestamptz,timestamptz) to service_role;
grant execute on function public.complete_automated_privacy_retention(uuid,text,integer,integer,jsonb,timestamptz) to service_role;
