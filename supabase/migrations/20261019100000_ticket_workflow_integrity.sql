-- Ticket workflow integrity hardening.
--
-- This migration keeps the public Ticket row compatible with the existing API,
-- while adding the pieces that cannot safely live only in a client request:
-- waiting metadata, immutable SLA rounds, optimistic concurrency for requester
-- sign-off, and status/worklog transactions.

alter table public.tickets
  add column if not exists waiting_reason text,
  add column if not exists waiting_owner_id uuid references public.profiles(id) on delete set null,
  add column if not exists waiting_follow_up_at timestamptz,
  add column if not exists waiting_since timestamptz;

create index if not exists tickets_waiting_follow_up_idx
  on public.tickets (waiting_follow_up_at)
  where waiting_follow_up_at is not null and closed_at is null and deleted_at is null;

comment on column public.tickets.waiting_reason is 'Why the Ticket is waiting for parts or the requester.';
comment on column public.tickets.waiting_owner_id is 'Staff member responsible for following up a waiting Ticket.';
comment on column public.tickets.waiting_follow_up_at is 'Next date/time to follow up a waiting Ticket.';
comment on column public.tickets.waiting_since is 'Start of the current waiting period.';

-- A Ticket can be linked to the exact PM round that exposed the issue.  Keep
-- this as a junction table because one PM round may explain several Tickets
-- and one Ticket may be corroborated by several PM rounds.
create table public.ticket_maintenance_links (
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  maintenance_plan_id uuid not null references public.maintenance_plans(id) on delete cascade,
  relationship text not null default 'root_cause' check (relationship in ('root_cause', 'related', 'follow_up')),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  primary key (ticket_id, maintenance_plan_id)
);

create index ticket_maintenance_links_plan_idx
  on public.ticket_maintenance_links (maintenance_plan_id, ticket_id);

alter table public.ticket_maintenance_links enable row level security;

create policy ticket_maintenance_links_select_with_maintenance_view
  on public.ticket_maintenance_links for select to authenticated
  using (public.has_permission('maintenance.view'));

create policy ticket_maintenance_links_write_with_maintenance_manage
  on public.ticket_maintenance_links for all to authenticated
  using (public.has_permission('maintenance.manage'))
  with check (public.has_permission('maintenance.manage'));

grant select on public.ticket_maintenance_links to authenticated;

-- Ticket creation and its first timeline entry must commit together.  This
-- trigger also covers Web and LINE creation paths, so neither client can leave
-- a newly created Ticket without its initial evidence row.
create or replace function public.create_ticket_initial_worklog()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.ticket_worklogs (
    ticket_id, action, detail, status_to, is_public, actor_id, actor_line_user_id
  ) values (
    new.id,
    'เปิด Ticket',
    case when new.source_channel = 'line' then 'สร้างผ่าน LINE' else 'สร้างผ่านระบบ' end,
    new.status,
    true,
    coalesce(new.created_by, new.requester_id),
    new.requester_line_user_id
  );
  return new;
end;
$$;

drop trigger if exists trg_tickets_initial_worklog on public.tickets;
create trigger trg_tickets_initial_worklog
  after insert on public.tickets
  for each row execute function public.create_ticket_initial_worklog();

create table public.ticket_sla_rounds (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  round_no integer not null check (round_no > 0),
  opened_at timestamptz not null,
  closed_at timestamptz,
  status text not null default 'open' check (status in ('open', 'resolved', 'closed', 'cancelled', 'escalated')),
  response_sla_hours numeric,
  resolution_sla_hours numeric,
  response_due_at timestamptz,
  resolution_due_at timestamptz,
  paused_minutes integer not null default 0 check (paused_minutes >= 0),
  paused_at timestamptz,
  response_met_at timestamptz,
  resolved_at timestamptz,
  response_sla_met boolean,
  resolution_sla_met boolean,
  is_inferred boolean not null default false,
  created_at timestamptz not null default now(),
  unique (ticket_id, round_no)
);

