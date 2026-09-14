-- Service Request Automation
-- Additive only: existing catalog/request/checklist records remain valid.

alter table public.service_catalog
  add column if not exists auto_assign boolean not null default true,
  add column if not exists auto_create_task boolean not null default false,
  add column if not exists estimated_cost numeric,
  add column if not exists dependencies jsonb not null default '[]'::jsonb,
  add column if not exists suggested_knowledge jsonb not null default '[]'::jsonb;

alter table public.service_catalog
  add constraint service_catalog_estimated_cost_check
    check (estimated_cost is null or estimated_cost between 0 and 999999999.99),
  add constraint service_catalog_dependencies_array_check
    check (jsonb_typeof(dependencies) = 'array'),
  add constraint service_catalog_suggested_knowledge_array_check
    check (jsonb_typeof(suggested_knowledge) = 'array');

alter table public.service_requests
  add column if not exists service_owner_id uuid references public.profiles(id) on delete set null,
  add column if not exists estimated_cost numeric,
  add column if not exists fulfillment_task_id uuid references public.personal_tasks(id) on delete set null,
  add column if not exists fulfillment_started_at timestamptz,
  add column if not exists sla_paused_at timestamptz,
  add column if not exists sla_paused_minutes integer not null default 0,
  add column if not exists sla_pause_reason text;

alter table public.service_requests
  add constraint service_requests_estimated_cost_check
    check (estimated_cost is null or estimated_cost between 0 and 999999999.99),
  add constraint service_requests_sla_paused_minutes_check
    check (sla_paused_minutes >= 0);

create index if not exists service_requests_service_owner_id_idx
  on public.service_requests (service_owner_id);
create index if not exists service_requests_fulfillment_task_id_idx
  on public.service_requests (fulfillment_task_id)
  where fulfillment_task_id is not null;
create index if not exists service_requests_automation_queue_idx
  on public.service_requests (status, assigned_group_id, assignee_id)
  where status = 'รอมอบหมาย' and assignee_id is null;

-- A service request can be shown as a related record from the auto-created task.
alter table public.task_record_links
  drop constraint if exists task_record_links_record_type_check;
alter table public.task_record_links
  add constraint task_record_links_record_type_check
    check (record_type in ('incident', 'change', 'asset', 'contract', 'risk', 'service_request'));

create table public.service_request_sla_dispatches (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests(id) on delete cascade,
  milestone text not null check (milestone in ('WARNING', 'BREACHED')),
  due_at timestamptz not null,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  recipient_role text not null check (recipient_role in ('assignee', 'service_owner', 'fallback_admin')),
  dispatched_at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb,
  constraint service_request_sla_dispatches_once unique (request_id, milestone, recipient_id)
);

create index service_request_sla_dispatches_request_idx
  on public.service_request_sla_dispatches (request_id, dispatched_at desc);
create index service_request_sla_dispatches_milestone_idx
  on public.service_request_sla_dispatches (milestone, dispatched_at desc);

alter table public.service_request_sla_dispatches enable row level security;
create policy service_request_sla_dispatches_select_participant_or_staff
  on public.service_request_sla_dispatches
  for select to authenticated
  using (
    public.has_permission('service_request.view')
    or exists (
      select 1 from public.service_requests request
      where request.id = service_request_sla_dispatches.request_id
        and (request.requester_id = auth.uid() or request.assignee_id = auth.uid() or request.service_owner_id = auth.uid())
    )
  );

