-- Employee Assignment / Asset Handover hardening.
-- Keep employee_assignments as the compatibility register, but make the three
-- business roles explicit and move multi-asset operations into transactions.

create table if not exists public.employee_assignment_batches (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  operation text not null check (operation in ('assign', 'return', 'offboarding')),
  checkout_date date,
  return_date date,
  requested_by uuid references auth.users(id) on delete set null,
  total_count integer not null default 0 check (total_count >= 0),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists employee_assignment_batches_employee_idx
  on public.employee_assignment_batches (employee_id, created_at desc);

alter table public.employee_assignments
  add column if not exists owner_employee_id uuid references public.employees(id) on delete restrict,
  add column if not exists custodian_employee_id uuid references public.employees(id) on delete restrict,
  add column if not exists assigned_user_employee_id uuid references public.employees(id) on delete restrict,
  add column if not exists checkout_date date,
  add column if not exists return_date date,
  add column if not exists accessories jsonb not null default '[]'::jsonb,
  add column if not exists manager_approval_status text not null default 'approved',
  add column if not exists manager_approved_by uuid references public.employees(id) on delete set null,
  add column if not exists manager_approved_at timestamptz,
  add column if not exists manager_approval_notes text,
  add column if not exists handover_document_id uuid references public.file_attachments(id) on delete set null,
  add column if not exists handover_document_name text,
  add column if not exists return_reason text,
  add column if not exists returned_by uuid references auth.users(id) on delete set null,
  add column if not exists assignment_batch_id uuid references public.employee_assignment_batches(id) on delete set null;

-- Existing rows historically represented the person who held the item. Keep
-- that meaning as custodian/assigned user while leaving Owner nullable because
-- the old table did not contain enough information to infer legal ownership.
update public.employee_assignments
set custodian_employee_id = coalesce(custodian_employee_id, employee_id),
    assigned_user_employee_id = coalesce(assigned_user_employee_id, employee_id),
    checkout_date = coalesce(checkout_date, assigned_date),
    return_date = coalesce(return_date, returned_date)
where custodian_employee_id is null
   or assigned_user_employee_id is null
   or checkout_date is null
   or (returned_date is not null and return_date is null);

alter table public.employee_assignments
  drop constraint if exists employee_assignments_accessories_array;
alter table public.employee_assignments
  add constraint employee_assignments_accessories_array
  check (jsonb_typeof(accessories) = 'array');

alter table public.employee_assignments
  drop constraint if exists employee_assignments_assignment_date_order;
alter table public.employee_assignments
  add constraint employee_assignments_assignment_date_order
  check (checkout_date is null or return_date is null or return_date >= checkout_date);

alter table public.employee_assignments
  drop constraint if exists employee_assignments_manager_approval_status;
alter table public.employee_assignments
  add constraint employee_assignments_manager_approval_status
  check (manager_approval_status in ('pending', 'approved', 'rejected'));

create index if not exists employee_assignments_owner_idx
  on public.employee_assignments (owner_employee_id, status);
create index if not exists employee_assignments_custodian_idx
  on public.employee_assignments (custodian_employee_id, status);
create index if not exists employee_assignments_assigned_user_idx
  on public.employee_assignments (assigned_user_employee_id, status);
create index if not exists employee_assignments_batch_idx
  on public.employee_assignments (assignment_batch_id);

-- Database-level protection for concurrent assignment requests. Historical
-- returned/lost rows remain reusable; only current custody is unique.
create unique index if not exists employee_assignments_one_active_asset_idx
  on public.employee_assignments (asset_id)
  where asset_id is not null and status in ('ครอบครอง', 'ส่งซ่อม');

alter table public.employee_assignment_batches enable row level security;
drop policy if exists employee_assignment_batches_select on public.employee_assignment_batches;
create policy employee_assignment_batches_select on public.employee_assignment_batches
  for select to authenticated using (
    public.has_permission('employee.manage') or public.has_permission('asset.view')
  );

-- Existing asset_loans can also be returned by an offboarding event. An
-- automatic return has no human receiver, so record that fact explicitly.
alter table public.asset_loans
  add column if not exists auto_returned boolean not null default false;
alter table public.asset_loans
  drop constraint if exists asset_loans_return_consistency;
alter table public.asset_loans
  add constraint asset_loans_return_consistency check (
    (status = 'active' and returned_at is null and return_receiver_employee_id is null)
    or (status = 'returned' and returned_at is not null and (return_receiver_employee_id is not null or auto_returned))
    or status = 'cancelled'
  );

create or replace function public.bulk_assign_employee_assets(
  p_employee_id uuid,
  p_asset_ids uuid[],
  p_checkout_date date,
  p_owner_employee_id uuid default null,
  p_custodian_employee_id uuid default null,
  p_assigned_user_employee_id uuid default null,
  p_manager_approved_by uuid default null,
  p_manager_approval_notes text default null,
  p_accessories jsonb default '[]'::jsonb,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_department_id uuid;
  v_custodian_id uuid := coalesce(p_custodian_employee_id, p_employee_id);
  v_assigned_user_id uuid := coalesce(p_assigned_user_employee_id, p_employee_id);
  v_batch_id uuid;
  v_assignment_id uuid;
  v_assignment_ids uuid[] := '{}'::uuid[];
  v_seen integer := 0;
  v_asset record;
begin
  if v_user_id is not null
     and not (public.has_permission('employee.manage') or public.has_permission('asset.transfer')) then
    raise exception using errcode = '42501', message = 'EMPLOYEE_ASSIGNMENT_PERMISSION_REQUIRED';
  end if;
  if p_employee_id is null or not exists (
    select 1 from public.employees where id = p_employee_id and status = 'active'
  ) then
    raise exception using errcode = 'P0002', message = 'EMPLOYEE_NOT_FOUND';
  end if;
  if coalesce(cardinality(p_asset_ids), 0) = 0 or cardinality(p_asset_ids) > 100 then
    raise exception using errcode = '22023', message = 'EMPLOYEE_ASSIGNMENT_ASSET_LIST_INVALID';
  end if;
  if (select count(*) from (select distinct unnest(p_asset_ids) as id) ids) <> cardinality(p_asset_ids) then
    raise exception using errcode = '22023', message = 'EMPLOYEE_ASSIGNMENT_ASSET_LIST_DUPLICATE';
  end if;
  if p_checkout_date is null then
    raise exception using errcode = '22023', message = 'EMPLOYEE_ASSIGNMENT_CHECKOUT_DATE_REQUIRED';
  end if;
  if coalesce(jsonb_typeof(p_accessories), '') <> 'array' then
    raise exception using errcode = '22023', message = 'EMPLOYEE_ASSIGNMENT_ACCESSORIES_INVALID';
  end if;
  if p_manager_approved_by is null or not exists (
    select 1 from public.employees where id = p_manager_approved_by and status = 'active'
  ) then
    raise exception using errcode = '22023', message = 'EMPLOYEE_ASSIGNMENT_MANAGER_APPROVAL_REQUIRED';
  end if;
  if not exists (select 1 from public.employees where id = v_custodian_id and status = 'active') then
    raise exception using errcode = 'P0002', message = 'EMPLOYEE_ASSIGNMENT_CUSTODIAN_NOT_FOUND';
  end if;
  if not exists (select 1 from public.employees where id = v_assigned_user_id and status = 'active') then
    raise exception using errcode = 'P0002', message = 'EMPLOYEE_ASSIGNMENT_USER_NOT_FOUND';
  end if;
  if p_owner_employee_id is not null and not exists (
    select 1 from public.employees where id = p_owner_employee_id and status = 'active'
  ) then
    raise exception using errcode = 'P0002', message = 'EMPLOYEE_ASSIGNMENT_OWNER_NOT_FOUND';
  end if;

  select department_id into v_department_id
  from public.employees where id = p_employee_id;

  insert into public.employee_assignment_batches (
    employee_id, operation, checkout_date, requested_by, detail
  ) values (
    p_employee_id, 'assign', p_checkout_date, v_user_id,
    jsonb_build_object('assetCount', cardinality(p_asset_ids), 'ownerEmployeeId', p_owner_employee_id,
      'custodianEmployeeId', v_custodian_id, 'assignedUserEmployeeId', v_assigned_user_id)
  ) returning id into v_batch_id;

  -- Lock in asset id order so concurrent bulk requests cannot split custody.
  for v_asset in
    select a.id, a.asset_code, a.name, a.asset_type, a.status, a.lifecycle_status, a.owner_employee_id
    from public.assets a
    where a.id = any(p_asset_ids)
    order by a.id
    for update
  loop
    v_seen := v_seen + 1;
    if v_asset.status <> 'พร้อมใช้งาน'
       or v_asset.lifecycle_status in ('disposed', 'repair')
       or v_asset.owner_employee_id is not null
       or exists (select 1 from public.employee_assignments ea where ea.asset_id = v_asset.id and ea.status in ('ครอบครอง', 'ส่งซ่อม'))
       or exists (select 1 from public.asset_loans al where al.asset_id = v_asset.id and al.status = 'active') then
      raise exception using errcode = 'P0001', message = 'EMPLOYEE_ASSIGNMENT_ASSET_NOT_AVAILABLE';
    end if;

    insert into public.employee_assignments (
      employee_id, category, item_name, asset_id, asset_code,
      owner_employee_id, custodian_employee_id, assigned_user_employee_id,
      status, assigned_date, checkout_date, accessories,
      manager_approval_status, manager_approved_by, manager_approved_at,
      manager_approval_notes, notes, assignment_batch_id, created_by, updated_by
    ) values (
      p_employee_id,
      case
        when v_asset.asset_type = 'Endpoint' then 'Computer'
        when v_asset.asset_type = 'Software/License' then 'Software'
        when v_asset.asset_type in ('Server', 'Network Device') then 'Network'
        else 'อื่นๆ'
      end,
      v_asset.name, v_asset.id, v_asset.asset_code,
      p_owner_employee_id, v_custodian_id, v_assigned_user_id,
      'ครอบครอง', p_checkout_date, p_checkout_date, coalesce(p_accessories, '[]'::jsonb),
      'approved', p_manager_approved_by, now(), btrim(p_manager_approval_notes),
      btrim(p_notes), v_batch_id, v_user_id, v_user_id
    ) returning id into v_assignment_id;
    v_assignment_ids := array_append(v_assignment_ids, v_assignment_id);

    update public.assets
    set status = 'ใช้งานอยู่', lifecycle_status = 'checked_out',
        owner_employee_id = v_custodian_id, department_id = v_department_id,
        loan_date = p_checkout_date, loan_due_date = null,
        updated_by = v_user_id
    where id = v_asset.id;

    insert into public.asset_movements (
      asset_id, action_type, to_employee_id, department_id, status_label, notes, due_date, created_by
    ) values (
      v_asset.id, 'Assign', v_assigned_user_id, v_department_id,
      'เบิกจ่าย / มอบหมาย', btrim(p_notes), null, v_user_id
    );

    insert into public.asset_lifecycle_events (
      asset_id, from_status, to_status, notes, performed_by, metadata
    ) values (
      v_asset.id, coalesce(v_asset.lifecycle_status, 'ready'), 'checked_out',
      btrim(p_notes), v_user_id,
      jsonb_build_object('assignmentId', v_assignment_id, 'ownerEmployeeId', p_owner_employee_id,
        'custodianEmployeeId', v_custodian_id, 'assignedUserEmployeeId', v_assigned_user_id)
    );
  end loop;

  if v_seen <> cardinality(p_asset_ids) then
    raise exception using errcode = 'P0002', message = 'EMPLOYEE_ASSIGNMENT_ASSET_NOT_FOUND';
  end if;

  update public.employee_assignment_batches
  set total_count = cardinality(v_assignment_ids)
  where id = v_batch_id;

  return jsonb_build_object('batchId', v_batch_id, 'assignmentIds', to_jsonb(v_assignment_ids),
    'count', cardinality(v_assignment_ids), 'employeeId', p_employee_id);
end;
$$;

create or replace function public.bulk_return_employee_assets(
  p_employee_id uuid,
  p_return_date date default current_date,
  p_return_receiver_employee_id uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_batch_id uuid;
  v_assignment_asset_ids uuid[] := '{}'::uuid[];
  v_loan_asset_ids uuid[] := '{}'::uuid[];
  v_all_asset_ids uuid[] := '{}'::uuid[];
  v_assignment_count integer := 0;
  v_loan_count integer := 0;
  v_asset_count integer := 0;
begin
  if v_user_id is not null
     and not (public.has_permission('employee.manage') or public.has_permission('asset.transfer')) then
    raise exception using errcode = '42501', message = 'EMPLOYEE_ASSIGNMENT_PERMISSION_REQUIRED';
  end if;
  if p_employee_id is null or not exists (select 1 from public.employees where id = p_employee_id) then
    raise exception using errcode = 'P0002', message = 'EMPLOYEE_NOT_FOUND';
  end if;
  if p_return_date is null then
    raise exception using errcode = '22023', message = 'EMPLOYEE_ASSIGNMENT_RETURN_DATE_REQUIRED';
  end if;
  if p_return_receiver_employee_id is not null and not exists (
    select 1 from public.employees where id = p_return_receiver_employee_id and status = 'active'
  ) then
    raise exception using errcode = 'P0002', message = 'EMPLOYEE_ASSIGNMENT_RETURN_RECEIVER_NOT_FOUND';
  end if;
  if exists (
    select 1 from public.employee_assignments
    where employee_id = p_employee_id and status in ('ครอบครอง', 'ส่งซ่อม')
      and checkout_date is not null and checkout_date > p_return_date
  ) then
    raise exception using errcode = '22023', message = 'EMPLOYEE_ASSIGNMENT_RETURN_DATE_INVALID';
  end if;

  select coalesce(array_agg(distinct asset_id) filter (where asset_id is not null), '{}'::uuid[])
    into v_assignment_asset_ids
  from public.employee_assignments
  where employee_id = p_employee_id and status in ('ครอบครอง', 'ส่งซ่อม');

  select coalesce(array_agg(distinct asset_id) filter (where asset_id is not null), '{}'::uuid[])
    into v_loan_asset_ids
  from public.asset_loans
  where borrower_employee_id = p_employee_id and status = 'active';

  select coalesce(array_agg(distinct ids.asset_id), '{}'::uuid[])
    into v_all_asset_ids
  from (
    select unnest(v_assignment_asset_ids) as asset_id
    union
    select unnest(v_loan_asset_ids) as asset_id
  ) ids;

  insert into public.employee_assignment_batches (
    employee_id, operation, return_date, requested_by, detail
  ) values (
    p_employee_id,
    case when v_user_id is null then 'offboarding' else 'return' end,
    p_return_date, v_user_id,
    jsonb_build_object('reason', p_reason, 'returnReceiverEmployeeId', p_return_receiver_employee_id)
  ) returning id into v_batch_id;

  update public.employee_assignments
  set status = 'คืนแล้ว', returned_date = p_return_date, return_date = p_return_date,
      return_reason = btrim(p_reason), returned_by = v_user_id,
      assignment_batch_id = v_batch_id, updated_by = v_user_id
  where employee_id = p_employee_id and status in ('ครอบครอง', 'ส่งซ่อม');
  get diagnostics v_assignment_count = row_count;

  update public.asset_loans
  set status = 'returned', returned_at = p_return_date,
      return_receiver_employee_id = p_return_receiver_employee_id,
      auto_returned = p_return_receiver_employee_id is null,
      condition_after = coalesce(condition_after, 'Auto-returned from employee offboarding'),
      return_notes = concat_ws(E'\n', nullif(return_notes, ''), nullif(btrim(p_reason), ''),
        case when p_return_receiver_employee_id is null then 'Auto-returned from employee offboarding' end),
      updated_at = now()
  where borrower_employee_id = p_employee_id and status = 'active';
  get diagnostics v_loan_count = row_count;

  update public.assets a
  set status = 'พร้อมใช้งาน', lifecycle_status = 'returned', owner_employee_id = null,
      department_id = null, loan_date = null, loan_due_date = null, updated_by = v_user_id
  where a.id = any(v_all_asset_ids)
    and not exists (
      select 1 from public.employee_assignments ea
      where ea.asset_id = a.id and ea.status in ('ครอบครอง', 'ส่งซ่อม')
    )
    and not exists (
      select 1 from public.asset_loans al
      where al.asset_id = a.id and al.status = 'active'
    );
  get diagnostics v_asset_count = row_count;

  insert into public.asset_movements (
    asset_id, action_type, from_employee_id, status_label, notes, created_by
  )
  select distinct asset_id, 'Return', p_employee_id,
    case when v_user_id is null then 'คืนอัตโนมัติจาก Offboarding' else 'คืนแบบกลุ่ม' end,
    btrim(p_reason), v_user_id
  from unnest(v_all_asset_ids) asset_id;

  insert into public.asset_lifecycle_events (
    asset_id, from_status, to_status, notes, performed_by, metadata
  )
  select distinct asset_id, 'checked_out', 'returned', btrim(p_reason), v_user_id,
    jsonb_build_object('employeeId', p_employee_id, 'batchId', v_batch_id,
      'automatic', v_user_id is null)
  from unnest(v_all_asset_ids) asset_id;

  update public.employee_assignment_batches
  set total_count = v_assignment_count + v_loan_count,
      detail = detail || jsonb_build_object('assignmentCount', v_assignment_count,
        'loanCount', v_loan_count, 'assetCount', v_asset_count)
  where id = v_batch_id;

  return jsonb_build_object('batchId', v_batch_id, 'employeeId', p_employee_id,
    'assignmentCount', v_assignment_count, 'loanCount', v_loan_count, 'assetCount', v_asset_count);
end;
$$;

revoke all on function public.bulk_assign_employee_assets(uuid, uuid[], date, uuid, uuid, uuid, uuid, text, jsonb, text) from public;
grant execute on function public.bulk_assign_employee_assets(uuid, uuid[], date, uuid, uuid, uuid, uuid, text, jsonb, text) to authenticated, service_role;
revoke all on function public.bulk_return_employee_assets(uuid, date, uuid, text) from public;
grant execute on function public.bulk_return_employee_assets(uuid, date, uuid, text) to authenticated, service_role;

-- Changing an employee to Inactive is the low-level offboarding signal. The
-- trigger is also useful for imports and admin tools that do not go through
-- the web route.
create or replace function public.auto_return_employee_assets_on_offboarding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'active' and new.status = 'inactive' then
    perform public.bulk_return_employee_assets(
      new.id, current_date, null, 'Employee status changed to inactive (offboarding)'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_return_employee_assets_on_offboarding on public.employees;
create trigger trg_auto_return_employee_assets_on_offboarding
  after update of status on public.employees
  for each row execute function public.auto_return_employee_assets_on_offboarding();

comment on column public.employee_assignments.owner_employee_id is 'Legal/business owner; separate from the custodian and assigned user.';
comment on column public.employee_assignments.custodian_employee_id is 'Person accountable for physical custody of the asset.';
comment on column public.employee_assignments.assigned_user_employee_id is 'Person assigned to use the asset.';
comment on column public.employee_assignments.handover_document_id is 'Attachment metadata id for the signed handover document.';
