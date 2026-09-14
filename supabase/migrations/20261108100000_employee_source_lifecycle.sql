-- Employee is the personnel source of truth. Accounts, access and operational
-- records reference this table; they do not own employment data.

alter table public.employees
  add column if not exists manager_employee_id uuid references public.employees(id) on delete set null,
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists employment_status text not null default 'active',
  add column if not exists location text;

do $$
begin
  alter table public.employees
    add constraint employees_employment_status_check
    check (employment_status in ('active', 'on_leave', 'terminated', 'contractor', 'retired'));
exception when duplicate_object then null;
end $$;

-- Preserve the meaning of the legacy active/inactive flag for existing rows.
update public.employees
set employment_status = 'terminated'
where status = 'inactive' and employment_status = 'active';

do $$
begin
  alter table public.employees
    add constraint employees_employment_dates_check
    check (end_date is null or start_date is null or end_date >= start_date);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.employees
    add constraint employees_manager_not_self_check
    check (manager_employee_id is null or manager_employee_id <> id);
exception when duplicate_object then null;
end $$;

create index if not exists employees_manager_employee_id_idx on public.employees (manager_employee_id);
create index if not exists employees_employment_status_idx on public.employees (employment_status);
create index if not exists employees_start_date_idx on public.employees (start_date);

-- A profile is an optional login account for an Employee. The nullable link is
-- intentional: some employees do not need an account, and some service/admin
-- accounts are not employees.
alter table public.profiles
  add column if not exists employee_id uuid references public.employees(id) on delete set null;

create unique index if not exists profiles_employee_id_unique_idx
  on public.profiles (employee_id)
  where employee_id is not null;

-- Link legacy accounts once by the existing unique employee code. The legacy
-- profile columns remain for compatibility, but are no longer authoritative.
update public.profiles p
set employee_id = e.id
from public.employees e
where p.employee_id is null
  and p.employee_code is not null
  and p.employee_code = e.employee_code;

comment on column public.employees.employment_status is
  'Authoritative employment state. Account status is managed separately in profiles.';
comment on column public.employees.manager_employee_id is
  'Manager relationship in the employee directory, independent from a login account.';
comment on column public.profiles.employee_id is
  'Optional link from a login account to the authoritative employee directory row.';

-- One lifecycle event produces one auditable result per downstream module.
create table if not exists public.employee_lifecycle_actions (
  id uuid primary key default gen_random_uuid(),
  lifecycle_event_id uuid not null references public.employee_lifecycle_events(id) on delete cascade,
  target_type text not null check (target_type in ('user', 'access', 'asset', 'license', 'approval_group')),
  status text not null default 'PENDING' check (status in ('PENDING', 'COMPLETED', 'FAILED', 'SKIPPED')),
  affected_count integer not null default 0 check (affected_count >= 0),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_lifecycle_actions_event_target_unique unique (lifecycle_event_id, target_type)
);

create index if not exists employee_lifecycle_actions_event_idx
  on public.employee_lifecycle_actions (lifecycle_event_id, target_type);
create index if not exists employee_lifecycle_actions_status_idx
  on public.employee_lifecycle_actions (status, updated_at desc);

create trigger trg_employee_lifecycle_actions_set_updated_at
  before update on public.employee_lifecycle_actions
  for each row execute function public.set_updated_at();

alter table public.employee_lifecycle_actions enable row level security;

create policy employee_lifecycle_actions_select_with_permission
  on public.employee_lifecycle_actions
  for select to authenticated
  using (public.has_permission('employee.manage') or public.has_permission('operations.view'));

create policy employee_lifecycle_actions_write_with_permission
  on public.employee_lifecycle_actions
  for all to authenticated
  using (public.has_permission('employee.manage') or public.has_permission('operations.manage'))
  with check (public.has_permission('employee.manage') or public.has_permission('operations.manage'));

-- Reclaim all user-assigned software licenses in one database transaction. The
-- Worker calls this only after authenticating the operator and recording the JML
-- event, so repeated calls are safe and return zero for already reclaimed rows.
create or replace function public.reclaim_software_licenses_for_employee(
  p_employee_id uuid,
  p_actor_id uuid default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
  v_allocation_ids uuid[] := '{}'::uuid[];
begin
  if p_employee_id is null or not exists (select 1 from public.employees where id = p_employee_id) then
    raise exception using errcode = 'P0002', message = 'EMPLOYEE_NOT_FOUND';
  end if;

  select coalesce(array_agg(id), '{}'::uuid[])
    into v_allocation_ids
  from public.software_license_allocations
  where employee_id = p_employee_id and assignee_type = 'user' and status = 'assigned';

  update public.software_license_allocations
  set status = 'reclaimed',
      reclaimed_at = now(),
      reclaimed_by = p_actor_id,
      notes = case when nullif(trim(p_notes), '') is null then notes else trim(p_notes) end,
      updated_at = now()
  where employee_id = p_employee_id and assignee_type = 'user' and status = 'assigned';
  get diagnostics v_count = row_count;

  return jsonb_build_object(
    'employeeId', p_employee_id,
    'allocationIds', to_jsonb(v_allocation_ids),
    'count', v_count
  );
end;
$$;

revoke all on function public.reclaim_software_licenses_for_employee(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.reclaim_software_licenses_for_employee(uuid, uuid, text)
  to service_role;

comment on function public.reclaim_software_licenses_for_employee(uuid, uuid, text) is
  'Idempotently reclaims all user-assigned software licenses for an employee leaver.';