create index ticket_sla_rounds_ticket_idx
  on public.ticket_sla_rounds (ticket_id, round_no desc);

alter table public.ticket_sla_rounds enable row level security;

create policy ticket_sla_rounds_select_participant_or_staff
  on public.ticket_sla_rounds for select to authenticated
  using (
    exists (
      select 1 from public.tickets ticket
      where ticket.id = ticket_sla_rounds.ticket_id
        and (
          ticket.requester_id = auth.uid()
          or ticket.assignee_id = auth.uid()
          or public.has_permission('ticket.view')
        )
    )
  );

grant select on public.ticket_sla_rounds to authenticated;

-- Existing data gets one explicitly marked inferred round. Future reopen actions
-- create a new row, so the old due date and accumulated pause are never erased.
insert into public.ticket_sla_rounds (
  ticket_id, round_no, opened_at, closed_at, status,
  response_sla_hours, resolution_sla_hours, response_due_at, resolution_due_at,
  paused_minutes, paused_at, response_met_at, resolved_at,
  response_sla_met, resolution_sla_met, is_inferred
)
select
  ticket.id,
  1,
  ticket.created_at,
  case when ticket.status in ('เสร็จสิ้น', 'ปิดงาน', 'ยกเลิก', 'ยกระดับเป็น Incident')
    then coalesce(ticket.closed_at, ticket.resolved_at, ticket.created_at) end,
  case ticket.status
    when 'เสร็จสิ้น' then 'resolved'
    when 'ปิดงาน' then 'closed'
    when 'ยกเลิก' then 'cancelled'
    when 'ยกระดับเป็น Incident' then 'escalated'
    else 'open'
  end,
  ticket.response_sla_hours,
  ticket.resolution_sla_hours,
  ticket.response_due_at,
  ticket.due_at,
  coalesce(ticket.sla_paused_minutes, 0),
  ticket.sla_paused_at,
  ticket.first_response_at,
  ticket.resolved_at,
  case when ticket.first_response_at is null or ticket.response_due_at is null then null
    else ticket.first_response_at <= ticket.response_due_at end,
  case when ticket.resolved_at is null or ticket.due_at is null then null
    else ticket.resolved_at <= ticket.due_at end,
  true
from public.tickets ticket
on conflict (ticket_id, round_no) do nothing;

create or replace function public.ticket_sla_round_status(status_input text)
returns text
language sql
immutable
set search_path = public
as $$
  select case status_input
    when 'เสร็จสิ้น' then 'resolved'
    when 'ปิดงาน' then 'closed'
    when 'ยกเลิก' then 'cancelled'
    when 'ยกระดับเป็น Incident' then 'escalated'
    else 'open'
  end;
$$;

