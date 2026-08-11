-- Phase 7: Task reminders integrated with the existing in-app notifications table.

create table public.task_reminders (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null unique references public.personal_tasks(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  remind_at timestamptz not null,
  preset text not null default 'custom' check (preset in (
    'at_time', 'before_15m', 'before_30m', 'before_1h', 'before_3h',
    'before_1d', 'before_3d', 'custom'
  )),
  status text not null default 'pending' check (status in ('pending', 'snoozed', 'sent', 'cancelled')),
  snoozed_until timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_reminders_snooze_consistency check (
    (status = 'snoozed' and snoozed_until is not null)
    or (status <> 'snoozed')
  )
);

create index task_reminders_due_idx
  on public.task_reminders (coalesce(snoozed_until, remind_at))
  where status in ('pending', 'snoozed');
create index task_reminders_owner_idx on public.task_reminders (owner_id, status);

create trigger trg_task_reminders_set_updated_at
  before update on public.task_reminders
  for each row execute function public.set_updated_at();

alter table public.task_reminders enable row level security;

create policy task_reminders_all_own on public.task_reminders
  for all to authenticated
  using (
    owner_id = auth.uid()
    and exists (
      select 1 from public.personal_tasks task
      where task.id = task_reminders.task_id and task.owner_id = auth.uid()
    )
  )
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.personal_tasks task
      where task.id = task_reminders.task_id and task.owner_id = auth.uid()
    )
  );

-- Called only by the Cloudflare scheduled handler using the service-role client.
-- Row locking plus a single transaction makes delivery idempotent across overlapping cron runs.
create or replace function public.dispatch_due_task_reminders(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  reminder_row record;
  delivered integer := 0;
begin
  update public.task_reminders reminder
  set status = 'cancelled', snoozed_until = null
  from public.personal_tasks task
  where task.id = reminder.task_id
    and reminder.status in ('pending', 'snoozed')
    and task.status in ('เสร็จแล้ว', 'ยกเลิก');

  for reminder_row in
    select reminder.id, reminder.owner_id, task.id as task_id, task.task_no,
      task.title, task.due_date, task.due_time
    from public.task_reminders reminder
    join public.personal_tasks task on task.id = reminder.task_id
    where reminder.status in ('pending', 'snoozed')
      and coalesce(reminder.snoozed_until, reminder.remind_at) <= p_now
      and task.status not in ('เสร็จแล้ว', 'ยกเลิก')
    order by coalesce(reminder.snoozed_until, reminder.remind_at)
    for update of reminder skip locked
  loop
    insert into public.notifications (recipient_id, type, title, body, link)
    values (
      reminder_row.owner_id,
      'task_reminder',
      'เตือนงาน: ' || reminder_row.title,
      reminder_row.task_no || case
        when reminder_row.due_date is null then ''
        else ' · ครบกำหนด ' || to_char(reminder_row.due_date, 'DD/MM/YYYY')
          || coalesce(' ' || to_char(reminder_row.due_time, 'HH24:MI'), '')
      end,
      '/tasks'
    );

    update public.task_reminders
    set status = 'sent', sent_at = p_now, snoozed_until = null
    where id = reminder_row.id;
    delivered := delivered + 1;
  end loop;

  return delivered;
end;
$$;

revoke all on function public.dispatch_due_task_reminders(timestamptz) from public, anon, authenticated;
grant execute on function public.dispatch_due_task_reminders(timestamptz) to service_role;

comment on function public.dispatch_due_task_reminders(timestamptz) is
  'Atomically creates existing in-app notifications for due task reminders. Intended for Cloudflare Cron via service_role only.';
