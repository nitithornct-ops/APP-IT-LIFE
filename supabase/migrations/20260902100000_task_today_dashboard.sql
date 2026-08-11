-- Phase 2: Today + Dashboard
-- Date values remain Gregorian in the database. Buddhist year conversion belongs to the UI only.

alter table public.personal_tasks
  add column if not exists start_time time,
  add column if not exists due_time time;

create index personal_tasks_owner_due_date_time_idx
  on public.personal_tasks (owner_id, due_date, due_time);