create or replace function public.sync_ticket_sla_round()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_round_no integer;
begin
  if tg_op = 'INSERT' then
    insert into public.ticket_sla_rounds (
      ticket_id, round_no, opened_at, status,
      response_sla_hours, resolution_sla_hours, response_due_at, resolution_due_at,
      paused_minutes, paused_at
    ) values (
      new.id, 1, new.created_at, public.ticket_sla_round_status(new.status),
      new.response_sla_hours, new.resolution_sla_hours, new.response_due_at, new.due_at,
      coalesce(new.sla_paused_minutes, 0), new.sla_paused_at
    ) on conflict (ticket_id, round_no) do nothing;
    return new;
  end if;

  select max(round_no) into current_round_no
  from public.ticket_sla_rounds
  where ticket_id = new.id;
  current_round_no := coalesce(current_round_no, 1);

  -- RESOLVED and CLOSED can be sent back to active work. Close their old SLA
  -- round first, then start a fresh round with its own deadline.
  if old.status in ('เสร็จสิ้น', 'ปิดงาน') and new.status = 'กำลังดำเนินการ' then
    update public.ticket_sla_rounds
    set closed_at = coalesce(old.closed_at, old.resolved_at, now()),
        status = public.ticket_sla_round_status(old.status),
        response_sla_met = case when old.first_response_at is null or old.response_due_at is null then null
          else old.first_response_at <= old.response_due_at end,
        resolution_sla_met = case when old.resolved_at is null or old.due_at is null then null
          else old.resolved_at <= old.due_at end,
        response_met_at = old.first_response_at,
        resolved_at = old.resolved_at
    where ticket_id = new.id and round_no = current_round_no;

    insert into public.ticket_sla_rounds (
      ticket_id, round_no, opened_at, status,
      response_sla_hours, resolution_sla_hours, response_due_at, resolution_due_at,
      paused_minutes, paused_at
    ) values (
      new.id, current_round_no + 1, coalesce(new.started_at, now()), 'open',
      new.response_sla_hours, new.resolution_sla_hours, new.response_due_at, new.due_at,
      coalesce(new.sla_paused_minutes, 0), new.sla_paused_at
    );
    return new;
  end if;

  update public.ticket_sla_rounds
  set status = public.ticket_sla_round_status(new.status),
      closed_at = case when new.status in ('เสร็จสิ้น', 'ปิดงาน', 'ยกเลิก', 'ยกระดับเป็น Incident')
        then coalesce(new.closed_at, new.resolved_at, closed_at) else closed_at end,
      response_sla_hours = new.response_sla_hours,
      resolution_sla_hours = new.resolution_sla_hours,
      response_due_at = new.response_due_at,
      resolution_due_at = new.due_at,
      paused_minutes = coalesce(new.sla_paused_minutes, 0),
      paused_at = new.sla_paused_at,
      response_met_at = new.first_response_at,
      resolved_at = new.resolved_at,
      response_sla_met = case when new.first_response_at is null or new.response_due_at is null then null
        else new.first_response_at <= new.response_due_at end,
      resolution_sla_met = case when new.resolved_at is null or new.due_at is null then null
        else new.resolved_at <= new.due_at end
  where ticket_id = new.id and round_no = current_round_no;
  return new;
end;
$$;

drop trigger if exists trg_tickets_sla_rounds on public.tickets;
create trigger trg_tickets_sla_rounds
  after insert or update of status, response_sla_hours, resolution_sla_hours,
    response_due_at, due_at, sla_paused_at, sla_paused_minutes,
    first_response_at, resolved_at, closed_at
  on public.tickets
  for each row execute function public.sync_ticket_sla_round();

-- The API validates these fields as well, but the database must reject an
-- incomplete waiting state even if a caller bypasses the API.
create or replace function public.guard_ticket_waiting_details()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('รออะไหล่', 'รอผู้ใช้งาน') then
    if nullif(btrim(coalesce(new.waiting_reason, '')), '') is null
       or new.waiting_owner_id is null
       or new.waiting_follow_up_at is null then
      raise exception 'กรุณาระบุเหตุผล ผู้ติดตาม และวันติดตามเมื่อพัก Ticket';
    end if;
    new.waiting_since := coalesce(old.waiting_since, new.waiting_since, now());
  elsif tg_op = 'UPDATE' and old.status in ('รออะไหล่', 'รอผู้ใช้งาน') then
    new.waiting_reason := null;
    new.waiting_owner_id := null;
    new.waiting_follow_up_at := null;
    new.waiting_since := null;
  end if;
  return new;
end;
$$;

