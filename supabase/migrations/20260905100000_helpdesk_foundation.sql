-- ============================================================================
-- Help Desk Phase 2: database and security foundation
--
-- This migration evolves the existing Ticket module instead of creating a
-- parallel helpdesk_* model. Existing profiles, departments, assets,
-- notifications, file_attachments, audit_logs and knowledge_articles remain
-- the canonical shared modules.
-- ============================================================================

update public.system_settings
set support_status = 'active'
where key in ('SLA_BUSINESS_START', 'SLA_BUSINESS_END', 'SLA_BUSINESS_DAYS', 'SLA_HOLIDAYS');

-- ---------------------------------------------------------------------------
-- Configurable priority/status master data (ticket_value preserves the Thai
-- values already used by the API and UI).
-- ---------------------------------------------------------------------------
create table public.ticket_priorities (
  code text primary key check (code in ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  ticket_value text not null unique,
  name_th text not null,
  sort_order smallint not null default 0,
  color_token text not null default 'slate',
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.ticket_priorities (code, ticket_value, name_th, sort_order, color_token) values
  ('LOW', 'ต่ำ', 'ต่ำ', 10, 'slate'),
  ('MEDIUM', 'ปานกลาง', 'ปานกลาง', 20, 'blue'),
  ('HIGH', 'สูง', 'สูง', 30, 'amber'),
  ('URGENT', 'วิกฤต', 'วิกฤต', 40, 'red')
on conflict (code) do nothing;

create trigger trg_ticket_priorities_set_updated_at
  before update on public.ticket_priorities
  for each row execute function public.set_updated_at();

create table public.ticket_statuses (
  code text primary key,
  ticket_value text not null unique,
  name_th text not null,
  sort_order smallint not null default 0,
  is_terminal boolean not null default false,
  pauses_sla boolean not null default false,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.ticket_statuses
  (code, ticket_value, name_th, sort_order, is_terminal, pauses_sla) values
  ('NEW', 'ใหม่', 'ใหม่', 10, false, false),
  ('ACCEPTED', 'รับเรื่องแล้ว', 'รับเรื่องแล้ว', 20, false, false),
  ('IN_PROGRESS', 'กำลังดำเนินการ', 'กำลังดำเนินการ', 30, false, false),
  ('WAITING_USER', 'รอผู้ใช้งาน', 'รอผู้ใช้งาน', 40, false, true),
  ('WAITING_PART', 'รออะไหล่', 'รออะไหล่', 50, false, true),
  ('OUTSOURCED', 'ส่งต่อ Outsource', 'ส่งต่อ Outsource', 60, false, false),
  ('RESOLVED', 'เสร็จสิ้น', 'เสร็จสิ้น', 70, true, false),
  ('CLOSED', 'ปิดงาน', 'ปิดงาน', 80, true, false),
  ('CANCELLED', 'ยกเลิก', 'ยกเลิก', 90, true, false),
  ('ESCALATED', 'ยกระดับเป็น Incident', 'ยกระดับเป็น Incident', 100, true, false)
on conflict (code) do nothing;

create trigger trg_ticket_statuses_set_updated_at
  before update on public.ticket_statuses
  for each row execute function public.set_updated_at();

create table public.ticket_status_transitions (
  from_status_code text not null references public.ticket_statuses(code) on delete cascade,
  to_status_code text not null references public.ticket_statuses(code) on delete cascade,
  required_permission text not null,
  requires_note boolean not null default false,
  requires_resolution boolean not null default false,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  primary key (from_status_code, to_status_code),
  constraint ticket_status_transition_not_self check (from_status_code <> to_status_code)
);

insert into public.ticket_status_transitions
  (from_status_code, to_status_code, required_permission, requires_note, requires_resolution) values
  ('NEW', 'ACCEPTED', 'ticket.triage', false, false),
  ('NEW', 'IN_PROGRESS', 'ticket.triage', false, false),
  ('NEW', 'OUTSOURCED', 'ticket.update', true, false),
  ('NEW', 'CLOSED', 'ticket.close', false, true),
  ('NEW', 'CANCELLED', 'ticket.close', true, false),
  ('NEW', 'ESCALATED', 'ticket.escalate', true, false),
  ('ACCEPTED', 'IN_PROGRESS', 'ticket.update', false, false),
  ('ACCEPTED', 'WAITING_USER', 'ticket.update', true, false),
  ('ACCEPTED', 'WAITING_PART', 'ticket.update', true, false),
  ('ACCEPTED', 'OUTSOURCED', 'ticket.update', true, false),
  ('ACCEPTED', 'RESOLVED', 'ticket.update', false, true),
  ('ACCEPTED', 'CLOSED', 'ticket.close', false, true),
  ('ACCEPTED', 'CANCELLED', 'ticket.close', true, false),
  ('ACCEPTED', 'ESCALATED', 'ticket.escalate', true, false),
  ('IN_PROGRESS', 'WAITING_USER', 'ticket.update', true, false),
  ('IN_PROGRESS', 'WAITING_PART', 'ticket.update', true, false),
  ('IN_PROGRESS', 'OUTSOURCED', 'ticket.update', true, false),
  ('IN_PROGRESS', 'RESOLVED', 'ticket.update', false, true),
  ('IN_PROGRESS', 'CLOSED', 'ticket.close', false, true),
  ('IN_PROGRESS', 'CANCELLED', 'ticket.close', true, false),
  ('IN_PROGRESS', 'ESCALATED', 'ticket.escalate', true, false),
  ('WAITING_USER', 'IN_PROGRESS', 'ticket.update', false, false),
  ('WAITING_USER', 'WAITING_PART', 'ticket.update', true, false),
  ('WAITING_USER', 'OUTSOURCED', 'ticket.update', true, false),
  ('WAITING_USER', 'RESOLVED', 'ticket.update', false, true),
  ('WAITING_USER', 'CLOSED', 'ticket.close', false, true),
  ('WAITING_USER', 'CANCELLED', 'ticket.close', true, false),
  ('WAITING_USER', 'ESCALATED', 'ticket.escalate', true, false),
  ('WAITING_PART', 'IN_PROGRESS', 'ticket.update', false, false),
  ('WAITING_PART', 'WAITING_USER', 'ticket.update', true, false),
  ('WAITING_PART', 'OUTSOURCED', 'ticket.update', true, false),
  ('WAITING_PART', 'RESOLVED', 'ticket.update', false, true),
  ('WAITING_PART', 'CLOSED', 'ticket.close', false, true),
  ('WAITING_PART', 'CANCELLED', 'ticket.close', true, false),
  ('WAITING_PART', 'ESCALATED', 'ticket.escalate', true, false),
  ('OUTSOURCED', 'IN_PROGRESS', 'ticket.update', false, false),
  ('OUTSOURCED', 'WAITING_USER', 'ticket.update', true, false),
  ('OUTSOURCED', 'WAITING_PART', 'ticket.update', true, false),
  ('OUTSOURCED', 'RESOLVED', 'ticket.update', false, true),
  ('OUTSOURCED', 'CLOSED', 'ticket.close', false, true),
  ('OUTSOURCED', 'CANCELLED', 'ticket.close', true, false),
  ('OUTSOURCED', 'ESCALATED', 'ticket.escalate', true, false),
  ('RESOLVED', 'CLOSED', 'ticket.close', false, true),
  ('RESOLVED', 'IN_PROGRESS', 'ticket.close', true, false),
  ('CLOSED', 'IN_PROGRESS', 'ticket.close', true, false)
on conflict (from_status_code, to_status_code) do nothing;

create trigger trg_ticket_status_transitions_set_updated_at
  before update on public.ticket_status_transitions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Category hierarchy and SLA policies.
-- ---------------------------------------------------------------------------
alter table public.ticket_categories
  add column if not exists sort_order integer not null default 0;

create table public.ticket_subcategories (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.ticket_categories(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint ticket_subcategories_category_name_unique unique (category_id, name)
);

create index ticket_subcategories_category_status_idx
  on public.ticket_subcategories (category_id, status, sort_order);

create trigger trg_ticket_subcategories_set_updated_at
  before update on public.ticket_subcategories
  for each row execute function public.set_updated_at();

create table public.ticket_sla_policies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  priority_code text not null references public.ticket_priorities(code) on delete restrict,
  response_minutes integer not null check (response_minutes > 0),
  resolution_minutes integer not null check (resolution_minutes > 0),
  business_hours_only boolean not null default true,
  warning_percent smallint not null default 80 check (warning_percent between 1 and 100),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint ticket_sla_policy_dates_valid check (effective_to is null or effective_to > effective_from)
);

create unique index ticket_sla_policies_one_active_priority_idx
  on public.ticket_sla_policies (priority_code) where status = 'active';

create trigger trg_ticket_sla_policies_set_updated_at
  before update on public.ticket_sla_policies
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Legacy-compatible Ticket number allocation. Legacy generateId('TCK') uses
-- TCK-YYYYMMDD-<16 uppercase hex>; keep that public identifier so existing
-- users, reports and tracking records continue to match.
-- ---------------------------------------------------------------------------
create or replace function public.allocate_ticket_number(reference_at timestamptz)
returns text
language plpgsql
security definer
volatile
set search_path = public
as $$
begin
  return format(
    'TCK-%s-%s',
    to_char(coalesce(reference_at, now()) at time zone 'Asia/Bangkok', 'YYYYMMDD'),
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16))
  );
end;
$$;

revoke all on function public.allocate_ticket_number(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Evolve the existing tickets table. acknowledged_at and due_at remain the
-- compatibility names for accepted_at and resolution_due_at respectively.
-- ---------------------------------------------------------------------------
alter table public.tickets
  add column ticket_no text,
  add column department_id uuid references public.departments(id) on delete set null,
  add column subcategory_id uuid references public.ticket_subcategories(id) on delete set null,
  add column asset_id uuid references public.assets(id) on delete set null,
  add column room text,
  add column building text,
  add column started_at timestamptz,
  add column first_response_at timestamptz,
  add column root_cause text,
  add column sla_policy_id uuid references public.ticket_sla_policies(id) on delete set null,
  add column sla_paused_at timestamptz,
  add column sla_paused_minutes integer not null default 0 check (sla_paused_minutes >= 0),
  add column requester_email_snapshot text,
  add column requester_name_snapshot text,
  add column department_name_snapshot text,
  add column asset_name_snapshot text,
  add column assignee_name_snapshot text,
  add column evidence_link_legacy text,
  add column requester_identity_type text,
  add column source_service_request_id uuid references public.service_requests(id) on delete set null,
  add column idempotency_key text,
  add column legacy_sla_paused_ms bigint check (legacy_sla_paused_ms is null or legacy_sla_paused_ms >= 0),
  add column legacy_attachment_ids_json jsonb,
  add column deleted_at timestamptz;

do $$
declare
  ticket_row record;
begin
  for ticket_row in
    select id, created_at from public.tickets where ticket_no is null order by created_at, id
  loop
    update public.tickets
    set ticket_no = public.allocate_ticket_number(ticket_row.created_at)
    where id = ticket_row.id;
  end loop;
end;
$$;

alter table public.tickets
  alter column ticket_no set not null,
  add constraint tickets_ticket_no_unique unique (ticket_no),
  add constraint tickets_priority_master_fkey foreign key (priority)
    references public.ticket_priorities(ticket_value) on update cascade on delete restrict,
  add constraint tickets_status_master_fkey foreign key (status)
    references public.ticket_statuses(ticket_value) on update cascade on delete restrict;

create index tickets_ticket_no_idx on public.tickets (ticket_no);
create index tickets_department_id_idx on public.tickets (department_id);
create index tickets_subcategory_id_idx on public.tickets (subcategory_id);
create index tickets_asset_id_idx on public.tickets (asset_id);
create index tickets_source_service_request_id_idx on public.tickets (source_service_request_id)
  where source_service_request_id is not null;
create unique index tickets_idempotency_key_unique_idx on public.tickets (idempotency_key)
  where idempotency_key is not null;
create index tickets_sla_queue_idx on public.tickets (status, due_at)
  where closed_at is null and deleted_at is null;
create index tickets_created_at_idx on public.tickets (created_at desc);
create index tickets_search_idx on public.tickets using gin (
  to_tsvector(
    'simple',
    coalesce(ticket_no, '') || ' ' || coalesce(title, '') || ' ' || coalesce(description, '')
  )
);

-- Existing Knowledge Base is reused; this link supports "create draft from ticket".
alter table public.knowledge_articles
  add column source_ticket_id uuid references public.tickets(id) on delete set null;
create index knowledge_articles_source_ticket_id_idx
  on public.knowledge_articles (source_ticket_id) where source_ticket_id is not null;

-- ---------------------------------------------------------------------------
-- Permission helper for validating an assignee (same deny/override semantics as
-- has_permission(), but evaluates a specified active profile).
-- ---------------------------------------------------------------------------
create or replace function public.user_has_permission(user_id_input uuid, permission_key_input text)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_permission_id uuid;
  v_override_effect text;
  v_has_deny boolean;
  v_has_allow boolean;
begin
  if user_id_input is null or not exists (
    select 1 from public.profiles where id = user_id_input and status = 'active'
  ) then
    return false;
  end if;

  select id into v_permission_id
  from public.permissions
  where key = permission_key_input and status = 'active';

  if v_permission_id is null then
    return false;
  end if;

  select effect into v_override_effect
  from public.user_permission_overrides
  where user_id = user_id_input
    and permission_id = v_permission_id
    and status = 'active'
    and (start_at is null or start_at <= now())
    and (end_at is null or end_at >= now())
  order by (effect = 'deny') desc
  limit 1;

  if v_override_effect is not null then
    return v_override_effect = 'allow';
  end if;

  select bool_or(rp.effect = 'deny'), bool_or(rp.effect = 'allow')
  into v_has_deny, v_has_allow
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id and r.status = 'active'
  join public.role_permissions rp
    on rp.role_id = r.id and rp.permission_id = v_permission_id
  where ur.user_id = user_id_input;

  if v_has_deny then
    return false;
  end if;
  return coalesce(v_has_allow, false);
end;
$$;

revoke all on function public.user_has_permission(uuid, text) from public, anon, authenticated;

create or replace function public.guard_helpdesk_ticket()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_from_status_code text;
  v_to_status_code text;
  v_required_permission text;
  v_requires_resolution boolean;
  v_profile_department_id uuid;
begin
  if tg_op = 'INSERT' then
    if v_actor_id is not null then
      new.ticket_no := public.allocate_ticket_number(now());
      if new.requester_id <> v_actor_id then
        raise exception 'ไม่สามารถสร้าง Ticket ในนามผู้ใช้อื่นได้';
      end if;

      select department_id into v_profile_department_id
      from public.profiles where id = v_actor_id;

      new.department_id := v_profile_department_id;
      new.status := 'ใหม่';
      new.assignee_id := null;
      new.acknowledged_at := null;
      new.started_at := null;
      new.resolved_at := null;
      new.closed_at := null;
      new.resolution := null;
      new.root_cause := null;
      new.rating := null;
      new.feedback := null;
      new.feedback_at := null;
      new.created_at := now();
      new.updated_at := now();
      new.created_by := v_actor_id;
      new.updated_by := v_actor_id;
    else
      -- Controlled service-role importer may provide the original TicketID.
      new.ticket_no := coalesce(
        nullif(btrim(new.ticket_no), ''),
        public.allocate_ticket_number(new.created_at)
      );
    end if;

    if new.sla_policy_id is null then
      select policy.id into new.sla_policy_id
      from public.ticket_sla_policies policy
      join public.ticket_priorities priority on priority.code = policy.priority_code
      where priority.ticket_value = new.priority and policy.status = 'active'
      order by policy.effective_from desc
      limit 1;
    end if;

    return new;
  end if;

  -- A requester may submit feedback only. This closes the former row-level RLS
  -- mass-assignment gap where an owner could update status/assignee directly.
  if v_actor_id is not null
     and old.requester_id = v_actor_id
     and not public.has_permission('ticket.update')
     and not public.has_permission('ticket.assign')
     and not public.has_permission('ticket.close') then
    if (to_jsonb(new) - array['rating', 'feedback', 'feedback_at', 'updated_at'])
       is distinct from
       (to_jsonb(old) - array['rating', 'feedback', 'feedback_at', 'updated_at']) then
      raise exception 'ผู้แจ้งสามารถแก้ไขได้เฉพาะแบบประเมินความพึงพอใจ';
    end if;
  end if;

  if new.rating is distinct from old.rating
     or new.feedback is distinct from old.feedback
     or new.feedback_at is distinct from old.feedback_at then
    if v_actor_id is not null and v_actor_id <> old.requester_id then
      raise exception 'เฉพาะผู้แจ้งเท่านั้นที่ประเมินความพึงพอใจได้';
    end if;
    if old.status not in ('เสร็จสิ้น', 'ปิดงาน') then
      raise exception 'ประเมินความพึงพอใจได้หลังดำเนินการเสร็จหรือปิดงานแล้วเท่านั้น';
    end if;
    if old.feedback_at is not null then
      raise exception 'ไม่สามารถแก้ไขแบบประเมินที่ส่งแล้วได้';
    end if;
    if new.rating is null then
      raise exception 'กรุณาระบุคะแนนความพึงพอใจ';
    end if;
    new.feedback_at := now();
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    if v_actor_id is not null and not public.has_permission('ticket.assign') then
      raise exception 'ไม่มีสิทธิ์มอบหมายผู้รับผิดชอบ Ticket';
    end if;
    if new.assignee_id is not null
       and not (
         public.user_has_permission(new.assignee_id, 'ticket.update')
         or public.user_has_permission(new.assignee_id, 'ticket.assign')
       ) then
      raise exception 'ผู้รับผิดชอบต้องเป็นเจ้าหน้าที่ IT ที่ยังใช้งานอยู่';
    end if;
  end if;

  if new.status is distinct from old.status then
    select code into v_from_status_code from public.ticket_statuses where ticket_value = old.status;
    select code into v_to_status_code from public.ticket_statuses where ticket_value = new.status;

    select required_permission, requires_resolution
    into v_required_permission, v_requires_resolution
    from public.ticket_status_transitions
    where from_status_code = v_from_status_code
      and to_status_code = v_to_status_code
      and status = 'active';

    if v_required_permission is null then
      raise exception 'ไม่สามารถเปลี่ยนสถานะ Ticket จาก "%" เป็น "%" ได้', old.status, new.status;
    end if;
    if v_actor_id is not null and not public.has_permission(v_required_permission) then
      raise exception 'ไม่มีสิทธิ์เปลี่ยนสถานะ Ticket';
    end if;
    if v_requires_resolution and nullif(btrim(coalesce(new.resolution, '')), '') is null then
      raise exception 'กรุณาระบุผลการแก้ไขก่อนเปลี่ยนสถานะ';
    end if;

    if new.status = 'รับเรื่องแล้ว' then
      new.acknowledged_at := coalesce(new.acknowledged_at, now());
      new.first_response_at := coalesce(new.first_response_at, now());
    elsif new.status = 'กำลังดำเนินการ' then
      new.started_at := coalesce(new.started_at, now());
      if old.status in ('เสร็จสิ้น', 'ปิดงาน') then
        new.resolved_at := null;
        new.closed_at := null;
        if new.reopen_count = old.reopen_count then
          new.reopen_count := old.reopen_count + 1;
        end if;
      end if;
    elsif new.status = 'เสร็จสิ้น' then
      new.resolved_at := coalesce(new.resolved_at, now());
    elsif new.status = 'ปิดงาน' then
      new.resolved_at := coalesce(new.resolved_at, now());
      new.closed_at := coalesce(new.closed_at, now());
    elsif new.status = 'ยกเลิก' then
      new.closed_at := coalesce(new.closed_at, now());
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_tickets_helpdesk_guard
  before insert or update on public.tickets
  for each row execute function public.guard_helpdesk_ticket();

-- ---------------------------------------------------------------------------
-- Reuse ticket_worklogs as the unified append-only conversation/timeline ledger.
-- ---------------------------------------------------------------------------
alter table public.ticket_worklogs
  add column attachment_url_legacy text,
  add column actor_email_snapshot text,
  add column actor_identity_type text,
  add column updated_at timestamptz,
  add column entry_type text not null default 'timeline'
    check (entry_type in ('timeline', 'comment', 'internal_note', 'worklog')),
  add column old_value jsonb,
  add column new_value jsonb,
  add column started_at timestamptz,
  add column ended_at timestamptz,
  add column work_type text,
  add column metadata jsonb not null default '{}'::jsonb,
  add constraint ticket_worklogs_time_valid check (
    ended_at is null or started_at is null or ended_at >= started_at
  );

create index ticket_worklogs_timeline_idx
  on public.ticket_worklogs (ticket_id, created_at desc);
create index ticket_worklogs_entry_type_idx
  on public.ticket_worklogs (ticket_id, entry_type, created_at desc);

create or replace function public.guard_ticket_worklog_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.actor_id := auth.uid();
    new.created_at := now();
  end if;
  return new;
end;
$$;

create trigger trg_ticket_worklogs_guard_actor
  before insert on public.ticket_worklogs
  for each row execute function public.guard_ticket_worklog_actor();

-- SLA event ledger is append-only and intentionally separate from conversation.
create table public.ticket_sla_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  event_type text not null check (event_type in (
    'START', 'PAUSE', 'RESUME', 'RESPONSE_MET', 'RESPONSE_BREACHED',
    'RESOLUTION_MET', 'RESOLUTION_BREACHED', 'RECALCULATE'
  )),
  occurred_at timestamptz not null default now(),
  due_at_before timestamptz,
  due_at_after timestamptz,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index ticket_sla_events_ticket_idx
  on public.ticket_sla_events (ticket_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- RLS: ticket.view means module access/own records; ticket.view_all is the only
-- permission that grants organization-wide visibility.
-- ---------------------------------------------------------------------------
drop policy tickets_select_participant_or_staff on public.tickets;
create policy tickets_select_participant_or_staff on public.tickets
  for select to authenticated
  using (
    deleted_at is null
    and (
      requester_id = auth.uid()
      or assignee_id = auth.uid()
      or public.has_permission('ticket.view_all')
    )
  );

drop policy tickets_update_participant_or_staff on public.tickets;
create policy tickets_update_participant_or_staff on public.tickets
  for update to authenticated
  using (
    requester_id = auth.uid()
    or public.has_permission('ticket.update')
    or public.has_permission('ticket.assign')
    or public.has_permission('ticket.close')
    or public.has_permission('ticket.triage')
    or public.has_permission('ticket.escalate')
  )
  with check (
    requester_id = auth.uid()
    or public.has_permission('ticket.update')
    or public.has_permission('ticket.assign')
    or public.has_permission('ticket.close')
    or public.has_permission('ticket.triage')
    or public.has_permission('ticket.escalate')
  );

drop policy ticket_worklogs_select_participant_or_staff on public.ticket_worklogs;
drop policy ticket_worklogs_insert_with_permission on public.ticket_worklogs;

create policy ticket_worklogs_select_participant_or_staff on public.ticket_worklogs
  for select to authenticated
  using (
    public.has_permission('ticket.view_all')
    or exists (
      select 1 from public.tickets ticket
      where ticket.id = ticket_worklogs.ticket_id
        and (
          ticket.assignee_id = auth.uid()
          or (ticket.requester_id = auth.uid() and ticket_worklogs.is_public)
        )
    )
  );

create policy ticket_worklogs_insert_staff on public.ticket_worklogs
  for insert to authenticated
  with check (
    public.has_permission('ticket.update')
    and actor_id = auth.uid()
    and exists (
      select 1 from public.tickets ticket
      where ticket.id = ticket_worklogs.ticket_id
        and (
          ticket.assignee_id = auth.uid()
          or public.has_permission('ticket.view_all')
        )
    )
  );

create policy ticket_worklogs_insert_requester_comment on public.ticket_worklogs
  for insert to authenticated
  with check (
    public.has_permission('ticket.comment')
    and entry_type = 'comment'
    and is_public
    and actor_id = auth.uid()
    and exists (
      select 1 from public.tickets ticket
      where ticket.id = ticket_worklogs.ticket_id
        and ticket.requester_id = auth.uid()
        and ticket.status not in ('ปิดงาน', 'ยกเลิก')
    )
  );

alter table public.ticket_priorities enable row level security;
alter table public.ticket_statuses enable row level security;
alter table public.ticket_status_transitions enable row level security;
alter table public.ticket_subcategories enable row level security;
alter table public.ticket_sla_policies enable row level security;
alter table public.ticket_sla_events enable row level security;

create policy ticket_priorities_select_authenticated on public.ticket_priorities
  for select to authenticated using (true);
create policy ticket_priorities_manage on public.ticket_priorities
  for all to authenticated
  using (public.has_permission('ticket.settings.manage'))
  with check (public.has_permission('ticket.settings.manage'));

create policy ticket_statuses_select_authenticated on public.ticket_statuses
  for select to authenticated using (true);
create policy ticket_statuses_manage on public.ticket_statuses
  for all to authenticated
  using (public.has_permission('ticket.settings.manage'))
  with check (public.has_permission('ticket.settings.manage'));

create policy ticket_status_transitions_select_authenticated on public.ticket_status_transitions
  for select to authenticated using (true);
create policy ticket_status_transitions_manage on public.ticket_status_transitions
  for all to authenticated
  using (public.has_permission('ticket.settings.manage'))
  with check (public.has_permission('ticket.settings.manage'));

create policy ticket_subcategories_select_authenticated on public.ticket_subcategories
  for select to authenticated using (true);
create policy ticket_subcategories_manage on public.ticket_subcategories
  for all to authenticated
  using (public.has_permission('ticket_category.manage'))
  with check (public.has_permission('ticket_category.manage'));

create policy ticket_sla_policies_select_authenticated on public.ticket_sla_policies
  for select to authenticated using (true);
create policy ticket_sla_policies_manage on public.ticket_sla_policies
  for all to authenticated
  using (public.has_permission('ticket.settings.manage'))
  with check (public.has_permission('ticket.settings.manage'));

create policy ticket_sla_events_select_participant_or_staff on public.ticket_sla_events
  for select to authenticated
  using (
    exists (
      select 1 from public.tickets ticket
      where ticket.id = ticket_sla_events.ticket_id
        and (
          ticket.requester_id = auth.uid()
          or ticket.assignee_id = auth.uid()
          or public.has_permission('ticket.view_all')
        )
    )
  );
create policy ticket_sla_events_insert_staff on public.ticket_sla_events
  for insert to authenticated
  with check (
    public.has_permission('ticket.update')
    and (actor_id is null or actor_id = auth.uid())
  );

-- Update the attachment participant policy to use view_all rather than the
-- broad ticket.view permission.
drop policy file_attachments_select_ticket_participant on public.file_attachments;
create policy file_attachments_select_ticket_participant on public.file_attachments
  for select to authenticated
  using (
    module = 'ticket'
    and target_table = 'tickets'
    and exists (
      select 1 from public.tickets ticket
      where ticket.id::text = file_attachments.target_id
        and (
          ticket.requester_id = auth.uid()
          or ticket.assignee_id = auth.uid()
          or public.has_permission('ticket.view_all')
        )
    )
  );
