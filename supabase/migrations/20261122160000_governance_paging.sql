-- RLS is preserved: the caller only sees rows their existing policies allow.
-- The whitelist is captured from the API's domain registry; identifiers are never caller supplied.
-- Hoist permission checks whose argument is a constant into an initplan. Keep
-- row-dependent ownership predicates intact. This preserves policy semantics
-- while avoiding a full permission-resolution query for every scanned row.
do $policy$
declare policy record; qualifier text; checker text;
begin
  for policy in select * from pg_policies where schemaname = 'public' loop
    qualifier := regexp_replace(policy.qual, '((public\.)?has_permission\(''[^'']+''::text\))', '(select \1)', 'g');
    checker := regexp_replace(policy.with_check, '((public\.)?has_permission\(''[^'']+''::text\))', '(select \1)', 'g');
    if qualifier is distinct from policy.qual or checker is distinct from policy.with_check then
      execute format('alter policy %I on public.%I %s %s', policy.policyname, policy.tablename,
        case when qualifier is not null then 'using (' || qualifier || ')' else '' end,
        case when checker is not null then 'with check (' || checker || ')' else '' end);
    end if;
  end loop;
end;
$policy$;

create or replace function public.governance_domain_page(
  domain_input text, search_input text default '', page_input integer default 1, page_size_input integer default 25,
  calendar_month_input date default null
) returns jsonb
language plpgsql security invoker set search_path = ''
as $function$
declare
  registry constant jsonb := $registry${"data-classification":{"entities":[{"entity":"data-assets","table":"governance_data_assets","code":"data_code","prefix":"DAT","title":"data_name","status":"status","owner":"data_owner","due":"next_review_date"},{"entity":"destruction-requests","table":"data_destruction_requests","code":"request_code","prefix":"DST","title":"data_name","status":"status","owner":"requester_email"}],"permission":"data_class.view"},"compliance":{"entities":[{"entity":"laws","table":"legal_register","code":"law_code","prefix":"LAW","title":"law_name","status":"status","owner":"owner","due":"next_review_date"},{"entity":"obligations","table":"compliance_obligations","code":"obligation_code","prefix":"OBL","title":"requirement","status":"status","owner":"control_owner","due":"due_date"},{"entity":"assessments","table":"compliance_assessments","code":"assessment_code","prefix":"ASM","title":"control_description","status":"result","due":"next_review_due"},{"entity":"corrective-actions","table":"compliance_corrective_actions","code":"action_code","prefix":"CAP","title":"title","status":"status","owner":"owner","due":"due_date"},{"entity":"annual-attestations","table":"governance_annual_attestations","code":"attestation_code","prefix":"ATT","title":"scope","status":"status","owner":"attestor_email"}],"permission":"compliance.view"},"privacy":{"entities":[{"entity":"ropa","table":"privacy_ropa","code":"ropa_code","prefix":"ROPA","title":"process_name","status":"status","owner":"data_owner","due":"review_date"},{"entity":"consents","table":"privacy_consents","code":"consent_code","prefix":"CNS","title":"purpose","status":"status"},{"entity":"dsr","table":"privacy_dsr","code":"request_code","prefix":"DSR","title":"request_type","status":"status","owner":"owner","due":"due_date"},{"entity":"dpia","table":"privacy_dpia_assessments","code":"dpia_code","prefix":"DPIA","title":"processing_description","status":"status","owner":"owner","due":"due_date"}],"permission":"privacy.view"},"risk":{"entities":[{"entity":"risks","table":"governance_risks","code":"risk_code","prefix":"RSK","title":"title","status":"status","owner":"owner","due":"due_date","score":"risk_score"},{"entity":"risk-acceptances","table":"governance_risk_acceptances","code":"acceptance_code","prefix":"RAK","title":"rationale","status":"status","owner":"requested_by_email","due":"expires_at"}],"permission":"risk.view"},"ai-cloud":{"entities":[{"entity":"ai-tools","table":"governance_ai_tools","code":"tool_code","prefix":"AIT","title":"tool_name","status":"status","owner":"owner"},{"entity":"cloud-services","table":"governance_cloud_services","code":"service_code","prefix":"CLD","title":"service_name","status":"status","owner":"owner","due":"contract_expiry"}],"permission":"ai_cloud.view"},"awareness":{"entities":[{"entity":"training-plans","table":"governance_training_plans","code":"plan_code","prefix":"TRN","title":"topic","status":"status","owner":"responsible","due":"planned_date"},{"entity":"acknowledgements","table":"policy_acknowledgements","code":"ack_code","prefix":"ACK","title":"policy_name","status":"status","owner":"acknowledger_email"},{"entity":"training-records","table":"governance_training_records","code":"record_code","prefix":"REC","title":"course_title","status":"status","owner":"participant_email"}],"permission":"awareness.view"},"evidence":{"entities":[{"entity":"controls","table":"governance_controls","code":"control_code","prefix":"CTL","title":"title","status":"status","owner":"owner","due":"next_review_date"},{"entity":"evidence-items","table":"governance_evidence_items","code":"evidence_code","prefix":"EVD","title":"title","status":"status","owner":"owner","due":"expires_at"},{"entity":"control-tests","table":"governance_control_tests","code":"test_code","prefix":"TST","title":"test_procedure","status":"status","owner":"tester_email","due":"test_date"}],"permission":"evidence.view"},"audit-management":{"entities":[{"entity":"audits","table":"audit_engagements","code":"audit_code","prefix":"AUD","title":"title","status":"status","owner":"lead_auditor","due":"planned_end"},{"entity":"findings","table":"audit_findings","code":"finding_code","prefix":"FND","title":"title","status":"status","owner":"owner","due":"due_date"}],"permission":"audit_management.view"},"documents":{"entities":[{"entity":"documents","table":"governance_documents","code":"document_code","prefix":"DOC","title":"title","status":"status","owner":"owner","due":"review_date"}],"permission":"governance_document.view"},"operations":{"entities":[{"entity":"employee-lifecycle","table":"employee_lifecycle_events","code":"lifecycle_code","prefix":"JML","title":"employee_name","status":"status","owner":"requested_by_email","due":"effective_date"},{"entity":"calendar-events","table":"governance_calendar_events","code":"event_code","prefix":"CAL","title":"title","status":"status","owner":"owner","due":"start_date"},{"entity":"retention-runs","table":"governance_retention_runs","code":"run_code","prefix":"RET","title":"mode","status":"status","owner":"requested_by_email"},{"entity":"operational-checks","table":"governance_operational_checks","code":"check_code","prefix":"OPS","title":"check_name","status":"status","owner":"checked_by_email"}],"permission":"operations.view"},"integrations":{"entities":[{"entity":"outbox","table":"integration_outbox","code":"integration_code","prefix":"INT","title":"event_type","status":"status","owner":"target_module","due":"next_attempt_at"},{"entity":"record-links","table":"record_links","code":"link_code","prefix":"LNK","title":"link_type","status":"status","owner":"source_module"}],"permission":"integration.view"}}$registry$::jsonb;
  config jsonb;
  entity jsonb;
  parts text[] := '{}';
  statement text;
  result jsonb;
