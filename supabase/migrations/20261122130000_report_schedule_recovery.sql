-- Existing running rows have no phase or lease: their external effects are
-- unknown and must be reconciled manually, never blindly replayed.
alter table public.report_schedule_runs
  add column claim_token uuid,
  add column lease_until timestamptz,
  add column recovery_phase text check (recovery_phase in ('preparing', 'snapshot_ready', 'uploading'));

create function public.persist_scheduled_report_snapshot(run_id_input uuid, claim_token_input uuid, snapshot_input jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare run_row public.report_schedule_runs%rowtype; snapshot_id_result uuid;
begin
  select * into run_row from public.report_schedule_runs where id = run_id_input for update;
  if not found or run_row.status <> 'running' or run_row.claim_token is distinct from claim_token_input
     or run_row.lease_until is null or run_row.lease_until <= now()
     or coalesce(run_row.recovery_phase not in ('preparing', 'snapshot_ready'), true) then
    raise exception 'REPORT_SCHEDULE_LEASE_LOST';
  end if;
  if run_row.snapshot_id is not null then return run_row.snapshot_id; end if;
  insert into public.report_snapshots(report_key, snapshot_kind, title, period_start, period_end, filters, dataset, generated_at, created_by)
  values (snapshot_input->>'report_key', snapshot_input->>'snapshot_kind', snapshot_input->>'title',
    nullif(snapshot_input->>'period_start','')::date, nullif(snapshot_input->>'period_end','')::date,
    snapshot_input->'filters', snapshot_input->'dataset', (snapshot_input->>'generated_at')::timestamptz,
    nullif(snapshot_input->>'created_by','')::uuid)
  returning id into snapshot_id_result;
  update public.report_schedule_runs set snapshot_id = snapshot_id_result, recovery_phase = 'snapshot_ready' where id = run_id_input;
  return snapshot_id_result;
end $$;

-- Once this boundary is crossed, an interrupted upload is uncertain. It is
-- deliberately not reclaimable until the Drive side effect is reconciled.
create function public.begin_scheduled_report_upload(run_id_input uuid, claim_token_input uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.report_schedule_runs set recovery_phase = 'uploading'
  where id = run_id_input and status = 'running' and claim_token = claim_token_input
    and lease_until > now() and recovery_phase = 'snapshot_ready' and snapshot_id is not null;
  return found;
end $$;

revoke all on function public.persist_scheduled_report_snapshot(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.begin_scheduled_report_upload(uuid, uuid) from public, anon, authenticated;
grant execute on function public.persist_scheduled_report_snapshot(uuid, uuid, jsonb) to service_role;
grant execute on function public.begin_scheduled_report_upload(uuid, uuid) to service_role;
