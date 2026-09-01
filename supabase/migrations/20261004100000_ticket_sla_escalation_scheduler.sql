-- Automatic ticket SLA warning, breach and supervisor escalation.
-- The dispatch ledger is both evidence and the idempotency boundary: the same
-- ticket/milestone/recipient can be emitted only once even when cron retries.

insert into public.system_settings
  (key, value, description, group_key, value_type, min_value, max_value, options, is_editable, support_status, sort_order)
values
  ('SLA_WARNING_MINUTES', '60', 'จำนวนนาทีที่แจ้งเตือนก่อน Ticket ผิด SLA', 'Ticket SLA', 'number', 5, 1440, '[]', true, 'active', 1140),
  ('SLA_ESCALATE_ON_BREACH', 'true', 'แจ้งหัวหน้างานเมื่อ Ticket ผิด SLA', 'Ticket SLA', 'boolean', null, null, '[]', true, 'active', 1150)
on conflict (key) do update set
  description = excluded.description,
  group_key = excluded.group_key,
  value_type = excluded.value_type,
  min_value = excluded.min_value,
  max_value = excluded.max_value,
  options = excluded.options,
  is_editable = excluded.is_editable,
  support_status = excluded.support_status,
  sort_order = excluded.sort_order;

create table public.ticket_sla_dispatches (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete restrict,
  milestone text not null check (milestone in (
    'RESPONSE_WARNING', 'RESPONSE_BREACHED',
    'RESOLUTION_WARNING', 'RESOLUTION_BREACHED'
  )),
  due_at timestamptz not null,
  recipient_id uuid not null,
  recipient_role text not null check (recipient_role in ('assignee', 'supervisor', 'fallback_admin')),
  dispatched_at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb,
  constraint ticket_sla_dispatches_once unique (ticket_id, milestone, recipient_id)
);

create index ticket_sla_dispatches_ticket_idx
  on public.ticket_sla_dispatches (ticket_id, dispatched_at desc);
create index ticket_sla_dispatches_milestone_idx
  on public.ticket_sla_dispatches (milestone, dispatched_at desc);

alter table public.ticket_sla_dispatches enable row level security;
create policy ticket_sla_dispatches_select_staff on public.ticket_sla_dispatches
  for select to authenticated
  using (
    public.has_permission('ticket.view_all')
    or exists (
      select 1 from public.tickets ticket
      where ticket.id = ticket_sla_dispatches.ticket_id
        and (ticket.requester_id = auth.uid() or ticket.assignee_id = auth.uid())
    )
  );

