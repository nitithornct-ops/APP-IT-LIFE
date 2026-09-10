-- Integration event history is operational telemetry, not a business record.
-- Keep completed delivery history for 90 days, while preserving unfinished work,
-- audit logs, governance evidence, and business data.

create index if not exists integration_outbox_retention_idx
  on public.integration_outbox (created_at)
  where status in ('COMPLETED', 'CANCELLED', 'DEAD');

-- Move the existing governed outbox policy from 365 days to 90 days.
update public.governance_retention_policies
set policy_code = 'RET-OUTBOX-90',
    retention_days = 90,
    updated_at = now()
where policy_code = 'RET-OUTBOX-365';

insert into public.governance_retention_policies
  (policy_code, target_table, retention_days, terminal_statuses, date_column, action)
values
  ('RET-OUTBOX-90', 'integration_outbox', 90, array['COMPLETED','CANCELLED','DEAD'], 'created_at', 'DELETE')
on conflict (policy_code) do update set
  target_table = excluded.target_table,
  retention_days = excluded.retention_days,
  terminal_statuses = excluded.terminal_statuses,
  date_column = excluded.date_column,
  action = excluded.action,
  status = 'ACTIVE',
  updated_at = now();

insert into public.governance_retention_policies
  (policy_code, target_table, retention_days, terminal_statuses, date_column, action)
values
  ('RET-LINE-90', 'line_notification_log', 90, array[]::text[], 'created_at', 'DELETE')
on conflict (policy_code) do update set
  target_table = excluded.target_table,
  retention_days = excluded.retention_days,
  terminal_statuses = excluded.terminal_statuses,
  date_column = excluded.date_column,
  action = excluded.action,
  status = 'ACTIVE',
  updated_at = now();

-- Keep the manual governance Preview/Apply flow aligned with the automatic policy.
create or replace function public.run_governance_retention(
  apply_changes boolean, preview_run_id_input uuid default null,
  requested_by_input uuid default null, requested_by_email_input text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid := gen_random_uuid();
  v_code text;
  v_count integer := 0;
  v_affected integer := 0;
  v_preview record;
  v_retention_days integer;
begin
  select retention_days into v_retention_days
  from public.governance_retention_policies
  where policy_code = 'RET-OUTBOX-90' and status = 'ACTIVE';
  if v_retention_days is null then raise exception 'active outbox retention policy is required'; end if;

  v_code := 'RET-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad((floor(random()*9000)+1000)::text, 4, '0');
  select count(*) into v_count from public.integration_outbox
    where status in ('COMPLETED','CANCELLED','DEAD')
      and created_at < now() - (v_retention_days || ' days')::interval;
  if apply_changes then
    if preview_run_id_input is null then raise exception 'preview_run_id is required'; end if;
    select * into v_preview from public.governance_retention_runs where id = preview_run_id_input and mode = 'PREVIEW' and status = 'COMPLETED';
    if not found or v_preview.completed_at < now() - interval '1 hour' then raise exception 'a completed preview from the last hour is required'; end if;
    if v_preview.matched_count <> v_count then raise exception 'retention candidates changed; run preview again'; end if;
    delete from public.integration_outbox
      where status in ('COMPLETED','CANCELLED','DEAD')
        and created_at < now() - (v_retention_days || ' days')::interval;
    get diagnostics v_affected = row_count;
  end if;
  insert into public.governance_retention_runs(id,run_code,mode,preview_run_id,status,matched_count,affected_count,detail,requested_by_id,requested_by_email,completed_at)
  values(v_id,v_code,case when apply_changes then 'APPLY' else 'PREVIEW' end,preview_run_id_input,'COMPLETED',v_count,v_affected,
    jsonb_build_object('scope','terminal integration_outbox older than retention policy','retentionDays',v_retention_days,'designerDeferred',true),requested_by_input,requested_by_email_input,now());
  return jsonb_build_object('id',v_id,'runCode',v_code,'mode',case when apply_changes then 'APPLY' else 'PREVIEW' end,'matched',v_count,'affected',v_affected,'retentionDays',v_retention_days);
end $$;

revoke all on function public.run_governance_retention(boolean,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.run_governance_retention(boolean,uuid,uuid,text) to service_role;

-- Called by the existing Worker cron. The advisory transaction lock prevents two
-- overlapping cron invocations from producing duplicate retention runs.
create or replace function public.run_automated_integration_retention(
  scheduled_at_input timestamptz default now()
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_outbox_days integer;
  v_line_days integer;
  v_outbox_cutoff timestamptz;
  v_line_cutoff timestamptz;
  v_outbox_affected integer := 0;
  v_line_affected integer := 0;
  v_run_id uuid := null;
  v_run_code text;
begin
  perform pg_advisory_xact_lock(hashtext('itlife:integration_retention'));

  select retention_days into v_outbox_days
  from public.governance_retention_policies
  where policy_code = 'RET-OUTBOX-90' and target_table = 'integration_outbox' and status = 'ACTIVE';
  select retention_days into v_line_days
  from public.governance_retention_policies
  where policy_code = 'RET-LINE-90' and target_table = 'line_notification_log' and status = 'ACTIVE';
  if v_outbox_days is null or v_line_days is null then raise exception 'active integration retention policies are required'; end if;

  v_outbox_cutoff := scheduled_at_input - (v_outbox_days || ' days')::interval;
  v_line_cutoff := scheduled_at_input - (v_line_days || ' days')::interval;

  delete from public.integration_outbox
  where status in ('COMPLETED','CANCELLED','DEAD') and created_at < v_outbox_cutoff;
  get diagnostics v_outbox_affected = row_count;

  delete from public.line_notification_log
  where created_at < v_line_cutoff;
  get diagnostics v_line_affected = row_count;

  -- Do not create an audit row for an empty cron pass; create one when data was
  -- actually removed so the retention register remains useful and bounded.
  if v_outbox_affected + v_line_affected > 0 then
    v_run_code := 'RET-AUTO-' || to_char(scheduled_at_input at time zone 'UTC', 'YYYYMMDDHH24MISS') || '-' || lpad((floor(random()*9000)+1000)::text, 4, '0');
    insert into public.governance_retention_runs(
      run_code, mode, status, matched_count, affected_count, detail,
      requested_by_email, completed_at
    )
    values(
      v_run_code, 'APPLY', 'COMPLETED', v_outbox_affected + v_line_affected,
      v_outbox_affected + v_line_affected,
      jsonb_build_object(
        'scope', 'terminal integration_outbox and line_notification_log',
        'outboxDeleted', v_outbox_affected,
        'lineLogsDeleted', v_line_affected,
        'outboxRetentionDays', v_outbox_days,
        'lineRetentionDays', v_line_days,
        'scheduledAt', scheduled_at_input
      ),
      'scheduled-worker', now()
    )
    returning id into v_run_id;
  end if;

  return jsonb_build_object(
    'skipped', false,
    'outboxDeleted', v_outbox_affected,
    'lineLogsDeleted', v_line_affected,
    'outboxRetentionDays', v_outbox_days,
    'lineRetentionDays', v_line_days,
    'runId', v_run_id
  );
end $$;

revoke all on function public.run_automated_integration_retention(timestamptz) from public, anon, authenticated;
grant execute on function public.run_automated_integration_retention(timestamptz) to service_role;
