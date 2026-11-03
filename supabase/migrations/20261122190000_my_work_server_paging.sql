create function public.my_work_risk_label(value text) returns numeric
language sql immutable set search_path = '' as $$
  select case when value ~* 'วิกฤต|critical' then 25 when value ~* 'สูง|high|major' then 16
    when value ~* 'กลาง|ปานกลาง|medium|moderate' then 9 when value ~* 'ต่ำ|low|minor' then 4 else null end;
$$;

-- Targeted access for an approver without workflow.view, matching the existing
-- API behavior. This helper never returns approvals belonging to another user.
create function public.my_pending_workflow_items()
returns table(id uuid,title text,status text,due_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_allowed_session();
  return query select a.id, concat_ws(' · ',nullif(i.instance_code,''),coalesce(i.record_label,'งานอนุมัติ')),a.status,a.due_at
  from public.workflow_approvals a left join public.workflow_instances i on i.id = a.instance_id
  where (select public.has_permission('workflow.approve')) and a.approver_id = auth.uid() and a.status = 'รอพิจารณา';
end;
$$;
revoke all on function public.my_pending_workflow_items() from public, anon;
grant execute on function public.my_pending_workflow_items() to authenticated;

create function public.my_work_page(
  page_input integer default 1, scope_input text default 'all', source_input text default '',
  sort_input text default 'risk_sla_due', team_page_input integer default 1, snoozed_page_input integer default 1
) returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare actor uuid := auth.uid(); owner_tokens text[]; result jsonb;
begin
  if actor is null or not public.has_permission('dashboard.view') then raise exception using errcode='42501', message='MY_WORK_FORBIDDEN'; end if;
  if page_input not between 1 and 1000000 or team_page_input not between 1 and 1000000 or snoozed_page_input not between 1 and 1000000
    or scope_input not in ('all','approval','assigned','personal','overdue') or sort_input not in ('risk_sla_due','due_date')
    or length(source_input) > 100 then raise exception 'MY_WORK_PAGE_INVALID'; end if;
  select array_remove(array_remove(array[actor::text,lower(btrim(p.full_name)),lower(btrim(p.email))],null),'') into owner_tokens
    from public.profiles p where p.id = actor;
  execute $query$
    with raw as (select 'ticket'::text kind,t.id,'Ticket'::text source,t.ticket_no || ' · ' || t.title as title,t.status::text status,t.priority::text priority,t.due_at as due_at,t.sla_paused_at is not null as paused,coalesce(null::numeric,public.my_work_risk_label((t.priority)::text))::numeric as risk_score,'/tickets/' || t.id as path,'ดำเนินการ'::text action,false as team from public.tickets t  where (select public.has_permission('ticket.view')) and (t.assignee_id = $1 and t.status not in ('เสร็จสิ้น','ปิดงาน','ยกเลิก','ยกระดับเป็น Incident'))
union all
select 'ticket'::text kind,t.id,'Ticket Queue'::text source,t.ticket_no || ' · ' || t.title as title,t.status::text status,t.priority::text priority,t.due_at as due_at,t.sla_paused_at is not null as paused,coalesce(null::numeric,public.my_work_risk_label((t.priority)::text))::numeric as risk_score,'/tickets/' || t.id as path,'ดำเนินการ'::text action,true as team from public.tickets t  where (select public.has_permission('ticket.update')) and (t.assignee_id is null and t.status not in ('เสร็จสิ้น','ปิดงาน','ยกเลิก','ยกระดับเป็น Incident'))
union all
select 'service_request'::text kind,t.id,'คำขอบริการ'::text source,t.service_code || ' · ' || coalesce(nullif(t.summary,''),t.service_name) as title,t.status::text status,t.priority::text priority,t.due_at as due_at,false as paused,coalesce(null::numeric,public.my_work_risk_label((t.priority)::text))::numeric as risk_score,'/service-requests/' || t.id as path,'ดำเนินการ'::text action,false as team from public.service_requests t  where (select public.has_permission('service_request.view')) and (t.assignee_id = $1 and t.status not in ('ปิดงาน','ปฏิเสธ','ยกเลิก'))
union all
select 'service_request'::text kind,t.id,'Service Queue'::text source,t.service_code || ' · ' || coalesce(nullif(t.summary,''),t.service_name) as title,t.status::text status,t.priority::text priority,t.due_at as due_at,false as paused,coalesce(null::numeric,public.my_work_risk_label((t.priority)::text))::numeric as risk_score,'/service-requests/' || t.id as path,'ดำเนินการ'::text action,true as team from public.service_requests t  where (select public.has_permission('service_request.update')) and (t.assignee_id is null and t.status not in ('ปิดงาน','ปฏิเสธ','ยกเลิก'))
union all
select 'task'::text kind,t.id,'งานส่วนตัว'::text source,t.title as title,t.status::text status,t.priority::text priority,t.due_date::timestamptz as due_at,false as paused,coalesce(null::numeric,public.my_work_risk_label((t.priority)::text))::numeric as risk_score,'/tasks' as path,'เปิดงาน'::text action,false as team from public.personal_tasks t  where (select public.has_permission('task.view')) and (t.owner_id = $1 and t.status not in ('เสร็จแล้ว','ยกเลิก'))
union all
select 'service_approval'::text kind,t.id,'อนุมัติบริการ'::text source,t.service_code || ' · ' || coalesce(nullif(t.summary,''),t.service_name) as title,t.status::text status,t.priority::text priority,t.due_at as due_at,false as paused,coalesce(null::numeric,public.my_work_risk_label((t.priority)::text))::numeric as risk_score,'/service-requests/' || t.id as path,'พิจารณา'::text action,false as team from public.service_requests t  where (select public.has_permission('service_request.view')) and (t.status = 'รออนุมัติ' and exists(select 1 from public.approval_group_members m where m.group_id = t.approval_group_id and m.user_id = $1 and m.status = 'active'))
union all
select 'access_approval'::text kind,t.id,'คำขอสิทธิ์'::text source,coalesce(s.name,'ระบบ') || ' · ' || coalesce(upper(i.kind) || ' · ' || i.name,t.access_level,'') as title,t.status::text status,null::text::text priority,t.review_due::timestamptz as due_at,false as paused,coalesce(null::numeric,public.my_work_risk_label((null::text)::text))::numeric as risk_score,'/access-requests/' || t.id as path,'พิจารณา'::text action,false as team from public.access_requests t left join public.access_systems s on s.id = t.system_id left join public.access_control_items i on i.id = t.access_item_id where (select public.has_permission('access_request.view')) and (t.approver_id = $1 and t.status = 'รออนุมัติจากหัวหน้างาน')
union all
select 'access_fulfillment'::text kind,t.id,'คำขอสิทธิ์'::text source,coalesce(s.name,'ระบบ') || ' · ' || coalesce(upper(i.kind) || ' · ' || i.name,t.access_level,'') as title,t.status::text status,null::text::text priority,t.review_due::timestamptz as due_at,false as paused,coalesce(null::numeric,public.my_work_risk_label((null::text)::text))::numeric as risk_score,'/access-requests/' || t.id as path,'ดำเนินการให้สิทธิ์'::text action,false as team from public.access_requests t left join public.access_systems s on s.id = t.system_id left join public.access_control_items i on i.id = t.access_item_id where (select public.has_permission('access_request.process')) and (t.status = 'รอส่วนงานไอทีดำเนินการ' and (t.it_handler_id is null or t.it_handler_id = $1))
union all
select 'incident'::text kind,t.id,'Incident'::text source,t.incident_number || ' · ' || t.title as title,t.status::text status,t.severity::text priority,t.dpo_notify_deadline as due_at,false as paused,coalesce(nullif(t.risk_score,0),public.my_work_risk_label((t.severity)::text))::numeric as risk_score,'/incidents/' || t.id as path,'แก้ไข Incident'::text action,false as team from public.incidents t  where (select public.has_permission('incident.view')) and (t.assignee_id = $1 and t.status <> 'ปิดเคส')
union all
select 'incident'::text kind,t.id,'Incident Queue'::text source,t.incident_number || ' · ' || t.title as title,t.status::text status,t.severity::text priority,t.dpo_notify_deadline as due_at,false as paused,coalesce(nullif(t.risk_score,0),public.my_work_risk_label((t.severity)::text))::numeric as risk_score,'/incidents/' || t.id as path,'แก้ไข Incident'::text action,true as team from public.incidents t  where (select public.has_permission('incident.manage')) and (t.assignee_id is null and t.status <> 'ปิดเคส')
union all
select 'problem'::text kind,t.id,'Problem'::text source,t.problem_number || ' · ' || t.title as title,t.status::text status,t.priority::text priority,t.review_date::timestamptz as due_at,false as paused,coalesce(null::numeric,public.my_work_risk_label((t.priority)::text))::numeric as risk_score,'/problems/' || t.id as path,'จัดการ Problem'::text action,false as team from public.problems t  where (select public.has_permission('problem.view')) and (t.owner_id = $1 and t.status <> 'ปิด')
union all
select 'problem'::text kind,t.id,'Problem Queue'::text source,t.problem_number || ' · ' || t.title as title,t.status::text status,t.priority::text priority,t.review_date::timestamptz as due_at,false as paused,coalesce(null::numeric,public.my_work_risk_label((t.priority)::text))::numeric as risk_score,'/problems/' || t.id as path,'จัดการ Problem'::text action,true as team from public.problems t  where (select public.has_permission('problem.manage')) and (t.owner_id is null and t.status <> 'ปิด')
union all
select 'change_test'::text kind,t.id,'Change · รอทดสอบ'::text source,t.change_number || ' · ' || t.title as title,t.status::text status,t.risk_level::text priority,null::timestamptz as due_at,false as paused,coalesce(null::numeric,public.my_work_risk_label((t.risk_level)::text))::numeric as risk_score,'/changes/' || t.id as path,'ทดสอบ Change'::text action,false as team from public.change_requests t  where (select public.has_permission('change.test')) and (t.status = 'ยื่นคำขอ' and t.requester_id <> $1)
union all
select 'change_approval'::text kind,t.id,'Change · รออนุมัติ'::text source,t.change_number || ' · ' || t.title as title,t.status::text status,t.risk_level::text priority,null::timestamptz as due_at,false as paused,coalesce(null::numeric,public.my_work_risk_label((t.risk_level)::text))::numeric as risk_score,'/changes/' || t.id as path,'อนุมัติ Change'::text action,false as team from public.change_requests t  where (select public.has_permission('change.approve')) and (t.status = 'ผ่านการทดสอบ' and t.requester_id <> $1 and t.test_signoff_by <> $1)
union all
select 'vulnerability'::text kind,t.id,'Vulnerability'::text source,t.vulnerability_code || ' · ' || t.title as title,t.status::text status,t.severity::text priority,t.due_date::timestamptz as due_at,false as paused,coalesce(nullif(t.cvss,0),public.my_work_risk_label((t.severity)::text))::numeric as risk_score,'/vulnerabilities/' || t.id as path,'แก้ไขช่องโหว่'::text action,false as team from public.vulnerability_findings t  where (select public.has_permission('vulnerability.view')) and (t.owner_id = $1 and t.status <> 'ปิด')
union all
select 'backup'::text kind,t.id,'Backup'::text source,t.backup_code || ' · ' || t.system_name as title,t.result::text status,case when t.result ~ 'ล้มเหลว' then 'สูง' end::text priority,t.next_backup_due as due_at,false as paused,coalesce(null::numeric,public.my_work_risk_label((case when t.result ~ 'ล้มเหลว' then 'สูง' end)::text))::numeric as risk_score,'/backup-monitoring' as path,'ตรวจ Backup'::text action,false as team from public.backup_logs t  where (select public.has_permission('backup.view')) and (t.operator_id = $1 and t.next_backup_due < now() + interval '31 days')
union all
select 'recovery_test'::text kind,t.id,'Recovery Test'::text source,t.recovery_code || ' · ' || t.system_name as title,t.result::text status,case when t.result ~ 'ไม่ผ่าน' then 'สูง' end::text priority,t.next_test_due as due_at,false as paused,coalesce(null::numeric,public.my_work_risk_label((case when t.result ~ 'ไม่ผ่าน' then 'สูง' end)::text))::numeric as risk_score,'/backup-monitoring' as path,'วางแผนทดสอบ'::text action,false as team from public.recovery_tests t  where (select public.has_permission('backup.view')) and (t.tester_id = $1 and t.next_test_due < now() + interval '31 days')
union all
select 'log_review'::text kind,t.id,'Log Review'::text source,t.log_system_code || ' · ' || t.system_name as title,t.status::text status,null::text::text priority,t.next_review_due as due_at,false as paused,coalesce(null::numeric,public.my_work_risk_label((null::text)::text))::numeric as risk_score,'/backup-monitoring' as path,'ตรวจ Log'::text action,false as team from public.logging_systems t  where (select public.has_permission('monitoring.view')) and (t.responsible_id = $1 and t.status = 'ใช้งาน' and t.next_review_due < now() + interval '31 days')
union all
select 'log_review'::text kind,t.id,'Log Review · Finding'::text source,t.review_code || ' · ' || t.period as title,t.status::text status,'สูง'::text priority,null::timestamptz as due_at,false as paused,coalesce(null::numeric,public.my_work_risk_label(('สูง')::text))::numeric as risk_score,'/backup-monitoring' as path,'ติดตาม Finding'::text action,false as team from public.log_reviews t  where (select public.has_permission('monitoring.view')) and (t.reviewer_id = $1 and t.status <> 'แก้ไขแล้ว' and (t.anomaly_found or t.status <> 'ปกติ'))
union all
select 'contract_renewal'::text kind,t.id,'Contract Renewal'::text source,t.contract_number || ' · ' || t.name as title,t.status::text status,null::text::text priority,t.end_date::timestamptz as due_at,false as paused,coalesce(null::numeric,public.my_work_risk_label((null::text)::text))::numeric as risk_score,'/vendors-contracts' as path,'ต่ออายุสัญญา'::text action,false as team from public.contracts t  where (select public.has_permission('contract.view')) and (t.owner_id = $1 and t.status = 'Active' and t.end_date::timestamptz < now() + make_interval(days => coalesce(t.renewal_notice_days,30) + 1))
union all
select 'contract_renewal'::text kind,t.id,'Contract Queue'::text source,t.contract_number || ' · ' || t.name as title,t.status::text status,null::text::text priority,t.end_date::timestamptz as due_at,false as paused,coalesce(null::numeric,public.my_work_risk_label((null::text)::text))::numeric as risk_score,'/vendors-contracts' as path,'ต่ออายุสัญญา'::text action,true as team from public.contracts t  where (select public.has_permission('contract.manage')) and (t.owner_id is null and t.status = 'Active')
union all
select 'license_renewal'::text kind,t.id,'License Renewal'::text source,coalesce(t.license_code,'LIC') || ' · ' || t.software_name as title,t.status::text status,null::text::text priority,t.expire_date::timestamptz as due_at,false as paused,coalesce(null::numeric,public.my_work_risk_label((null::text)::text))::numeric as risk_score,'/software-licenses' as path,'ต่ออายุ License'::text action,false as team from public.software_licenses t  where (select public.has_permission('license.view')) and (t.status = 'Active' and t.expire_date::timestamptz < now() + make_interval(days => coalesce(t.expiry_notice_days,30) + 1))
union all
select 'governance_capa'::text kind,t.id,'Governance CAPA'::text source,t.action_code || ' · ' || t.title as title,t.status::text status,t.priority::text priority,t.due_date::timestamptz as due_at,false as paused,coalesce(null::numeric,public.my_work_risk_label((t.priority)::text))::numeric as risk_score,'/governance' as path,'ดำเนินการ CAPA'::text action,false as team from public.compliance_corrective_actions t  where (select public.has_permission('compliance.view')) and (lower(btrim(coalesce(t.owner,''))) = any($2) and t.status <> 'ปิด')
union all
select 'risk_treatment'::text kind,t.id,'Risk Treatment'::text source,t.risk_code || ' · ' || t.title as title,t.status::text status,t.risk_score::text::text priority,t.due_date::timestamptz as due_at,false as paused,coalesce(nullif(t.risk_score,0),public.my_work_risk_label((t.risk_score::text)::text))::numeric as risk_score,'/governance' as path,'จัดการ Risk'::text action,false as team from public.governance_risks t  where (select public.has_permission('risk.view')) and ((lower(btrim(coalesce(t.owner,''))) = any($2) or lower(btrim(coalesce(t.treatment_owner,''))) = any($2)) and t.status <> 'ปิด')
union all
select 'audit_finding'::text kind,t.id,'Audit Finding'::text source,t.finding_code || ' · ' || t.title as title,t.status::text status,t.finding_type::text priority,t.due_date::timestamptz as due_at,false as paused,coalesce(null::numeric,public.my_work_risk_label((t.finding_type)::text))::numeric as risk_score,'/governance' as path,'แก้ Audit Finding'::text action,false as team from public.audit_findings t  where (select public.has_permission('audit_management.view')) and (lower(btrim(coalesce(t.owner,''))) = any($2) and t.status <> 'ปิด')
union all
select 'workflow_approval'::text kind,t.id,'Workflow'::text source,t.title,t.status,null::text priority,t.due_at,false paused,null::numeric risk_score,'/workflows'::text path,'พิจารณา'::text action,false team from public.my_pending_workflow_items() t),
    hydrated as (
      select r.*,s.snoozed_until, case when r.paused then 'paused' when r.due_at is null then 'none'
        when r.due_at < now() then 'overdue' when r.due_at <= now() + interval '4 hours' then 'due_soon' else 'on_track' end as sla_state
      from raw r left join public.my_work_snoozes s on s.user_id = $1 and s.work_key = r.kind || ':' || r.id::text and s.snoozed_until > now()
    ), enriched as (select *, jsonb_build_object('id',id,'kind',kind,'source',source,'title',title,'status',status,'priority',priority,
        'dueAt',due_at,'slaPaused',paused,'riskScore',risk_score,'slaState',sla_state,
        'slaRemainingSeconds',case when due_at is null then null else round(extract(epoch from (due_at - now()))) end,
        'isOverdue',sla_state='overdue','snoozedUntil',null,'path',path,'action',action) as item from hydrated), visible as (select * from enriched where not team and snoozed_until is null),
    filtered as (
      select * from visible where ($4 = '' or source = $4) and
        ($3 = 'all' or ($3 = 'approval' and kind in ('service_approval','access_approval','workflow_approval','change_test','change_approval'))
        or ($3 = 'assigned' and kind in ('ticket','service_request','access_fulfillment','incident','problem','vulnerability','backup','recovery_test','log_review','contract_renewal','license_renewal','governance_capa','risk_treatment','audit_finding'))
        or ($3 = 'personal' and kind = 'task') or ($3 = 'overdue' and sla_state = 'overdue'))
    ), page as (
      select *
      from filtered order by case when $5 = 'risk_sla_due' then risk_score end desc nulls last,
        case when $5 = 'risk_sla_due' then case sla_state when 'overdue' then 0 when 'due_soon' then 1 when 'on_track' then 2 when 'paused' then 3 else 4 end end,
        due_at nulls last,title,kind,id limit 20 offset $6
    ), team_page as (
      select * from hydrated where team order by risk_score desc nulls last,
        case sla_state when 'overdue' then 0 when 'due_soon' then 1 when 'on_track' then 2 when 'paused' then 3 else 4 end,
        due_at nulls last,title,kind,id limit 6 offset $7
    ), snoozed_page as (
      select * from hydrated where not team and snoozed_until is not null order by snoozed_until,kind,id limit 25 offset $8
    )
    select jsonb_build_object(
      'items',coalesce((select jsonb_agg(item) from page),'[]'::jsonb),
      'teamQueue',coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'source',source,'title',title,'status',status,'priority',priority,'dueAt',due_at,'riskScore',risk_score,'path',path)) from team_page),'[]'::jsonb),
      'snoozedItems',coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'title',title,'snoozedUntil',snoozed_until)) from snoozed_page),'[]'::jsonb),
      'savedViews',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'scope',scope,'sourceKind',source_kind,'sortBy',sort_by,'updatedAt',updated_at) order by updated_at desc,id)
        from public.my_work_saved_views where user_id = $1),'[]'::jsonb),
      'todayItems',coalesce((select jsonb_agg(item) from (select item from visible where (due_at at time zone 'Asia/Bangkok')::date = (now() at time zone 'Asia/Bangkok')::date order by due_at,kind,id limit 4) t),'[]'::jsonb),
      'delegatedItems',coalesce((select jsonb_agg(item) from (select item from visible where kind not in ('service_approval','access_approval','workflow_approval','change_test','change_approval','task') order by risk_score desc nulls last,due_at nulls last,kind,id limit 3) t),'[]'::jsonb),
      'sourceOptions',coalesce((select jsonb_agg(source order by source) from (select distinct source from visible) s),'[]'::jsonb),
      'summary',jsonb_build_object('total',(select count(*) from visible),'overdue',(select count(*) from hydrated where not team and sla_state='overdue'),
        'approvals',(select count(*) from visible where kind in ('service_approval','access_approval','workflow_approval','change_test','change_approval')),
        'assigned',(select count(*) from visible where kind in ('ticket','service_request','access_fulfillment','incident','problem','vulnerability')),
        'snoozed',(select count(*) from hydrated where not team and snoozed_until is not null),'teamQueue',(select count(*) from hydrated where team)),
      'pagination',jsonb_build_object('page',$9,'pageSize',20,'total',(select count(*) from filtered),'teamPage',$10,'teamPageSize',6,'snoozedPage',$11,'snoozedPageSize',25),
      'generatedAt',now())
  $query$ into result using actor,coalesce(owner_tokens,array[actor::text]),scope_input,source_input,sort_input,
    (page_input::bigint-1)*20,(team_page_input::bigint-1)*6,(snoozed_page_input::bigint-1)*25,page_input,team_page_input,snoozed_page_input;
  return result;
end;
$function$;
revoke all on function public.my_work_page(integer,text,text,text,integer,integer) from public, anon;
grant execute on function public.my_work_page(integer,text,text,text,integer,integer) to authenticated;

