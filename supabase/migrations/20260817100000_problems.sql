-- ============================================================================
-- Phase 6 Module 11: Problem Management + Known Error Database
--
-- Ground truth: legacy-gas/Module_Assurance.gs, Assurance.html และ Config.gs
-- ย้าย RCA, workaround, permanent fix และ Known Error โดย normalize ความสัมพันธ์
-- Ticket/Incident ที่ legacy เก็บเป็น comma-separated text ให้เป็น FK จริง
-- Knowledge Base อยู่ลำดับ 18 จึงเก็บ reference เดิมไว้ก่อนโดยยังไม่สร้าง FK ข้ามโมดูล
-- ============================================================================

create table public.problems (
  id uuid primary key default gen_random_uuid(),
  problem_number text not null unique,
  legacy_id text unique,
  title text not null check (char_length(title) <= 200),
  category text check (char_length(category) <= 100),
  affected_system text check (char_length(affected_system) <= 200),
  impact text check (char_length(impact) <= 1000),
  root_cause text check (char_length(root_cause) <= 1500),
  workaround text check (char_length(workaround) <= 1500),
  permanent_fix text check (char_length(permanent_fix) <= 1500),
  owner_id uuid references public.profiles(id) on delete set null,
  legacy_owner text check (char_length(legacy_owner) <= 150),
  priority text not null default 'ปานกลาง' check (priority in ('ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต')),
  status text not null default 'เปิด' check (status in ('เปิด', 'กำลังวิเคราะห์', 'กำลังแก้ไข', 'รอตรวจยืนยัน', 'ปิด')),
  review_date date,
  closed_at timestamptz,
  evidence_url text check (char_length(evidence_url) <= 1000),
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint problems_closed_at_consistent check (
    (status = 'ปิด' and closed_at is not null) or (status <> 'ปิด' and closed_at is null)
  )
);

create index problems_status_idx on public.problems (status);
create index problems_priority_idx on public.problems (priority);
create index problems_owner_id_idx on public.problems (owner_id);
create index problems_review_date_idx on public.problems (review_date) where status <> 'ปิด';

create trigger trg_problems_set_updated_at
  before update on public.problems
  for each row execute function public.set_updated_at();

create table public.problem_incidents (
  problem_id uuid not null references public.problems(id) on delete cascade,
  incident_id uuid not null references public.incidents(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  primary key (problem_id, incident_id)
);

create index problem_incidents_incident_id_idx on public.problem_incidents (incident_id);

create table public.problem_tickets (
  problem_id uuid not null references public.problems(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  primary key (problem_id, ticket_id)
);

create index problem_tickets_ticket_id_idx on public.problem_tickets (ticket_id);

create table public.known_errors (
  id uuid primary key default gen_random_uuid(),
  known_error_number text not null unique,
  legacy_id text unique,
  problem_id uuid not null references public.problems(id) on delete restrict,
  title text not null check (char_length(title) <= 200),
  symptoms text check (char_length(symptoms) <= 1500),
  root_cause text check (char_length(root_cause) <= 1500),
  workaround text not null check (char_length(workaround) between 1 and 1500),
  affected_versions text check (char_length(affected_versions) <= 500),
  fixed_version text check (char_length(fixed_version) <= 200),
  knowledge_article_ref text check (char_length(knowledge_article_ref) <= 80),
  status text not null default 'เผยแพร่' check (status in ('ร่าง', 'เผยแพร่', 'แก้ไขแล้ว', 'ยกเลิก')),
  review_date date,
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

create index known_errors_problem_id_idx on public.known_errors (problem_id);
create index known_errors_status_idx on public.known_errors (status);
create index known_errors_review_date_idx on public.known_errors (review_date) where status in ('ร่าง', 'เผยแพร่');

create trigger trg_known_errors_set_updated_at
  before update on public.known_errors
  for each row execute function public.set_updated_at();

alter table public.problems enable row level security;
alter table public.problem_incidents enable row level security;
alter table public.problem_tickets enable row level security;
alter table public.known_errors enable row level security;

create policy problems_select_with_permission on public.problems
  for select to authenticated
  using (public.has_permission('problem.view'));

create policy problems_insert_with_permission on public.problems
  for insert to authenticated
  with check (public.has_permission('problem.manage'));

create policy problems_update_with_permission on public.problems
  for update to authenticated
  using (public.has_permission('problem.manage'))
  with check (public.has_permission('problem.manage'));

create policy problem_incidents_select_with_permission on public.problem_incidents
  for select to authenticated
  using (public.has_permission('problem.view'));

create policy problem_incidents_write_with_permission on public.problem_incidents
  for all to authenticated
  using (public.has_permission('problem.manage'))
  with check (public.has_permission('problem.manage'));

create policy problem_tickets_select_with_permission on public.problem_tickets
  for select to authenticated
  using (public.has_permission('problem.view'));

create policy problem_tickets_write_with_permission on public.problem_tickets
  for all to authenticated
  using (public.has_permission('problem.manage'))
  with check (public.has_permission('problem.manage'));

create policy known_errors_select_with_permission on public.known_errors
  for select to authenticated
  using (public.has_permission('problem.view'));

create policy known_errors_insert_with_permission on public.known_errors
  for insert to authenticated
  with check (public.has_permission('problem.manage'));

create policy known_errors_update_with_permission on public.known_errors
  for update to authenticated
  using (public.has_permission('problem.manage'))
  with check (public.has_permission('problem.manage'));

create policy file_attachments_select_problem_participant on public.file_attachments
  for select to authenticated
  using (
    module = 'problem'
    and (
      (target_table = 'problems' and exists (
        select 1 from public.problems p where p.id::text = file_attachments.target_id
      ))
      or
      (target_table = 'known_errors' and exists (
        select 1 from public.known_errors k where k.id::text = file_attachments.target_id
      ))
    )
  );
