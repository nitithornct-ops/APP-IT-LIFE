-- Phase 1: Task Core
-- Extend the existing personal task table without replacing legacy data or policies.

alter table public.personal_tasks
  add column if not exists task_no text,
  add column if not exists task_type text,
  add column if not exists progress_before_complete smallint;

update public.personal_tasks
set task_no = 'TASK-'
  || to_char(created_at at time zone 'Asia/Bangkok', 'YYYYMMDD')
  || '-'
  || upper(substr(replace(id::text, '-', ''), 1, 8))
where task_no is null;

update public.personal_tasks
set task_type = 'general'
where task_type is null;

alter table public.personal_tasks
  alter column task_no set default (
    'TASK-'
    || to_char(now() at time zone 'Asia/Bangkok', 'YYYYMMDD')
    || '-'
    || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  ),
  alter column task_no set not null,
  alter column task_type set default 'general',
  alter column task_type set not null;

alter table public.personal_tasks
  add constraint personal_tasks_task_no_key unique (task_no),
  add constraint personal_tasks_task_type_check check (task_type in (
    'general', 'meeting', 'follow_up', 'document', 'project', 'system_development', 'personal', 'other'
  )),
  add constraint personal_tasks_progress_before_complete_check check (
    progress_before_complete is null or progress_before_complete between 0 and 99
  );

create index personal_tasks_owner_status_due_idx
  on public.personal_tasks (owner_id, status, due_date);

create index personal_tasks_owner_created_at_idx
  on public.personal_tasks (owner_id, created_at desc);

create index personal_tasks_owner_task_type_idx
  on public.personal_tasks (owner_id, task_type);
