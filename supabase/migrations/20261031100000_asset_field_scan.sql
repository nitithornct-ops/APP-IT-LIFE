-- Asset Field Scan — campaign-based physical verification with offline-safe client refs.
-- Keep the legacy assets.verify endpoint intact; this history is the source for the
-- Asset Verification report and supports more detailed field outcomes.

create table if not exists public.asset_verification_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_code text not null unique,
  name text not null,
  planned_date date not null default current_date,
  location text,
  status text not null default 'active' check (status in ('draft', 'active', 'completed')),
  created_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_verification_campaigns_name_check check (btrim(name) <> '')
);

create index if not exists asset_verification_campaigns_status_idx
  on public.asset_verification_campaigns(status, planned_date desc);

create table if not exists public.asset_verifications (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.asset_verification_campaigns(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  client_ref text not null,
  result text not null check (result in ('found', 'not_found', 'wrong_location', 'wrong_custodian')),
  expected_location text,
  actual_location text,
  expected_custodian_employee_id uuid references public.employees(id) on delete set null,
  actual_custodian_employee_id uuid references public.employees(id) on delete set null,
  note text,
  scanned_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_verifications_client_ref_check check (btrim(client_ref) <> ''),
  constraint asset_verifications_campaign_asset_unique unique (campaign_id, asset_id),
  constraint asset_verifications_client_ref_unique unique (client_ref)
);

create index if not exists asset_verifications_campaign_idx
  on public.asset_verifications(campaign_id, updated_at desc);
create index if not exists asset_verifications_asset_idx
  on public.asset_verifications(asset_id, scanned_at desc);
create index if not exists asset_verifications_result_idx
  on public.asset_verifications(result, scanned_at desc);

create or replace function public.set_asset_field_scan_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_asset_verification_campaigns_updated_at on public.asset_verification_campaigns;
create trigger trg_asset_verification_campaigns_updated_at
  before update on public.asset_verification_campaigns
  for each row execute function public.set_asset_field_scan_updated_at();

drop trigger if exists trg_asset_verifications_updated_at on public.asset_verifications;
create trigger trg_asset_verifications_updated_at
  before update on public.asset_verifications
  for each row execute function public.set_asset_field_scan_updated_at();

alter table public.asset_verification_campaigns enable row level security;
alter table public.asset_verifications enable row level security;

drop policy if exists asset_verification_campaigns_select_with_permission on public.asset_verification_campaigns;
create policy asset_verification_campaigns_select_with_permission on public.asset_verification_campaigns
  for select to authenticated using (public.has_permission('asset.view'));
drop policy if exists asset_verification_campaigns_write_with_permission on public.asset_verification_campaigns;
create policy asset_verification_campaigns_write_with_permission on public.asset_verification_campaigns
  for all to authenticated
  using (public.has_permission('asset.update'))
  with check (public.has_permission('asset.update'));

drop policy if exists asset_verifications_select_with_permission on public.asset_verifications;
create policy asset_verifications_select_with_permission on public.asset_verifications
  for select to authenticated using (public.has_permission('asset.view'));
drop policy if exists asset_verifications_write_with_permission on public.asset_verifications;
create policy asset_verifications_write_with_permission on public.asset_verifications
  for all to authenticated
  using (public.has_permission('asset.update'))
  with check (public.has_permission('asset.update'));

insert into public.report_definitions
  (key, label, description, required_permissions, default_columns, status, sort_order)
values
  (
    'asset-verification',
    'Asset Verification',
    'ผลตรวจนับทรัพย์สินจาก Campaign หน้างาน พร้อมสถานที่ ผู้ถือครอง และหลักฐานที่ต้องติดตาม',
    array['asset.view'],
    '["campaignCode","campaignName","assetCode","assetName","result","expectedLocation","actualLocation","expectedCustodian","actualCustodian","scannedAt","note"]',
    'active',
    36
  )
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  required_permissions = excluded.required_permissions,
  default_columns = excluded.default_columns,
  status = excluded.status,
  sort_order = excluded.sort_order;

comment on table public.asset_verification_campaigns is 'Campaigns for field asset verification / physical audit.';
comment on table public.asset_verifications is 'Idempotent per-campaign asset verification records; client_ref supports offline sync retries.';
