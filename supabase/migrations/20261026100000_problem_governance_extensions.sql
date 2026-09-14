-- Problem governance extensions: structured RCA, CI/Change links, corrective actions,
-- recurrence tracking, review meeting evidence and the close gate.

alter table public.problems
  add column rca_method text not null default '5 Why'
    check (rca_method in ('5 Why', 'Fishbone', 'Other')),
  add column five_why jsonb not null default '[]'::jsonb
    check (jsonb_typeof(five_why) = 'array' and jsonb_array_length(five_why) <= 5),
  add column fishbone jsonb not null default '{}'::jsonb
    check (jsonb_typeof(fishbone) = 'object'),
  add column recurrence_count integer not null default 0
    check (recurrence_count >= 0),
  add column review_meeting_at timestamptz,
  add column review_meeting_owner_id uuid references public.profiles(id) on delete set null,
  add column review_meeting_notes text check (char_length(review_meeting_notes) <= 1500),
  add column change_verified_at timestamptz,
  add column change_verified_by uuid references public.profiles(id) on delete set null,
  add column change_verification_notes text check (char_length(change_verification_notes) <= 1500);

create index problems_recurrence_count_idx on public.problems (recurrence_count desc);
create index problems_review_meeting_at_idx on public.problems (review_meeting_at)
  where review_meeting_at is not null;

create table public.problem_configuration_items (
  problem_id uuid not null references public.problems(id) on delete cascade,
  ci_id uuid not null references public.configuration_items(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint problem_configuration_items_pk primary key (problem_id, ci_id)
);

create index problem_configuration_items_ci_id_idx on public.problem_configuration_items (ci_id);

create table public.problem_changes (
  problem_id uuid not null references public.problems(id) on delete cascade,
  change_id uuid not null references public.change_requests(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint problem_changes_pk primary key (problem_id, change_id)
);

create index problem_changes_change_id_idx on public.problem_changes (change_id);

create table public.problem_corrective_actions (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid not null references public.problems(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (char_length(description) <= 1500),
  owner_id uuid references public.profiles(id) on delete set null,
  due_date date,
  status text not null default 'เปิด'
    check (status in ('เปิด', 'กำลังดำเนินการ', 'เสร็จสิ้น', 'ยกเลิก')),
  completed_at timestamptz,
  verification_notes text check (char_length(verification_notes) <= 1500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint problem_corrective_actions_completed_consistent check (
    (status = 'เสร็จสิ้น' and completed_at is not null)
    or (status <> 'เสร็จสิ้น' and completed_at is null)
  )
);

create index problem_corrective_actions_problem_id_idx on public.problem_corrective_actions (problem_id, created_at);
create index problem_corrective_actions_owner_id_idx on public.problem_corrective_actions (owner_id);
create index problem_corrective_actions_status_idx on public.problem_corrective_actions (status);

create trigger trg_problem_corrective_actions_set_updated_at
  before update on public.problem_corrective_actions
  for each row execute function public.set_updated_at();

-- A Problem can only be closed after a linked Change has been deployed and a
-- separate verification action has recorded the outcome.
create or replace function public.enforce_problem_closure_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'ปิด' then
    if nullif(btrim(new.permanent_fix), '') is null then
      raise exception 'PROBLEM_PERMANENT_FIX_REQUIRED';
    end if;
    if not exists (
      select 1 from public.problem_changes pc
      join public.change_requests cr on cr.id = pc.change_id
      where pc.problem_id = new.id and cr.status = 'ติดตั้งใช้งานแล้ว'
    ) then
      raise exception 'PROBLEM_DEPLOYED_CHANGE_REQUIRED';
    end if;
    if new.change_verified_at is null or new.change_verified_by is null then
      raise exception 'PROBLEM_CHANGE_VERIFICATION_REQUIRED';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_problems_enforce_closure_gate
  before insert or update on public.problems
  for each row execute function public.enforce_problem_closure_gate();

alter table public.problem_configuration_items enable row level security;
alter table public.problem_changes enable row level security;
alter table public.problem_corrective_actions enable row level security;

create policy problem_configuration_items_select_with_permission on public.problem_configuration_items
  for select to authenticated using (public.has_permission('problem.view'));
create policy problem_configuration_items_write_with_permission on public.problem_configuration_items
  for all to authenticated
  using (public.has_permission('problem.manage'))
  with check (public.has_permission('problem.manage'));

create policy problem_changes_select_with_permission on public.problem_changes
  for select to authenticated using (public.has_permission('problem.view'));
create policy problem_changes_write_with_permission on public.problem_changes
  for all to authenticated
  using (public.has_permission('problem.manage'))
  with check (public.has_permission('problem.manage'));

create policy problem_corrective_actions_select_with_permission on public.problem_corrective_actions
  for select to authenticated using (public.has_permission('problem.view'));
create policy problem_corrective_actions_write_with_permission on public.problem_corrective_actions
  for all to authenticated
  using (public.has_permission('problem.manage'))
  with check (public.has_permission('problem.manage'));

-- Keep the source relationship when a Known Error is promoted to the KB and
-- prevent duplicate articles from repeated clicks/retries.
alter table public.knowledge_articles
  add column source_known_error_id uuid unique references public.known_errors(id) on delete set null;

create index knowledge_articles_source_known_error_id_idx
  on public.knowledge_articles (source_known_error_id)
  where source_known_error_id is not null;
