-- P0/P1 Incident response: CI context, response phases, command ownership,
-- notification clocks/timeline, and links to Problem/Change.

alter table public.incidents
  add column affected_ci_id uuid references public.configuration_items(id) on delete set null,
  add column detection_source text check (detection_source is null or char_length(detection_source) <= 150),
  add column containment text check (containment is null or char_length(containment) <= 3000),
  add column eradication text check (eradication is null or char_length(eradication) <= 3000),
  add column recovery text check (recovery is null or char_length(recovery) <= 3000),
  add column major_incident boolean not null default false,
  add column incident_commander_id uuid references public.profiles(id) on delete set null;

create index incidents_affected_ci_id_idx on public.incidents (affected_ci_id);
create index incidents_major_incident_idx on public.incidents (major_incident) where major_incident;
create index incidents_incident_commander_id_idx on public.incidents (incident_commander_id);

-- One clock per regulatory track. Deadlines are recorded by the authorised assessor;
-- no legal duration is hard-coded in the database.
create table public.incident_notification_clocks (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  clock_type text not null check (clock_type in ('PDPA', 'CYBER')),
  started_at timestamptz not null default now(),
  deadline_at timestamptz,
  status text not null default 'RUNNING' check (status in ('RUNNING', 'NOTIFIED', 'NOT_REQUIRED', 'EXPIRED')),
  notified_at timestamptz,
  reference_no text check (reference_no is null or char_length(reference_no) <= 250),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint incident_notification_clocks_unique unique (incident_id, clock_type),
  constraint incident_notification_clocks_deadline_after_start check (deadline_at is null or deadline_at >= started_at),
  constraint incident_notification_clocks_notified_consistent check (
    status <> 'NOTIFIED' or notified_at is not null
  )
);

create index incident_notification_clocks_incident_idx on public.incident_notification_clocks (incident_id);
create index incident_notification_clocks_deadline_idx on public.incident_notification_clocks (deadline_at)
  where status = 'RUNNING' and deadline_at is not null;

create trigger trg_incident_notification_clocks_set_updated_at
  before update on public.incident_notification_clocks
  for each row execute function public.set_updated_at();

create table public.incident_notification_timeline (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  event_type text not null check (event_type in (
    'REPORT_RECEIVED', 'DPO_ACKNOWLEDGED', 'PDPA_CLOCK_STARTED', 'PDPA_NOTIFIED',
    'CYBER_CLOCK_STARTED', 'CYBER_NOTIFIED', 'DATA_SUBJECT_NOTIFIED',
    'OTHER_REGULATOR_NOTIFIED', 'NOTIFICATION_RECORDED', 'OTHER'
  )),
  destination text check (destination is null or destination in ('PDPC', 'DATA_SUBJECT', 'NCSA', 'OTHER')),
  occurred_at timestamptz not null default now(),
  note text check (note is null or char_length(note) <= 2000),
  reference_no text check (reference_no is null or char_length(reference_no) <= 250),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index incident_notification_timeline_incident_idx
  on public.incident_notification_timeline (incident_id, occurred_at desc);

insert into public.incident_notification_timeline (incident_id, event_type, occurred_at, note, created_by)
select i.id, 'REPORT_RECEIVED', i.report_date, 'นำเข้าจาก Incident เดิม', i.created_by
from public.incidents i
where not exists (
  select 1 from public.incident_notification_timeline t
  where t.incident_id = i.id and t.event_type = 'REPORT_RECEIVED'
);

alter table public.incident_notification_clocks enable row level security;
alter table public.incident_notification_timeline enable row level security;

create policy incident_notification_clocks_select_visible on public.incident_notification_clocks
  for select to authenticated
  using (
    exists (
      select 1 from public.incidents i
      where i.id = incident_notification_clocks.incident_id
        and (
          i.reported_by = auth.uid()
          or i.assignee_id = auth.uid()
          or public.has_permission('incident.manage')
          or public.has_permission('incident.view_all')
          or (i.contains_personal_data and public.has_permission('incident.regulatory'))
        )
    )
  );

create policy incident_notification_timeline_select_visible on public.incident_notification_timeline
  for select to authenticated
  using (
    exists (
      select 1 from public.incidents i
      where i.id = incident_notification_timeline.incident_id
        and (
          i.reported_by = auth.uid()
          or i.assignee_id = auth.uid()
          or public.has_permission('incident.manage')
          or public.has_permission('incident.view_all')
          or (i.contains_personal_data and public.has_permission('incident.regulatory'))
        )
    )
  );

-- The Worker performs these writes after the same permission checks as the parent Incident route.
alter table public.change_requests
  add column source_incident_id uuid references public.incidents(id) on delete set null;

create index change_requests_source_incident_id_idx on public.change_requests (source_incident_id);