create or replace function public.ensure_ticket_first_response()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.status <> 'กำลังดำเนินการ' and new.status = 'กำลังดำเนินการ' then
    new.started_at := coalesce(new.started_at, now());
    new.acknowledged_at := coalesce(new.acknowledged_at, now());
    new.first_response_at := coalesce(new.first_response_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tickets_z_waiting_details on public.tickets;
create trigger trg_tickets_z_waiting_details
  before update on public.tickets
  for each row execute function public.guard_ticket_waiting_details();

drop trigger if exists trg_tickets_z_first_response on public.tickets;
create trigger trg_tickets_z_first_response
  before update on public.tickets
  for each row execute function public.ensure_ticket_first_response();

-- Status changes and their timeline evidence are one transaction. The expected
-- status is an optimistic concurrency token, so stale browser tabs cannot append
-- a plausible-looking worklog to a different state.
create or replace function public.transition_ticket_with_worklog(
  ticket_id_input uuid,
  expected_status_input text,
  patch_input jsonb,
  action_input text,
  detail_input text default null,
  minutes_spent_input numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  current_ticket public.tickets%rowtype;
  candidate public.tickets%rowtype;
  updated_ticket public.tickets%rowtype;
  required_permission text;
  invalid_key text;
begin
  if actor_id is null then raise exception 'TICKET_ACTOR_REQUIRED'; end if;
  select * into current_ticket from public.tickets where id = ticket_id_input for update;
  if not found or current_ticket.status is distinct from expected_status_input then
    raise exception 'TICKET_STALE_STATE';
  end if;

  if current_ticket.requester_id is distinct from actor_id
     and current_ticket.assignee_id is distinct from actor_id
     and not public.has_permission('ticket.view') then
    raise exception 'TICKET_NOT_VISIBLE';
  end if;

  candidate := jsonb_populate_record(current_ticket, coalesce(patch_input, '{}'::jsonb));
  candidate.updated_by := actor_id;

  if candidate.status is distinct from current_ticket.status then
    select transition.required_permission into required_permission
    from public.ticket_status_transitions transition
    join public.ticket_statuses from_status on from_status.code = transition.from_status_code
    join public.ticket_statuses to_status on to_status.code = transition.to_status_code
    where from_status.ticket_value = current_ticket.status
      and to_status.ticket_value = candidate.status
      and transition.status = 'active';
    if required_permission is null or not public.has_permission(required_permission) then
      raise exception 'ไม่มีสิทธิ์เปลี่ยนสถานะ Ticket';
    end if;
  elsif candidate.assignee_id is distinct from current_ticket.assignee_id
        and not public.has_permission('ticket.assign') then
    raise exception 'ไม่มีสิทธิ์มอบหมายผู้รับผิดชอบ Ticket';
  elsif not public.has_permission('ticket.update') then
    if not public.has_permission('ticket.triage') then
      raise exception 'ไม่มีสิทธิ์แก้ไข Ticket';
    end if;
    for invalid_key in select key from jsonb_object_keys(coalesce(patch_input, '{}'::jsonb)) as key
      where key not in ('category_id', 'priority', 'assignee_id', 'is_security', 'updated_by')
    loop
      raise exception 'ไม่มีสิทธิ์แก้ไข field นี้';
    end loop;
  end if;

  update public.tickets
  set category_id = candidate.category_id,
      subcategory_id = candidate.subcategory_id,
      priority = candidate.priority,
      location = candidate.location,
      room = candidate.room,
      building = candidate.building,
      asset_id = candidate.asset_id,
      is_security = candidate.is_security,
      status = candidate.status,
      assignee_id = candidate.assignee_id,
      acknowledged_at = candidate.acknowledged_at,
      started_at = candidate.started_at,
      first_response_at = candidate.first_response_at,
      response_sla_hours = candidate.response_sla_hours,
      resolution_sla_hours = candidate.resolution_sla_hours,
      response_due_at = candidate.response_due_at,
      due_at = candidate.due_at,
      sla_policy_id = candidate.sla_policy_id,
      sla_paused_at = candidate.sla_paused_at,
      sla_paused_minutes = candidate.sla_paused_minutes,
      resolved_at = candidate.resolved_at,
      resolution = candidate.resolution,
      root_cause = candidate.root_cause,
      cause_code_id = candidate.cause_code_id,
      closed_at = candidate.closed_at,
      outsource_name = candidate.outsource_name,
      outsource_vendor_id = candidate.outsource_vendor_id,
      outsource_issue_no = candidate.outsource_issue_no,
      outsource_sent_at = candidate.outsource_sent_at,
      notes = candidate.notes,
      reopen_count = candidate.reopen_count,
      waiting_reason = candidate.waiting_reason,
      waiting_owner_id = candidate.waiting_owner_id,
      waiting_follow_up_at = candidate.waiting_follow_up_at,
      waiting_since = candidate.waiting_since,
      updated_by = actor_id
  where id = ticket_id_input and status = expected_status_input
  returning * into updated_ticket;
  if not found then raise exception 'TICKET_STALE_STATE'; end if;

  insert into public.ticket_worklogs (
    ticket_id, action, detail, status_from, status_to, minutes_spent, is_public, actor_id
  ) values (
    ticket_id_input, coalesce(nullif(btrim(action_input), ''), 'บันทึกการดำเนินงาน'), detail_input,
    current_ticket.status, updated_ticket.status, minutes_spent_input, true, actor_id
  );
  return to_jsonb(updated_ticket);
end;
$$;

revoke all on function public.transition_ticket_with_worklog(uuid, text, jsonb, text, text, numeric) from public, anon, authenticated;
grant execute on function public.transition_ticket_with_worklog(uuid, text, jsonb, text, text, numeric) to authenticated;

-- Service-side transitions (for integrations such as Ticket -> Incident) use
-- the same transaction boundary but receive the already authenticated actor.
create or replace function public.transition_ticket_with_worklog_service(
  ticket_id_input uuid,
  expected_status_input text,
  patch_input jsonb,
  action_input text,
  detail_input text default null,
  actor_id_input uuid default null,
  minutes_spent_input numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_ticket public.tickets%rowtype;
  candidate public.tickets%rowtype;
  updated_ticket public.tickets%rowtype;
begin
  -- EXECUTE is granted only to service_role below; keeping the guard at the
  -- privilege boundary avoids relying on current_user inside SECURITY DEFINER.
  if actor_id_input is null then raise exception 'TICKET_ACTOR_REQUIRED'; end if;

  select * into current_ticket from public.tickets where id = ticket_id_input for update;
  if not found or current_ticket.status is distinct from expected_status_input then
    raise exception 'TICKET_STALE_STATE';
  end if;

  candidate := jsonb_populate_record(current_ticket, coalesce(patch_input, '{}'::jsonb));
  update public.tickets
  set category_id = candidate.category_id,
      subcategory_id = candidate.subcategory_id,
      priority = candidate.priority,
      location = candidate.location,
      room = candidate.room,
      building = candidate.building,
      asset_id = candidate.asset_id,
      is_security = candidate.is_security,
      status = candidate.status,
      assignee_id = candidate.assignee_id,
      acknowledged_at = candidate.acknowledged_at,
      started_at = candidate.started_at,
      first_response_at = candidate.first_response_at,
      response_sla_hours = candidate.response_sla_hours,
      resolution_sla_hours = candidate.resolution_sla_hours,
      response_due_at = candidate.response_due_at,
      due_at = candidate.due_at,
      sla_policy_id = candidate.sla_policy_id,
      sla_paused_at = candidate.sla_paused_at,
      sla_paused_minutes = candidate.sla_paused_minutes,
      resolved_at = candidate.resolved_at,
      resolution = candidate.resolution,
      root_cause = candidate.root_cause,
      cause_code_id = candidate.cause_code_id,
      closed_at = candidate.closed_at,
      incident_id = candidate.incident_id,
      outsource_name = candidate.outsource_name,
      outsource_vendor_id = candidate.outsource_vendor_id,
      outsource_issue_no = candidate.outsource_issue_no,
      outsource_sent_at = candidate.outsource_sent_at,
      notes = candidate.notes,
      reopen_count = candidate.reopen_count,
      waiting_reason = candidate.waiting_reason,
      waiting_owner_id = candidate.waiting_owner_id,
      waiting_follow_up_at = candidate.waiting_follow_up_at,
      waiting_since = candidate.waiting_since,
      updated_by = actor_id_input
  where id = ticket_id_input and status = expected_status_input
  returning * into updated_ticket;
  if not found then raise exception 'TICKET_STALE_STATE'; end if;

  insert into public.ticket_worklogs (
    ticket_id, action, detail, status_from, status_to, minutes_spent, is_public, actor_id
  ) values (
    ticket_id_input, coalesce(nullif(btrim(action_input), ''), 'บันทึกการดำเนินงาน'), detail_input,
    current_ticket.status, updated_ticket.status, minutes_spent_input, true, actor_id_input
  );
  return to_jsonb(updated_ticket);
end;
$$;

revoke all on function public.transition_ticket_with_worklog_service(uuid, text, jsonb, text, text, uuid, numeric) from public, anon, authenticated;
grant execute on function public.transition_ticket_with_worklog_service(uuid, text, jsonb, text, text, uuid, numeric) to service_role;

-- Requester sign-off uploads the object first, then calls this function. The
-- function is the only operation that can turn RESOLVED into CLOSED and append
-- its evidence, and it returns a stale-state error when another actor won.
create or replace function public.complete_ticket_requester_signoff(
  ticket_id_input uuid,
  expected_status_input text,
  actor_id_input uuid,
  actor_line_user_id_input uuid,
  rating_input numeric,
  rating_details_input jsonb,
  rating_criteria_snapshot_input jsonb,
  feedback_input text,
  signature_path_input text,
  signed_at_input timestamptz,
  worklog_detail_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ticket public.tickets%rowtype;
  updated_ticket public.tickets%rowtype;
  signed_at_value timestamptz := coalesce(signed_at_input, now());
begin
  select * into ticket from public.tickets where id = ticket_id_input for update;
  if not found or ticket.status is distinct from expected_status_input or ticket.status <> 'เสร็จสิ้น' then
    raise exception 'TICKET_STALE_STATE';
  end if;
  if (actor_id_input is null or ticket.requester_id is distinct from actor_id_input)
     and (actor_line_user_id_input is null or ticket.requester_line_user_id is distinct from actor_line_user_id_input) then
    raise exception 'TICKET_REQUESTER_ONLY';
  end if;
  if rating_input is null or rating_input < 1 or rating_input > 5 or rating_input <> trunc(rating_input) then
    raise exception 'TICKET_RATING_INVALID';
  end if;
  if rating_details_input is null or not public.is_valid_ticket_rating_details(rating_details_input) then
    raise exception 'TICKET_RATING_INVALID';
  end if;
  if nullif(btrim(coalesce(signature_path_input, '')), '') is null then
    raise exception 'TICKET_SIGNATURE_REQUIRED';
  end if;

  update public.tickets
  set status = 'ปิดงาน',
      closed_at = signed_at_value,
      rating = rating_input::smallint,
      rating_details = rating_details_input,
      rating_criteria_snapshot = rating_criteria_snapshot_input,
      feedback = feedback_input,
      feedback_at = signed_at_value,
      requester_signature_storage_path = signature_path_input,
      requester_signature_uploaded_by = actor_id_input,
      requester_signature_uploaded_at = signed_at_value,
      updated_by = actor_id_input
  where id = ticket_id_input and status = expected_status_input
  returning * into updated_ticket;
  if not found then raise exception 'TICKET_STALE_STATE'; end if;

  insert into public.ticket_worklogs (
    ticket_id, action, detail, status_from, status_to, is_public, actor_id, actor_line_user_id
  ) values (
    ticket_id_input, 'ผู้แจ้งตรวจรับและลงนาม', worklog_detail_input,
    'เสร็จสิ้น', 'ปิดงาน', true, actor_id_input, actor_line_user_id_input
  );
  return to_jsonb(updated_ticket);
end;
$$;

revoke all on function public.complete_ticket_requester_signoff(uuid, text, uuid, uuid, numeric, jsonb, jsonb, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.complete_ticket_requester_signoff(uuid, text, uuid, uuid, numeric, jsonb, jsonb, text, text, timestamptz, text) to service_role;

-- Requester-facing "ยังใช้งานไม่ได้" action. It starts another SLA round and
-- leaves the prior closed/resolved round untouched for reporting.
create or replace function public.requester_reopen_ticket(
  ticket_id_input uuid,
  requester_id_input uuid,
  reason_input text,
  response_due_at_input timestamptz,
  resolution_due_at_input timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ticket public.tickets%rowtype;
  updated_ticket public.tickets%rowtype;
begin
  if nullif(btrim(coalesce(reason_input, '')), '') is null then raise exception 'TICKET_REOPEN_REASON_REQUIRED'; end if;
  select * into ticket
  from public.tickets
  where id = ticket_id_input
    and requester_id = requester_id_input
    and status in ('เสร็จสิ้น', 'ปิดงาน')
  for update;
  if not found then raise exception 'TICKET_REOPEN_STALE_STATE'; end if;

  update public.tickets
  set status = 'กำลังดำเนินการ',
      resolved_at = null,
      closed_at = null,
      resolution = null,
      sla_paused_at = null,
      sla_paused_minutes = 0,
      response_due_at = response_due_at_input,
      due_at = resolution_due_at_input,
      started_at = now(),
      acknowledged_at = coalesce(acknowledged_at, now()),
      first_response_at = coalesce(first_response_at, now()),
      waiting_reason = null,
      waiting_owner_id = null,
      waiting_follow_up_at = null,
      waiting_since = null,
      reopen_count = reopen_count + 1,
      updated_by = requester_id_input
  where id = ticket_id_input and status = ticket.status
  returning * into updated_ticket;
  if not found then raise exception 'TICKET_REOPEN_STALE_STATE'; end if;

  insert into public.ticket_worklogs (
    ticket_id, action, detail, status_from, status_to, is_public, actor_id
  ) values (
    ticket_id_input, 'ผู้แจ้งส่งกลับงาน', reason_input, ticket.status, 'กำลังดำเนินการ', true, requester_id_input
  );
  return to_jsonb(updated_ticket);
end;
$$;

revoke all on function public.requester_reopen_ticket(uuid, uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.requester_reopen_ticket(uuid, uuid, text, timestamptz, timestamptz) to service_role;

create or replace function public.line_requester_reopen_ticket(
  ticket_id_input uuid,
  requester_line_user_id_input uuid,
  actor_id_input uuid,
  reason_input text,
  response_due_at_input timestamptz,
  resolution_due_at_input timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ticket public.tickets%rowtype;
  updated_ticket public.tickets%rowtype;
begin
  if nullif(btrim(coalesce(reason_input, '')), '') is null then raise exception 'TICKET_REOPEN_REASON_REQUIRED'; end if;
  select * into ticket
  from public.tickets
  where id = ticket_id_input
    and requester_line_user_id = requester_line_user_id_input
    and status in ('เสร็จสิ้น', 'ปิดงาน')
  for update;
  if not found then raise exception 'TICKET_REOPEN_STALE_STATE'; end if;

  update public.tickets
  set status = 'กำลังดำเนินการ', resolved_at = null, closed_at = null, resolution = null,
      sla_paused_at = null, sla_paused_minutes = 0,
      response_due_at = response_due_at_input, due_at = resolution_due_at_input,
      started_at = now(), acknowledged_at = coalesce(acknowledged_at, now()),
      first_response_at = coalesce(first_response_at, now()), waiting_reason = null,
      waiting_owner_id = null, waiting_follow_up_at = null, waiting_since = null,
      reopen_count = reopen_count + 1, updated_by = actor_id_input
  where id = ticket_id_input and status = ticket.status
  returning * into updated_ticket;
  if not found then raise exception 'TICKET_REOPEN_STALE_STATE'; end if;

  insert into public.ticket_worklogs (
    ticket_id, action, detail, status_from, status_to, is_public, actor_id, actor_line_user_id
  ) values (
    ticket_id_input, 'ผู้แจ้งส่งกลับงาน', reason_input, ticket.status, 'กำลังดำเนินการ', true, actor_id_input, requester_line_user_id_input
  );
  return to_jsonb(updated_ticket);
end;
$$;

revoke all on function public.line_requester_reopen_ticket(uuid, uuid, uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.line_requester_reopen_ticket(uuid, uuid, uuid, text, timestamptz, timestamptz) to service_role;
