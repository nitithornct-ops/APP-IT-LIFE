-- PM integrity hardening (migration timestamp 20261020100000):
-- - preserve the first scheduled date for on-time reporting;
-- - make the recurrence basis explicit;
-- - prevent duplicate child plans;
-- - close a PM and create its next occurrence in one database transaction.

alter table public.maintenance_plans
  add column original_plan_date date;

update public.maintenance_plans
set original_plan_date = plan_date
where original_plan_date is null;

alter table public.maintenance_plans
  alter column original_plan_date set not null;

alter table public.maintenance_plans
  add column recurrence_basis text not null default 'กำหนดเดิม'
    check (recurrence_basis in ('กำหนดเดิม', 'วันทำเสร็จ'));

create index maintenance_plans_original_plan_date_idx
  on public.maintenance_plans (original_plan_date);

create index maintenance_plans_recurrence_basis_idx
  on public.maintenance_plans (recurrence_basis);

create unique index maintenance_plans_recurring_parent_date_unique
  on public.maintenance_plans (recurring_parent_id, plan_date)
  where recurring_parent_id is not null;

-- Direct imports and other writers may omit original_plan_date. Set it from the
-- first plan date on insert, while never changing it on reschedule.
create or replace function public.set_maintenance_original_plan_date()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.original_plan_date is null then
    new.original_plan_date := new.plan_date;
  end if;
  return new;
end;
$$;

create trigger trg_maintenance_plans_set_original_plan_date
  before insert on public.maintenance_plans
  for each row execute function public.set_maintenance_original_plan_date();

-- The API validates the checklist before calling this service-role-only RPC.
-- The row lock and the partial unique index make retries safe and keep the
-- completed parent and its next occurrence atomic.
create or replace function public.complete_maintenance_plan(
  plan_id_input uuid,
  actual_date_input date,
  checklist_input jsonb,
  result_input text,
  notes_input text,
  next_due_date_input date,
  next_checklist_input jsonb,
  actor_id_input uuid,
  actor_email_input text,
  request_id_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  locked_plan public.maintenance_plans%rowtype;
  next_plan_id uuid;
begin
  select * into locked_plan
  from public.maintenance_plans
  where id = plan_id_input
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'MAINTENANCE_NOT_FOUND';
  end if;

  if locked_plan.status in ('ดำเนินการแล้ว', 'ยกเลิก') then
    raise exception using errcode = 'P0001', message = 'MAINTENANCE_TERMINAL';
  end if;

  update public.maintenance_plans
  set status = 'ดำเนินการแล้ว',
      actual_date = actual_date_input,
      checklist_json = checklist_input,
      result = result_input,
      notes = notes_input,
      next_due_date = next_due_date_input,
      updated_by = actor_id_input
  where id = plan_id_input;

  if next_due_date_input is not null then
    begin
      insert into public.maintenance_plans (
        asset_id, plan_date, original_plan_date, status, work_type, recurrence,
        recurrence_basis, technician_id, checklist_json, notes, template_id,
        recurring_parent_id, vendor_id, contract_id, created_by
      ) values (
        locked_plan.asset_id, next_due_date_input, next_due_date_input, 'วางแผน',
        locked_plan.work_type, locked_plan.recurrence, locked_plan.recurrence_basis,
        locked_plan.technician_id, next_checklist_input,
        format('สร้างอัตโนมัติต่อจากแผน %s', plan_id_input), locked_plan.template_id,
        plan_id_input, locked_plan.vendor_id, locked_plan.contract_id, actor_id_input
      )
      on conflict (recurring_parent_id, plan_date) where recurring_parent_id is not null
      do nothing
      returning id into next_plan_id;

      if next_plan_id is null then
        select id into next_plan_id
        from public.maintenance_plans
        where recurring_parent_id = plan_id_input
          and plan_date = next_due_date_input;
      end if;
    exception when others then
      raise exception using errcode = 'P0001', message = 'MAINTENANCE_NEXT_PLAN_FAILED';
    end;
  end if;

  insert into public.audit_logs (
    actor_id, actor_email, action, module, target_table, target_id,
    detail, result, request_id
  ) values (
    actor_id_input, actor_email_input, 'RECORD_RESULT', 'maintenance',
    'maintenance_plans', plan_id_input::text,
    jsonb_build_object(
      'statusFrom', locked_plan.status,
      'statusTo', 'ดำเนินการแล้ว',
      'actualDate', actual_date_input,
      'nextDueDate', next_due_date_input,
      'nextPlanId', next_plan_id,
      'nextPlanCreated', next_plan_id is not null
    ),
    'success', request_id_input
  );

  return jsonb_build_object(
    'id', plan_id_input,
    'nextPlanId', next_plan_id,
    'nextPlanCreated', next_plan_id is not null
  );
end;
$$;

revoke all on function public.complete_maintenance_plan(uuid, date, jsonb, text, text, date, jsonb, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_maintenance_plan(uuid, date, jsonb, text, text, date, jsonb, uuid, text, text)
  to service_role;

comment on function public.complete_maintenance_plan(uuid, date, jsonb, text, text, date, jsonb, uuid, text, text) is
  'Atomically records a completed PM result and creates its idempotent next occurrence.';