create or replace function public.dispatch_ticket_sla_escalations(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_warning_minutes integer := 60;
  v_escalate boolean := true;
  v_candidate record;
  v_dispatch_id uuid;
  v_warning_count integer := 0;
  v_breach_count integer := 0;
  v_escalation_count integer := 0;
begin
  select greatest(5, least(1440, coalesce(nullif(value, '')::integer, 60)))
    into v_warning_minutes
  from public.system_settings
  where key = 'SLA_WARNING_MINUTES';
  v_warning_minutes := coalesce(v_warning_minutes, 60);

  select lower(coalesce(value, 'true')) = 'true'
    into v_escalate
  from public.system_settings
  where key = 'SLA_ESCALATE_ON_BREACH';
  v_escalate := coalesce(v_escalate, true);

  for v_candidate in
    with active_tickets as (
      select
        ticket.id,
        ticket.ticket_no,
        ticket.title,
        ticket.assignee_id,
        assignee.supervisor_id,
        supervisor.status as supervisor_status,
        ticket.response_due_at,
        ticket.due_at
      from public.tickets ticket
      left join public.profiles assignee on assignee.id = ticket.assignee_id and assignee.status = 'active'
      left join public.profiles supervisor on supervisor.id = assignee.supervisor_id
      where ticket.deleted_at is null
        and ticket.status not in ('เสร็จสิ้น', 'ปิดงาน', 'ยกเลิก', 'ยกระดับเป็น Incident')
        and ticket.closed_at is null
        and ticket.resolved_at is null
        and ticket.sla_paused_at is null
    ), milestones as (
      select id, ticket_no, title, assignee_id, supervisor_id, supervisor_status,
        response_due_at as due_at,
        case when p_now >= response_due_at then 'RESPONSE_BREACHED' else 'RESPONSE_WARNING' end as milestone
      from active_tickets
      where response_due_at is not null
        and response_due_at <= p_now + make_interval(mins => v_warning_minutes)
        and not exists (
          select 1 from public.tickets current_ticket
          where current_ticket.id = active_tickets.id and current_ticket.acknowledged_at is not null
        )
      union all
      select id, ticket_no, title, assignee_id, supervisor_id, supervisor_status,
        due_at,
        case when p_now >= due_at then 'RESOLUTION_BREACHED' else 'RESOLUTION_WARNING' end as milestone
      from active_tickets
      where due_at is not null
        and due_at <= p_now + make_interval(mins => v_warning_minutes)
    ), recipients as (
      select milestone.*, milestone.assignee_id as recipient_id, 'assignee'::text as recipient_role
      from milestones milestone
      where milestone.assignee_id is not null

      union all

      select milestone.*, milestone.supervisor_id, 'supervisor'::text
      from milestones milestone
      where v_escalate
        and right(milestone.milestone, 9) = '_BREACHED'
        and milestone.supervisor_id is not null
        and milestone.supervisor_status = 'active'
        and milestone.supervisor_id is distinct from milestone.assignee_id

      union all

      select milestone.*, admins.user_id, 'fallback_admin'::text
      from milestones milestone
      cross join lateral (
        select distinct user_role.user_id
        from public.user_roles user_role
        join public.roles role on role.id = user_role.role_id and role.key = 'it_admin' and role.status = 'active'
        join public.profiles profile on profile.id = user_role.user_id and profile.status = 'active'
      ) admins
      where v_escalate
        and right(milestone.milestone, 9) = '_BREACHED'
        and (
          milestone.assignee_id is null
          or milestone.supervisor_id is null
          or milestone.supervisor_status is distinct from 'active'
        )
    )
    select * from recipients
  loop
    v_dispatch_id := null;
    insert into public.ticket_sla_dispatches
      (ticket_id, milestone, due_at, recipient_id, recipient_role, dispatched_at, detail)
    values (
      v_candidate.id,
      v_candidate.milestone,
      v_candidate.due_at,
      v_candidate.recipient_id,
      v_candidate.recipient_role,
      p_now,
      jsonb_build_object('warningMinutes', v_warning_minutes, 'ticketNo', v_candidate.ticket_no)
    )
    on conflict (ticket_id, milestone, recipient_id) do nothing
    returning id into v_dispatch_id;

    if v_dispatch_id is null then
      continue;
    end if;

    insert into public.notifications (recipient_id, type, title, body, link)
    values (
      v_candidate.recipient_id,
      lower(v_candidate.milestone),
      case
        when v_candidate.milestone = 'RESPONSE_WARNING' then v_candidate.ticket_no || ' ใกล้ผิด Response SLA'
        when v_candidate.milestone = 'RESPONSE_BREACHED' then v_candidate.ticket_no || ' ผิด Response SLA แล้ว'
        when v_candidate.milestone = 'RESOLUTION_WARNING' then v_candidate.ticket_no || ' ใกล้ผิด Resolution SLA'
        else v_candidate.ticket_no || ' ผิด Resolution SLA แล้ว'
      end,
      case
        when v_candidate.recipient_role in ('supervisor', 'fallback_admin')
          then 'ระบบยกระดับ Ticket ถึงหัวหน้าทีม: ' || v_candidate.title
        else v_candidate.title
      end,
      '/tickets/' || v_candidate.id::text
    );

    if right(v_candidate.milestone, 8) = '_WARNING' then
      v_warning_count := v_warning_count + 1;
    else
      v_breach_count := v_breach_count + 1;
      if v_candidate.recipient_role in ('supervisor', 'fallback_admin') then
        v_escalation_count := v_escalation_count + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'warnings', v_warning_count,
    'breaches', v_breach_count,
    'escalations', v_escalation_count
  );
end;
$$;

revoke all on function public.dispatch_ticket_sla_escalations(timestamptz) from public, anon, authenticated;
grant execute on function public.dispatch_ticket_sla_escalations(timestamptz) to service_role;
