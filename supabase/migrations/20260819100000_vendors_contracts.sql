-- ============================================================================
-- Phase 6 Module 13: Vendor & Contract Management
--
-- ระบบเดิมเก็บข้อมูลสัญญาไว้กระจัดกระจายใน VendorRegister.ContractNo,
-- ConfigurationItems.ContractRef และ MaintenancePlans.ContractNo โดยไม่มี Contracts sheet
-- (Phase 0 risk R-07) ไฟล์นี้จึงสร้าง contracts เป็น canonical table ใหม่ และคงฟิลด์
-- free-text เดิมไว้เป็น migration fallback เพื่อไม่ทำข้อมูลที่นำเข้าก่อนหน้านี้สูญหาย
-- ============================================================================

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  vendor_code text not null,
  name text not null,
  service_type text not null default 'อื่นๆ' check (service_type in (
    'ร้านซ่อม', 'ผู้ขายอุปกรณ์', 'Software', 'Internet Provider', 'ผู้ให้บริการ MA', 'Cloud', 'อื่นๆ'
  )),
  service_scope text,
  contact_person text,
  phone text,
  email text,
  contact_info text,
  owner_id uuid references public.profiles(id) on delete set null,
  assessment_result text,
  assessment_date date,
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  notes text,
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint vendors_vendor_code_unique unique (vendor_code)
);

create unique index vendors_name_unique_ci on public.vendors (lower(name));
create index vendors_service_type_idx on public.vendors (service_type);
create index vendors_status_idx on public.vendors (status);
create index vendors_owner_id_idx on public.vendors (owner_id);

create trigger trg_vendors_set_updated_at
  before update on public.vendors
  for each row execute function public.set_updated_at();

alter table public.vendors enable row level security;

create policy vendors_select_with_permission on public.vendors
  for select to authenticated using (public.has_permission('vendor.view'));

create policy vendors_write_with_permission on public.vendors
  for all to authenticated
  using (public.has_permission('vendor.manage'))
  with check (public.has_permission('vendor.manage'));

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  contract_number text not null,
  name text not null,
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  contract_type text not null default 'Other' check (contract_type in (
    'Service', 'Maintenance', 'Software', 'Internet', 'Cloud', 'Purchase', 'Other'
  )),
  service_scope text,
  key_terms text,
  start_date date,
  end_date date,
  contract_value numeric check (contract_value is null or contract_value >= 0),
  currency text not null default 'THB' check (currency ~ '^[A-Z]{3}$'),
  owner_id uuid references public.profiles(id) on delete set null,
  renewal_notice_days smallint not null default 30 check (renewal_notice_days between 0 and 3650),
  expiry_notified_at timestamptz,
  status text not null default 'Draft' check (status in ('Draft', 'Active', 'Expired', 'Terminated', 'Renewed')),
  notes text,
  legacy_source text,
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint contracts_contract_number_unique unique (contract_number),
  constraint contracts_date_range_valid check (start_date is null or end_date is null or end_date >= start_date)
);

create index contracts_vendor_id_idx on public.contracts (vendor_id);
create index contracts_owner_id_idx on public.contracts (owner_id);
create index contracts_status_idx on public.contracts (status);
create index contracts_end_date_idx on public.contracts (end_date);

create trigger trg_contracts_set_updated_at
  before update on public.contracts
  for each row execute function public.set_updated_at();

alter table public.contracts enable row level security;

create policy contracts_select_with_permission on public.contracts
  for select to authenticated using (public.has_permission('contract.view'));

create policy contracts_write_with_permission on public.contracts
  for all to authenticated
  using (public.has_permission('contract.manage'))
  with check (public.has_permission('contract.manage'));

-- Normalize cross-module references. Free-text columns remain available as legacy fallback.
alter table public.assets
  add column vendor_id uuid references public.vendors(id) on delete set null,
  add column contract_id uuid references public.contracts(id) on delete set null;
create index assets_vendor_id_idx on public.assets (vendor_id);
create index assets_contract_id_idx on public.assets (contract_id);

alter table public.asset_movements
  add column vendor_id uuid references public.vendors(id) on delete set null;
create index asset_movements_vendor_id_idx on public.asset_movements (vendor_id);

alter table public.software_licenses
  add column vendor_id uuid references public.vendors(id) on delete set null,
  add column contract_id uuid references public.contracts(id) on delete set null;
create index software_licenses_vendor_id_idx on public.software_licenses (vendor_id);
create index software_licenses_contract_id_idx on public.software_licenses (contract_id);

alter table public.maintenance_plans
  add column vendor_id uuid references public.vendors(id) on delete set null,
  add column contract_id uuid references public.contracts(id) on delete set null;
create index maintenance_plans_vendor_id_idx on public.maintenance_plans (vendor_id);
create index maintenance_plans_contract_id_idx on public.maintenance_plans (contract_id);

alter table public.configuration_items
  add column vendor_id uuid references public.vendors(id) on delete set null,
  add column contract_id uuid references public.contracts(id) on delete set null;
create index configuration_items_vendor_id_idx on public.configuration_items (vendor_id);
create index configuration_items_contract_id_idx on public.configuration_items (contract_id);

alter table public.tickets
  add column outsource_vendor_id uuid references public.vendors(id) on delete set null;
create index tickets_outsource_vendor_id_idx on public.tickets (outsource_vendor_id);

-- Consolidate any free-text vendor/contract references already migrated in earlier modules.
-- Legacy spreadsheet import in Phase 7 can use legacy_id/legacy_source to upsert remaining rows.
insert into public.vendors (vendor_code, name, service_type, status, legacy_id)
select 'VND-MIG-' || upper(substr(md5(source.name), 1, 8)), source.name, 'อื่นๆ', 'Active', source.name
from (
  select distinct btrim(vendor_name) as name from public.assets where nullif(btrim(vendor_name), '') is not null
  union
  select distinct btrim(vendor_name) from public.software_licenses where nullif(btrim(vendor_name), '') is not null
  union
  select distinct btrim(vendor_name) from public.configuration_items where nullif(btrim(vendor_name), '') is not null
) source
on conflict do nothing;

update public.assets a set vendor_id = v.id
from public.vendors v where a.vendor_id is null and lower(btrim(a.vendor_name)) = lower(v.name);

update public.software_licenses l set vendor_id = v.id
from public.vendors v where l.vendor_id is null and lower(btrim(l.vendor_name)) = lower(v.name);

update public.configuration_items ci set vendor_id = v.id
from public.vendors v where ci.vendor_id is null and lower(btrim(ci.vendor_name)) = lower(v.name);

insert into public.contracts (
  contract_number, name, vendor_id, contract_type, status, legacy_source, legacy_id
)
select distinct
  btrim(ci.contract_ref),
  'สัญญา ' || btrim(ci.contract_ref),
  ci.vendor_id,
  'Other',
  'Active',
  'ConfigurationItems.ContractRef',
  btrim(ci.contract_ref)
from public.configuration_items ci
where nullif(btrim(ci.contract_ref), '') is not null
  and ci.vendor_id is not null
on conflict (contract_number) do nothing;

update public.configuration_items ci set contract_id = c.id
from public.contracts c where ci.contract_id is null and btrim(ci.contract_ref) = c.contract_number;
