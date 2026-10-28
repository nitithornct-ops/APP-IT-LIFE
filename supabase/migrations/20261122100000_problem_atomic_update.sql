-- Update the Problem, its links, and a minimal audit event in one transaction.
-- Only the service role may call this function; the API checks problem.manage.
create or replace function public.update_problem_atomic(
  problem_id_input uuid,
  patch_input jsonb,
  incident_ids_input uuid[],
  ticket_ids_input uuid[],
  ci_ids_input uuid[],
  change_ids_input uuid[],
  actor_id_input uuid,
  actor_email_input text,
  request_id_input text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_problem public.problems%rowtype;
  next_problem public.problems%rowtype;
  old_changes uuid[];
  new_changes uuid[];
  audit_changes jsonb;
  audit_fields jsonb;
begin
  if jsonb_typeof(patch_input) <> 'object' or exists (
    select 1 from jsonb_object_keys(patch_input) as k(key)
    where k.key <> all(array['title','category','affected_system','impact','root_cause','workaround',
      'permanent_fix','owner_id','priority','status','rca_method','five_why','fishbone','recurrence_count',
      'review_date','review_meeting_at','review_meeting_owner_id','review_meeting_notes','evidence_url','notes'])
  ) then
    raise exception using errcode = '22023', message = 'PROBLEM_PATCH_INVALID';
  end if;

  select * into old_problem from public.problems where id = problem_id_input for update;
  if not found then raise exception using errcode = 'P0002', message = 'PROBLEM_NOT_FOUND'; end if;
  next_problem := jsonb_populate_record(old_problem, patch_input);
  next_problem.updated_by := actor_id_input;
  if patch_input ? 'status' then
    next_problem.closed_at := case when next_problem.status = 'ปิด' then now() else null end;
  end if;

  if change_ids_input is not null then
    select coalesce(array_agg(change_id order by change_id), '{}'::uuid[]) into old_changes
      from public.problem_changes where problem_id = problem_id_input;
    select coalesce(array_agg(id order by id), '{}'::uuid[]) into new_changes
      from (select distinct unnest(change_ids_input) as id) ids;
    if old_changes <> new_changes then
      next_problem.change_verified_at := null;
      next_problem.change_verified_by := null;
      next_problem.change_verification_notes := null;
    end if;
  end if;

  if incident_ids_input is not null then
    delete from public.problem_incidents where problem_id = problem_id_input;
    insert into public.problem_incidents(problem_id, incident_id, created_by)
      select problem_id_input, id, actor_id_input from (select distinct unnest(incident_ids_input) as id) ids;
  end if;
  if ticket_ids_input is not null then
    delete from public.problem_tickets where problem_id = problem_id_input;
    insert into public.problem_tickets(problem_id, ticket_id, created_by)
      select problem_id_input, id, actor_id_input from (select distinct unnest(ticket_ids_input) as id) ids;
  end if;
  if ci_ids_input is not null then
    delete from public.problem_configuration_items where problem_id = problem_id_input;
    insert into public.problem_configuration_items(problem_id, ci_id, created_by)
      select problem_id_input, id, actor_id_input from (select distinct unnest(ci_ids_input) as id) ids;
  end if;
  if change_ids_input is not null then
    delete from public.problem_changes where problem_id = problem_id_input;
    insert into public.problem_changes(problem_id, change_id, created_by)
      select problem_id_input, id, actor_id_input from (select distinct unnest(change_ids_input) as id) ids;
  end if;

  update public.problems set
    title = next_problem.title, category = next_problem.category, affected_system = next_problem.affected_system,
    impact = next_problem.impact, root_cause = next_problem.root_cause, workaround = next_problem.workaround,
    permanent_fix = next_problem.permanent_fix, owner_id = next_problem.owner_id, priority = next_problem.priority,
    status = next_problem.status, closed_at = next_problem.closed_at, rca_method = next_problem.rca_method,
    five_why = next_problem.five_why, fishbone = next_problem.fishbone, recurrence_count = next_problem.recurrence_count,
    review_date = next_problem.review_date, review_meeting_at = next_problem.review_meeting_at,
    review_meeting_owner_id = next_problem.review_meeting_owner_id, review_meeting_notes = next_problem.review_meeting_notes,
    evidence_url = next_problem.evidence_url, notes = next_problem.notes, updated_by = next_problem.updated_by,
    change_verified_at = next_problem.change_verified_at, change_verified_by = next_problem.change_verified_by,
    change_verification_notes = next_problem.change_verification_notes
  where id = problem_id_input;

  -- Preserve a useful before/after audit for structured fields while keeping
  -- free text and evidence locations out of the audit trail.
  select coalesce(jsonb_object_agg(key, jsonb_build_object(
      'from', case when key = any(array['priority','status','owner_id','rca_method','recurrence_count','review_date','review_meeting_at','review_meeting_owner_id'])
        then to_jsonb(old_problem)->key else to_jsonb('[REDACTED]'::text) end,
      'to', case when key = any(array['priority','status','owner_id','rca_method','recurrence_count','review_date','review_meeting_at','review_meeting_owner_id'])
        then to_jsonb(next_problem)->key else to_jsonb('[REDACTED]'::text) end)), '{}'::jsonb),
    coalesce(jsonb_agg(key), '[]'::jsonb)
  into audit_changes, audit_fields
  from jsonb_object_keys(patch_input) as k(key)
  where to_jsonb(old_problem)->key is distinct from to_jsonb(next_problem)->key;

  insert into public.audit_logs(actor_id, actor_email, action, module, target_table, target_id, detail, result, request_id)
  values (actor_id_input, actor_email_input, 'UPDATE', 'problem', 'problems', problem_id_input::text,
    jsonb_build_object('changedFields', audit_fields, 'changes', audit_changes,
      'incidentLinksChanged', incident_ids_input is not null, 'ticketLinksChanged', ticket_ids_input is not null,
      'ciLinksChanged', ci_ids_input is not null, 'changeLinksChanged', change_ids_input is not null),
    'success', request_id_input);
  return jsonb_build_object('id', problem_id_input);
end;
$$;

revoke all on function public.update_problem_atomic(uuid,jsonb,uuid[],uuid[],uuid[],uuid[],uuid,text,text) from public, anon, authenticated;
grant execute on function public.update_problem_atomic(uuid,jsonb,uuid[],uuid[],uuid[],uuid[],uuid,text,text) to service_role;

-- Serialize verification with link replacement so verification cannot be
-- applied to a different set of Changes than the one that was checked.
create or replace function public.verify_problem_change_atomic(
  problem_id_input uuid, actor_id_input uuid, actor_email_input text, notes_input text, request_id_input text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.problems where id = problem_id_input for update;
  if not found then raise exception using errcode = 'P0002', message = 'PROBLEM_NOT_FOUND'; end if;
  perform cr.id from public.problem_changes pc
    join public.change_requests cr on cr.id = pc.change_id
    where pc.problem_id = problem_id_input and cr.status = 'ติดตั้งใช้งานแล้ว'
    for share of cr;
  if not found then raise exception using errcode = 'P0001', message = 'PROBLEM_DEPLOYED_CHANGE_REQUIRED'; end if;
  update public.problems set change_verified_at = now(), change_verified_by = actor_id_input,
    change_verification_notes = notes_input, updated_by = actor_id_input where id = problem_id_input;
  insert into public.audit_logs(actor_id, actor_email, action, module, target_table, target_id, detail, result, request_id)
    values (actor_id_input, actor_email_input, 'VERIFY_AFTER_CHANGE', 'problem', 'problems', problem_id_input::text,
      jsonb_build_object('notes', '[REDACTED]'), 'success', request_id_input);
  return jsonb_build_object('id', problem_id_input);
end;
$$;
revoke all on function public.verify_problem_change_atomic(uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.verify_problem_change_atomic(uuid,uuid,text,text,text) to service_role;
