-- Phase 8: lightweight task dependencies, operational context links, time tracking,
-- and personal task templates.

alter table public.personal_tasks
  add column if not exists estimate_hours numeric(8, 2),
  add column if not exists actual_hours numeric(8, 2),
  add column if not exists blocked_reason text;

alter table public.personal_tasks
  add constraint personal_tasks_estimate_hours_check check (estimate_hours is null or estimate_hours between 0 and 999999.99),
  add constraint personal_tasks_actual_hours_check check (actual_hours is null or actual_hours between 0 and 999999.99),
  add constraint personal_tasks_blocked_reason_check check (blocked_reason is null or char_length(btrim(blocked_reason)) between 1 and 1000);

create table public.task_dependencies (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.personal_tasks(id) on delete cascade,
  depends_on_task_id uuid not null references public.personal_tasks(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  constraint task_dependencies_unique unique (task_id, depends_on_task_id),
  constraint task_dependencies_not_self check (task_id <> depends_on_task_id),
  constraint task_dependencies_note_check check (note is null or char_length(note) <= 500)
);

create index task_dependencies_task_idx on public.task_dependencies (task_id);
create index task_dependencies_prerequisite_idx on public.task_dependencies (depends_on_task_id);
create index task_dependencies_owner_idx on public.task_dependencies (owner_id);

create or replace function public.enforce_task_dependency_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  task_owner uuid;
  prerequisite_owner uuid;
begin
  if new.task_id = new.depends_on_task_id then
    raise exception 'TASK_DEPENDENCY_SELF_REFERENCE';
  end if;

  select owner_id into task_owner from public.personal_tasks where id = new.task_id;
  select owner_id into prerequisite_owner from public.personal_tasks where id = new.depends_on_task_id;
  if task_owner is null or prerequisite_owner is null
    or task_owner <> new.owner_id or prerequisite_owner <> new.owner_id then
    raise exception 'TASK_DEPENDENCY_OWNER_MISMATCH';
  end if;

  if exists (
    with recursive reachable(task_id) as (
      select dependency.depends_on_task_id
      from public.task_dependencies dependency
      where dependency.task_id = new.depends_on_task_id
        and dependency.owner_id = new.owner_id
      union
      select dependency.depends_on_task_id
      from public.task_dependencies dependency
      join reachable on reachable.task_id = dependency.task_id
      where dependency.owner_id = new.owner_id
    )
    select 1 from reachable where task_id = new.task_id
  ) then
    raise exception 'TASK_DEPENDENCY_CYCLE';
  end if;

  return new;
end;
$$;

create trigger trg_task_dependencies_integrity
  before insert or update on public.task_dependencies
  for each row execute function public.enforce_task_dependency_integrity();

create table public.task_record_links (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.personal_tasks(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  record_type text not null check (record_type in ('incident', 'change', 'asset', 'contract', 'risk')),
  record_id uuid not null,
  record_code text not null,
  record_title text not null,
  record_status text,
  created_at timestamptz not null default now(),
  constraint task_record_links_unique unique (task_id, record_type, record_id)
);

create index task_record_links_task_idx on public.task_record_links (task_id);
create index task_record_links_record_idx on public.task_record_links (record_type, record_id);
create index task_record_links_owner_idx on public.task_record_links (owner_id);

create table public.task_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  title text not null,
  description text,
  task_type text not null default 'general' check (task_type in (
    'general', 'meeting', 'follow_up', 'document', 'project', 'system_development', 'personal', 'other'
  )),
  category text not null default 'งานทั่วไป',
  priority text not null default 'ปกติ',
  recurrence text not null default 'ไม่ทำซ้ำ',
  recurrence_rule jsonb,
  due_offset_days integer not null default 0 check (due_offset_days between 0 and 3650),
  estimate_hours numeric(8, 2) check (estimate_hours is null or estimate_hours between 0 and 999999.99),
  tags text,
  notes text,
  checklist jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint task_templates_name_unique unique (owner_id, name),
  constraint task_templates_name_check check (char_length(btrim(name)) between 1 and 150),
  constraint task_templates_title_check check (char_length(btrim(title)) between 1 and 300)
);

create index task_templates_owner_idx on public.task_templates (owner_id, updated_at desc);

create trigger trg_task_templates_set_updated_at
  before update on public.task_templates
  for each row execute function public.set_updated_at();

alter table public.task_dependencies enable row level security;
alter table public.task_record_links enable row level security;
alter table public.task_templates enable row level security;

create policy task_dependencies_all_own on public.task_dependencies
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy task_record_links_all_own on public.task_record_links
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy task_templates_all_own on public.task_templates
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Applying a template creates the task and its checklist in one database transaction.
create or replace function public.apply_task_template(
  p_template_id uuid,
  p_start_date date,
  p_due_date date,
  p_status text default 'ต้องทำ'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  template_row public.task_templates%rowtype;
  new_task_id uuid;
  due_date_value date;
  start_date_value date;
  checklist_item jsonb;
  checklist_title text;
  item_index integer := 0;
begin
  if p_status not in ('ต้องทำ', 'กำลังทำ') then
    raise exception 'TASK_TEMPLATE_STATUS_NOT_ALLOWED';
  end if;

  select * into template_row
  from public.task_templates
  where id = p_template_id and owner_id = auth.uid();
  if not found then
    raise exception 'TASK_TEMPLATE_NOT_FOUND';
  end if;

  start_date_value := coalesce(p_start_date, p_due_date, current_date);
  due_date_value := coalesce(p_due_date, start_date_value + template_row.due_offset_days);
  if due_date_value < start_date_value then
    raise exception 'TASK_TEMPLATE_DATE_RANGE_INVALID';
  end if;

  insert into public.personal_tasks (
    owner_id, title, description, task_type, category, priority, status,
    start_date, due_date, progress, tags, notes, recurrence, recurrence_rule,
    estimate_hours, created_by, updated_by
  ) values (
    auth.uid(), template_row.title, template_row.description, template_row.task_type,
    template_row.category, template_row.priority, p_status, start_date_value,
    due_date_value, case when p_status = 'กำลังทำ' then 10 else 0 end,
    template_row.tags, template_row.notes, template_row.recurrence,
    template_row.recurrence_rule, template_row.estimate_hours, auth.uid(), auth.uid()
  ) returning id into new_task_id;

  for checklist_item in select value from jsonb_array_elements(template_row.checklist)
  loop
    checklist_title := case
      when jsonb_typeof(checklist_item) = 'string' then trim(both '"' from checklist_item::text)
      else checklist_item ->> 'title'
    end;
    if checklist_title is not null and char_length(btrim(checklist_title)) > 0 then
      insert into public.task_subtasks (task_id, owner_id, title, status, due_date, sort_order)
      values (new_task_id, auth.uid(), btrim(checklist_title), 'ต้องทำ', due_date_value, item_index);
      item_index := item_index + 1;
    end if;
  end loop;

  return jsonb_build_object('id', new_task_id);
end;
$$;

revoke all on function public.apply_task_template(uuid, date, date, text) from public, anon;
grant execute on function public.apply_task_template(uuid, date, date, text) to authenticated;

comment on table public.task_dependencies is 'Personal task prerequisites. A task cannot start or finish while a prerequisite is incomplete.';
comment on table public.task_record_links is 'Personal task links to existing operational records, storing a safe display snapshot.';
comment on table public.task_templates is 'Reusable personal task templates; applying one creates a normal personal task.';
