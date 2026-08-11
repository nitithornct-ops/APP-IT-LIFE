-- Phase 6: Recurring Task
-- Keep the existing human-readable recurrence label for backwards compatibility,
-- while adding a structured rule that can evolve without another enum migration.

alter table public.personal_tasks
  drop constraint if exists personal_tasks_recurrence_check;

alter table public.personal_tasks
  add column if not exists recurrence_rule jsonb;

alter table public.personal_tasks
  add constraint personal_tasks_recurrence_check check (recurrence in (
    'ไม่ทำซ้ำ', 'รายวัน', 'วันทำงาน', 'รายสัปดาห์', 'ทุก 2 สัปดาห์',
    'รายเดือน', 'รายไตรมาส', 'ทุก 6 เดือน', 'รายปี', 'กำหนดเอง'
  ));

update public.personal_tasks
set recurrence_rule = case recurrence
  when 'รายวัน' then '{"frequency":"daily","interval":1}'::jsonb
  when 'รายสัปดาห์' then '{"frequency":"weekly","interval":1}'::jsonb
  when 'รายเดือน' then jsonb_build_object(
    'frequency', 'monthly', 'interval', 1, 'dayOfMonth', extract(day from due_date)::integer
  )
  when 'รายไตรมาส' then jsonb_build_object(
    'frequency', 'monthly', 'interval', 3, 'dayOfMonth', extract(day from due_date)::integer
  )
  when 'รายปี' then jsonb_build_object(
    'frequency', 'yearly', 'interval', 1,
    'dayOfMonth', extract(day from due_date)::integer,
    'monthOfYear', extract(month from due_date)::integer
  )
  else null
end
where recurrence <> 'ไม่ทำซ้ำ'
  and recurrence_rule is null;

alter table public.personal_tasks
  add constraint personal_tasks_recurrence_rule_check check (
    (recurrence = 'ไม่ทำซ้ำ' and recurrence_rule is null)
    or (recurrence <> 'ไม่ทำซ้ำ'
      and
      jsonb_typeof(recurrence_rule) = 'object'
      and jsonb_typeof(recurrence_rule->'frequency') = 'string'
      and jsonb_typeof(recurrence_rule->'interval') = 'number'
      and recurrence_rule->>'frequency' in ('daily', 'weekly', 'monthly', 'yearly')
      and (recurrence_rule->>'interval')::integer between 1 and 99
    )
  );

create index personal_tasks_owner_recurrence_idx
  on public.personal_tasks (owner_id, recurrence, due_date)
  where recurrence <> 'ไม่ทำซ้ำ';

create index personal_tasks_recurring_parent_due_idx
  on public.personal_tasks (owner_id, recurring_parent_id, due_date)
  where recurring_parent_id is not null;

comment on column public.personal_tasks.recurrence_rule is
  'Extensible recurrence JSON: frequency, interval, optional weekdays/dayOfMonth/monthOfYear. Dates remain Gregorian; application timezone is Asia/Bangkok.';
