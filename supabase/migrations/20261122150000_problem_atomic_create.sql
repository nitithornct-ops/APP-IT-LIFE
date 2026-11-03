-- Create the Problem, its relationships, permanent fix and audit together.
-- Only the API service role may invoke this operation after permission checks.
create or replace function public.create_problem_atomic(
  problem_number_input text,
  problem_input jsonb,
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
  input public.problems%rowtype;
  problem_id uuid;
begin
  if jsonb_typeof(problem_input) is distinct from 'object' or exists (
    select 1 from jsonb_object_keys(problem_input) as k(key)
    where k.key <> all(array['title','category','affected_system','impact','root_cause','workaround',
      'permanent_fix','owner_id','priority','status','rca_method','five_why','fishbone','recurrence_count',
      'review_date','review_meeting_at','review_meeting_owner_id','review_meeting_notes','evidence_url','notes'])
  ) then
    raise exception using errcode = '22023', message = 'PROBLEM_INPUT_INVALID';
  end if;
  input := jsonb_populate_record(null::public.problems, problem_input);
  if input.status = 'ปิด' then
    raise exception using errcode = '22023', message = 'PROBLEM_CREATE_CLOSED';
  end if;
  if nullif(btrim(input.permanent_fix), '') is not null and coalesce(cardinality(change_ids_input), 0) = 0 then
    raise exception using errcode = '22023', message = 'PROBLEM_CHANGE_REQUIRED';
  end if;

  insert into public.problems(
    problem_number, title, category, affected_system, impact, root_cause, workaround,
    owner_id, priority, status, review_date, evidence_url, notes, rca_method, five_why, fishbone,
    recurrence_count, review_meeting_at, review_meeting_owner_id, review_meeting_notes, created_by, updated_by
  ) values (
    problem_number_input, input.title, input.category, input.affected_system, input.impact, input.root_cause, input.workaround,
    input.owner_id, coalesce(input.priority, 'ปานกลาง'), coalesce(input.status, 'เปิด'), input.review_date,
    input.evidence_url, input.notes, coalesce(input.rca_method, '5 Why'), coalesce(input.five_why, '[]'::jsonb),
    coalesce(input.fishbone, '{}'::jsonb), coalesce(input.recurrence_count, 0), input.review_meeting_at,
    input.review_meeting_owner_id, input.review_meeting_notes, actor_id_input, actor_id_input
  ) returning id into problem_id;

  insert into public.problem_incidents(problem_id, incident_id, created_by)
    select problem_id, id, actor_id_input from (select distinct unnest(incident_ids_input) as id) ids;
  insert into public.problem_tickets(problem_id, ticket_id, created_by)
    select problem_id, id, actor_id_input from (select distinct unnest(ticket_ids_input) as id) ids;
  insert into public.problem_configuration_items(problem_id, ci_id, created_by)
    select problem_id, id, actor_id_input from (select distinct unnest(ci_ids_input) as id) ids;
  insert into public.problem_changes(problem_id, change_id, created_by)
    select problem_id, id, actor_id_input from (select distinct unnest(change_ids_input) as id) ids;

  if nullif(btrim(input.permanent_fix), '') is not null then
    update public.problems set permanent_fix = input.permanent_fix where id = problem_id;
  end if;
  insert into public.audit_logs(actor_id, actor_email, action, module, target_table, target_id, detail, result, request_id)
    values (actor_id_input, actor_email_input, 'CREATE', 'problem', 'problems', problem_id::text,
      jsonb_build_object('problemNumber', problem_number_input,
        'incidentIds', coalesce(to_jsonb(incident_ids_input), '[]'::jsonb),
        'ticketIds', coalesce(to_jsonb(ticket_ids_input), '[]'::jsonb)), 'success', request_id_input);
  return jsonb_build_object('id', problem_id);
end;
$$;

revoke all on function public.create_problem_atomic(text,jsonb,uuid[],uuid[],uuid[],uuid[],uuid,text,text) from public, anon, authenticated;
grant execute on function public.create_problem_atomic(text,jsonb,uuid[],uuid[],uuid[],uuid[],uuid,text,text) to service_role;
