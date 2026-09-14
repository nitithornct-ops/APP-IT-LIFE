-- ============================================================================
-- P1 Software License Management
-- Product metadata, per-user/device allocation, reclaim history, and renewal approval.
-- Existing software_licenses rows remain valid; product_name is backfilled from
-- software_name and legacy used_qty remains the fallback until allocations exist.
-- ============================================================================

alter table public.software_licenses
  add column product_name text,
  add column edition text,
  add column version text,
  add column publisher text,
  add column license_model text not null default 'SaaS',
  add column renewal_approval_status text not null default 'pending',
  add column renewal_approved_by uuid references auth.users(id) on delete set null,
  add column renewal_approved_at timestamptz,
  add column renewal_approval_notes text;

update public.software_licenses
set product_name = software_name
where product_name is null;

alter table public.software_licenses
  alter column product_name set not null,
  add constraint software_licenses_license_model_valid
    check (license_model in ('SaaS', 'Device', 'Concurrent')),
  add constraint software_licenses_renewal_approval_status_valid
    check (renewal_approval_status in ('pending', 'approved', 'rejected'));

create index software_licenses_product_name_idx on public.software_licenses (product_name);
create index software_licenses_renewal_approval_idx on public.software_licenses (renewal_approval_status, expire_date);

create table public.software_license_allocations (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.software_licenses(id) on delete cascade,
  assignee_type text not null check (assignee_type in ('user', 'device')),
  employee_id uuid references public.employees(id) on delete restrict,
  asset_id uuid references public.assets(id) on delete restrict,
  status text not null default 'assigned' check (status in ('assigned', 'reclaimed')),
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id) on delete set null,
  reclaimed_at timestamptz,
  reclaimed_by uuid references auth.users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint software_license_allocations_target_valid check (
    (assignee_type = 'user' and employee_id is not null and asset_id is null)
    or (assignee_type = 'device' and asset_id is not null and employee_id is null)
  ),
  constraint software_license_allocations_reclaim_state_valid check (
    (status = 'assigned' and reclaimed_at is null)
    or (status = 'reclaimed' and reclaimed_at is not null)
  )
);

create index software_license_allocations_license_idx
  on public.software_license_allocations (license_id, status, assigned_at desc);
create index software_license_allocations_employee_idx
  on public.software_license_allocations (employee_id, status)
  where employee_id is not null;
create index software_license_allocations_asset_idx
  on public.software_license_allocations (asset_id, status)
  where asset_id is not null;
create unique index software_license_allocations_active_employee_unique
  on public.software_license_allocations (license_id, employee_id)
  where status = 'assigned' and employee_id is not null;
create unique index software_license_allocations_active_asset_unique
  on public.software_license_allocations (license_id, asset_id)
  where status = 'assigned' and asset_id is not null;

create trigger trg_software_license_allocations_set_updated_at
  before update on public.software_license_allocations
  for each row execute function public.set_updated_at();

alter table public.software_license_allocations enable row level security;

create policy software_license_allocations_select_with_permission
  on public.software_license_allocations
  for select to authenticated
  using (public.has_permission('license.view'));

create policy software_license_allocations_write_with_permission
  on public.software_license_allocations
  for all to authenticated
  using (public.has_permission('license.manage'))
  with check (public.has_permission('license.manage'));

-- The Worker calls these functions with the service role after its permission
-- middleware has authenticated the actor. The license row is locked before the
-- allocation write so concurrent assignments cannot read stale license state.
create or replace function public.assign_software_license(
  p_license_id uuid,
  p_assignee_type text,
  p_employee_id uuid default null,
  p_asset_id uuid default null,
  p_notes text default null,
  p_actor_id uuid default null
)
returns setof public.software_license_allocations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_allocation_id uuid;
begin
  if p_assignee_type not in ('user', 'device') then
    raise exception using errcode = '23514', message = 'ALLOCATION_TYPE_INVALID';
  end if;
  if (p_assignee_type = 'user' and (p_employee_id is null or p_asset_id is not null))
     or (p_assignee_type = 'device' and (p_asset_id is null or p_employee_id is not null)) then
    raise exception using errcode = '23514', message = 'ALLOCATION_TARGET_INVALID';
  end if;

  perform 1 from public.software_licenses where id = p_license_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'LICENSE_NOT_FOUND';
  end if;
  if p_employee_id is not null and not exists (
    select 1 from public.employees where id = p_employee_id and status = 'active'
  ) then
    raise exception using errcode = 'P0002', message = 'EMPLOYEE_NOT_FOUND';
  end if;
  if p_asset_id is not null and not exists (
    select 1 from public.assets where id = p_asset_id
  ) then
    raise exception using errcode = 'P0002', message = 'ASSET_NOT_FOUND';
  end if;

  insert into public.software_license_allocations (
    license_id, assignee_type, employee_id, asset_id, assigned_by, notes
  ) values (
    p_license_id, p_assignee_type, p_employee_id, p_asset_id, p_actor_id, nullif(trim(p_notes), '')
  ) returning id into v_allocation_id;

  return query
    select * from public.software_license_allocations where id = v_allocation_id;
end;
$$;

create or replace function public.reclaim_software_license(
  p_license_id uuid,
  p_allocation_id uuid,
  p_notes text default null,
  p_actor_id uuid default null
)
returns setof public.software_license_allocations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_allocation_id uuid;
begin
  perform 1 from public.software_licenses where id = p_license_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'LICENSE_NOT_FOUND';
  end if;

  update public.software_license_allocations
  set status = 'reclaimed',
      reclaimed_at = now(),
      reclaimed_by = p_actor_id,
      notes = case when nullif(trim(p_notes), '') is null then notes else trim(p_notes) end,
      updated_at = now()
  where id = p_allocation_id and license_id = p_license_id and status = 'assigned'
  returning id into v_allocation_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'ALLOCATION_NOT_FOUND_OR_ALREADY_RECLAIMED';
  end if;

  return query
    select * from public.software_license_allocations where id = v_allocation_id;
end;
$$;

revoke all on function public.assign_software_license(uuid, text, uuid, uuid, text, uuid) from public;
revoke all on function public.reclaim_software_license(uuid, uuid, text, uuid) from public;
grant execute on function public.assign_software_license(uuid, text, uuid, uuid, text, uuid) to service_role;
grant execute on function public.reclaim_software_license(uuid, uuid, text, uuid) to service_role;