begin
  config := registry -> domain_input;
  if config is null then raise exception using errcode = '22023', message = 'GOVERNANCE_DOMAIN_INVALID'; end if;
  if not public.has_permission(config->>'permission') then
    raise exception using errcode = '42501', message = 'GOVERNANCE_FORBIDDEN';
  end if;
  if page_input < 1 or page_size_input not between 1 and 100 or length(coalesce(search_input,'')) > 200 then
    raise exception using errcode = '22023', message = 'GOVERNANCE_PAGE_INVALID';
  end if;
  for entity in select value from jsonb_array_elements(config->'entities') loop
    parts := array_append(parts, format(
      'select %L::text as entity, to_jsonb(t) as record, t.%I::text as status, %s as due_date, %s as score, %L::boolean as review from public.%I t',
      entity->>'entity', entity->>'status',
      case when entity ? 'due' then format('t.%I::text', entity->>'due') else 'null::text' end,
      case when entity ? 'score' then format('t.%I::numeric', entity->>'score') else 'null::numeric' end,
      coalesce(entity->>'due','') in ('review_date','next_review_date','next_review_due'),
      entity->>'table'));
  end loop;
  statement := 'with source as (' || array_to_string(parts, ' union all ') || $query$
    ), annotated as (
      select *, coalesce(status, '') ~* 'ปิด|เสร็จสิ้น|ยกเลิก|ปฏิเสธ|ทำลายแล้ว|ใช้งาน|compliant|completed|cancelled' as terminal,
        case when due_date is null then false
          when review and due_date ~ '^\d{4}-\d{2}-\d{2}$' then due_date::date < (now() at time zone 'Asia/Bangkok')::date
          else due_date::timestamptz < now() end
        and not (coalesce(status, '') ~* case when review
          then 'ปิด|เสร็จสิ้น|ยกเลิก|ปฏิเสธ|ทำลายแล้ว|compliant|completed|cancelled'
          else 'ปิด|เสร็จสิ้น|ยกเลิก|ปฏิเสธ|ทำลายแล้ว|ใช้งาน|compliant|completed|cancelled' end) as overdue
      from source
    ), filtered as (
      select * from annotated where ($1 = '' or strpos(lower(record::text), lower($1)) > 0)
        and ($4 is null or (entity='calendar-events' and due_date::date >= $4 and due_date::date < ($4 + interval '1 month')::date))
    ), page as (
      select entity, record from filtered
      order by record->>'created_at' desc, entity, record->>'id' desc limit $2 offset $3
    )
    select jsonb_build_object(
      'records', coalesce((select jsonb_agg(to_jsonb(page)) from page), '[]'::jsonb),
      'total', (select count(*) from filtered),
      'allRows', (select count(*) from annotated),
      'openRows', (select count(*) from annotated where not terminal),
      'overdueRows', (select count(*) from annotated where overdue),
      'highRiskRows', (select count(*) from annotated where score >= 16))
  $query$;
  execute statement into result using coalesce(search_input,''), page_size_input, (page_input::bigint - 1) * page_size_input, calendar_month_input;
  return result;
end;
$function$;
revoke all on function public.governance_domain_page(text,text,integer,integer,date) from public, anon;
grant execute on function public.governance_domain_page(text,text,integer,integer,date) to authenticated;