-- Select the least-loaded active profile in the fulfillment department. The row lock
-- prevents two concurrent automation runs from choosing the same candidate.
create or replace function public.auto_assign_service_request(
  request_id_input uuid,
  actor_id_input uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_row public.service_requests%rowtype;
  catalog_auto_assign boolean := true;
  catalog_auto_create_task boolean := false;
  catalog_attachment_required boolean := false;
  candidate_id uuid;
  task_id uuid;
  actor_id uuid;
  task_priority text;
begin
  select * into request_row
  from public.service_requests
  where id = request_id_input
  for update;

  if not found then
    return jsonb_build_object('assigned', false, 'reason', 'not_found');
  end if;

  if request_row.status <> 'รอมอบหมาย'
    or request_row.assignee_id is not null
    or request_row.assigned_group_id is null then
    return jsonb_build_object('assigned', false, 'reason', 'not_queued');
  end if;

  if request_row.catalog_id is null then
    return jsonb_build_object('assigned', false, 'reason', 'no_catalog');
  end if;

  select coalesce(auto_assign, true), coalesce(auto_create_task, false), coalesce(attachment_required, false)
    into catalog_auto_assign, catalog_auto_create_task, catalog_attachment_required
  from public.service_catalog
  where id = request_row.catalog_id;

  if not coalesce(catalog_auto_assign, true) then
    return jsonb_build_object('assigned', false, 'reason', 'disabled');
  end if;

  if catalog_attachment_required and not exists (
    select 1
    from public.file_attachments attachment
    where attachment.module = 'service_request'
      and attachment.target_table = 'service_requests'
      and attachment.target_id = request_row.id::text
  ) then
    return jsonb_build_object('assigned', false, 'reason', 'attachment_required');
  end if;

  select profile.id into candidate_id
  from public.profiles profile
  where profile.status = 'active'
    and profile.department_id = request_row.assigned_group_id
    and profile.id is distinct from request_row.requester_id
  order by (
    select count(*)
    from public.service_requests open_request
    where open_request.assignee_id = profile.id
      and open_request.status not in ('ปิดงาน', 'ปฏิเสธ', 'ยกเลิก')
  ), profile.id
  limit 1
  for update skip locked;

  if candidate_id is null then
    return jsonb_build_object('assigned', false, 'reason', 'no_active_staff');
  end if;

  actor_id := coalesce(actor_id_input, request_row.requester_id);
  update public.service_requests
  set assignee_id = candidate_id,
      status = 'กำลังดำเนินการ',
      fulfillment_started_at = coalesce(fulfillment_started_at, now()),
      updated_by = actor_id,
      updated_at = now()
  where id = request_row.id;

  insert into public.service_request_history
    (request_id, action, status_from, status_to, comment, is_public, actor_id)
  values
    (request_row.id, 'มอบหมายงานอัตโนมัติ', request_row.status, 'กำลังดำเนินการ',
     'ระบบเลือกผู้รับผิดชอบที่มีภาระงานน้อยที่สุดตาม Service', true, actor_id);

  if catalog_auto_create_task then
    task_priority := case request_row.priority
      when 'ต่ำ' then 'ต่ำ'
      when 'สูง' then 'สูง'
      when 'วิกฤต' then 'เร่งด่วน'
      else 'ปกติ'
    end;

    insert into public.personal_tasks
      (owner_id, title, description, task_type, category, priority, status,
       start_date, due_date, progress, tags, notes, sort_order, created_by, updated_by)
    values
      (candidate_id,
       left('[Service Request] ' || request_row.service_name || ' — ' || request_row.summary, 300),
       'งานที่สร้างอัตโนมัติจากคำขอบริการ ' || request_row.id::text,
       'other', 'งานทั่วไป', task_priority, 'ต้องทำ',
       (now() at time zone 'Asia/Bangkok')::date,
       (request_row.due_at at time zone 'Asia/Bangkok')::date,
       0,
       'service_request:' || request_row.service_code,
       'เปิดจาก Service Request ' || request_row.id::text,
       extract(epoch from clock_timestamp())::bigint,
       actor_id, actor_id)
    returning id into task_id;

    insert into public.task_record_links
      (task_id, owner_id, record_type, record_id, record_code, record_title, record_status)
    values
      (task_id, candidate_id, 'service_request', request_row.id,
       request_row.service_code, request_row.service_name, 'กำลังดำเนินการ');

    update public.service_requests
    set fulfillment_task_id = task_id,
        updated_at = now()
    where id = request_row.id;
  end if;

  return jsonb_build_object(
    'assigned', true,
    'assigneeId', candidate_id,
    'fulfillmentTaskId', task_id
  );
end;
$$;

revoke all on function public.auto_assign_service_request(uuid, uuid) from public, anon, authenticated;
grant execute on function public.auto_assign_service_request(uuid, uuid) to service_role;

-- Cron-safe, idempotent warning/breach escalation. A dispatch ledger prevents
-- duplicate notifications when the Worker is retried or overlaps with another run.
create or replace function public.dispatch_service_request_sla_escalations(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  warning_minutes integer := 60;
  escalate_on_breach boolean := true;
  candidate record;
  dispatch_id uuid;
  warning_count integer := 0;
  breach_count integer := 0;
  escalation_count integer := 0;
begin
  select greatest(5, least(1440, coalesce(nullif(value, '')::integer, 60)))
    into warning_minutes
  from public.system_settings
  where key = 'SLA_WARNING_MINUTES';
  warning_minutes := coalesce(warning_minutes, 60);

  select lower(coalesce(value, 'true')) = 'true'
    into escalate_on_breach
  from public.system_settings
  where key = 'SLA_ESCALATE_ON_BREACH';
  escalate_on_breach := coalesce(escalate_on_breach, true);

  for candidate in
    with milestones as (
      select
        request.id,
        request.service_code,
        request.service_name,
        request.summary,
        request.due_at,
        request.assignee_id,
        request.service_owner_id,
        case when p_now >= request.due_at then 'BREACHED' else 'WARNING' end as milestone
      from public.service_requests request
      where request.status not in ('ปิดงาน', 'ปฏิเสธ', 'ยกเลิก')
        and request.closed_at is null
        and request.due_at is not null
        and request.sla_paused_at is null
        and request.due_at <= p_now + make_interval(mins => warning_minutes)
    ), recipients as (
      select milestone.*, milestone.assignee_id as recipient_id, 'assignee'::text as recipient_role
      from milestones as milestone
      where milestone.assignee_id is not null

      union all

      select milestone.*, milestone.service_owner_id, 'service_owner'::text
      from milestones as milestone
      where milestone.service_owner_id is not null
        and milestone.service_owner_id is distinct from milestone.assignee_id

      union all

      select milestone.*, admin_user.user_id, 'fallback_admin'::text
      from milestones as milestone
      cross join lateral (
        select distinct user_role.user_id
        from public.user_roles user_role
        join public.roles role on role.id = user_role.role_id and role.key = 'it_admin' and role.status = 'active'
        join public.profiles profile on profile.id = user_role.user_id and profile.status = 'active'
      ) admin_user
      where escalate_on_breach
        and milestone.milestone = 'BREACHED'
        and milestone.service_owner_id is null
    )
    select * from recipients
  loop
    dispatch_id := null;
    insert into public.service_request_sla_dispatches
      (request_id, milestone, due_at, recipient_id, recipient_role, dispatched_at, detail)
    values
      (candidate.id, candidate.milestone, candidate.due_at, candidate.recipient_id,
       candidate.recipient_role, p_now,
       jsonb_build_object('warningMinutes', warning_minutes, 'serviceCode', candidate.service_code))
    on conflict (request_id, milestone, recipient_id) do nothing
    returning id into dispatch_id;

    if dispatch_id is null then
      continue;
    end if;

    insert into public.notifications (recipient_id, type, title, body, link)
    values (
      candidate.recipient_id,
      case when candidate.milestone = 'BREACHED' then 'service_request_sla_breached' else 'service_request_sla_warning' end,
      case when candidate.milestone = 'BREACHED'
        then candidate.service_code || ' เกิน SLA แล้ว'
        else candidate.service_code || ' ใกล้ครบกำหนด SLA'
      end,
      candidate.summary,
      '/service-requests/' || candidate.id::text
    );

    if candidate.milestone = 'BREACHED' then
      breach_count := breach_count + 1;
      if candidate.recipient_role in ('service_owner', 'fallback_admin') then
        escalation_count := escalation_count + 1;
      end if;
    else
      warning_count := warning_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'warnings', warning_count,
    'breaches', breach_count,
    'escalations', escalation_count
  );
end;
$$;

revoke all on function public.dispatch_service_request_sla_escalations(timestamptz) from public, anon, authenticated;
grant execute on function public.dispatch_service_request_sla_escalations(timestamptz) to service_role;
