-- Asset Lifecycle / Model Catalog / physical verification extensions.
-- Keep the legacy `status` column for compatibility with the existing borrow,
-- repair and reporting flows. `lifecycle_status` is the canonical lifecycle.

create table if not exists public.asset_model_catalog (
  id uuid primary key default gen_random_uuid(),
  model_code text not null,
  name text not null,
  asset_type text not null,
  brand text,
  model text,
  default_useful_life_years smallint,
  default_warranty_months smallint,
  depreciation_method text not null default 'straight_line'
    check (depreciation_method in ('straight_line', 'declining_balance', 'none')),
  default_cost_center text,
  specs jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint asset_model_catalog_code_unique unique (model_code)
);

create index if not exists asset_model_catalog_status_idx on public.asset_model_catalog (status);
create index if not exists asset_model_catalog_type_idx on public.asset_model_catalog (asset_type);

drop trigger if exists trg_asset_model_catalog_set_updated_at on public.asset_model_catalog;
create trigger trg_asset_model_catalog_set_updated_at
  before update on public.asset_model_catalog
  for each row execute function public.set_updated_at();

alter table public.asset_model_catalog enable row level security;
drop policy if exists asset_model_catalog_select_with_permission on public.asset_model_catalog;
create policy asset_model_catalog_select_with_permission on public.asset_model_catalog
  for select to authenticated using (public.has_permission('asset.view'));
drop policy if exists asset_model_catalog_write_with_permission on public.asset_model_catalog;
create policy asset_model_catalog_write_with_permission on public.asset_model_catalog
  for all to authenticated
  using (public.has_permission('asset.update'))
  with check (public.has_permission('asset.update'));

alter table public.assets add column if not exists lifecycle_status text;
update public.assets set lifecycle_status = 'ready' where lifecycle_status is null;
alter table public.assets alter column lifecycle_status set default 'ordered';
alter table public.assets alter column lifecycle_status set not null;
alter table public.assets drop constraint if exists assets_lifecycle_status_check;
alter table public.assets add constraint assets_lifecycle_status_check check (
  lifecycle_status in ('ordered', 'received', 'ready', 'checked_out', 'repair', 'returned', 'disposed')
);

alter table public.assets add column if not exists purchase_order text;
alter table public.assets add column if not exists invoice_number text;
alter table public.assets add column if not exists depreciation_method text not null default 'straight_line';
alter table public.assets add column if not exists depreciation_rate numeric(7, 4);
alter table public.assets add column if not exists cost_center text;
alter table public.assets add column if not exists barcode text;
alter table public.assets add column if not exists asset_model_catalog_id uuid references public.asset_model_catalog(id) on delete set null;
alter table public.assets add column if not exists parent_asset_id uuid references public.assets(id) on delete set null;
alter table public.assets add column if not exists physical_verification_status text not null default 'pending';
alter table public.assets add column if not exists physical_verified_at timestamptz;
alter table public.assets add column if not exists physical_verified_by uuid references auth.users(id) on delete set null;
alter table public.assets add column if not exists disposed_at date;
alter table public.assets add column if not exists disposal_reason text;
alter table public.assets add column if not exists disposal_value numeric;

alter table public.assets drop constraint if exists assets_depreciation_method_check;
alter table public.assets add constraint assets_depreciation_method_check check (
  depreciation_method in ('straight_line', 'declining_balance', 'none')
);
alter table public.assets drop constraint if exists assets_physical_verification_status_check;
alter table public.assets add constraint assets_physical_verification_status_check check (
  physical_verification_status in ('pending', 'verified', 'exception')
);

create index if not exists assets_lifecycle_status_idx on public.assets (lifecycle_status);
create index if not exists assets_parent_asset_id_idx on public.assets (parent_asset_id);
create index if not exists assets_model_catalog_id_idx on public.assets (asset_model_catalog_id);
create index if not exists assets_physical_verification_status_idx on public.assets (physical_verification_status);
create unique index if not exists assets_serial_number_active_unique
  on public.assets (lower(btrim(serial_number)))
  where serial_number is not null and btrim(serial_number) <> '' and lifecycle_status <> 'disposed';
create unique index if not exists assets_barcode_active_unique
  on public.assets (lower(btrim(barcode)))
  where barcode is not null and btrim(barcode) <> '' and lifecycle_status <> 'disposed';

create table if not exists public.asset_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  from_status text,
  to_status text not null check (to_status in ('ordered', 'received', 'ready', 'checked_out', 'repair', 'returned', 'disposed')),
  event_date timestamptz not null default now(),
  notes text,
  related_ticket_id uuid references public.tickets(id) on delete set null,
  performed_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists asset_lifecycle_events_asset_idx on public.asset_lifecycle_events (asset_id, event_date desc);
create index if not exists asset_lifecycle_events_to_status_idx on public.asset_lifecycle_events (to_status);

insert into public.asset_lifecycle_events (asset_id, from_status, to_status, event_date, notes)
select a.id, null, a.lifecycle_status, coalesce(a.created_at, now()), 'Initial lifecycle status backfill'
from public.assets a
where not exists (
  select 1 from public.asset_lifecycle_events e where e.asset_id = a.id
);

alter table public.asset_lifecycle_events enable row level security;
drop policy if exists asset_lifecycle_events_select_with_permission on public.asset_lifecycle_events;
create policy asset_lifecycle_events_select_with_permission on public.asset_lifecycle_events
  for select to authenticated using (public.has_permission('asset.view'));
drop policy if exists asset_lifecycle_events_insert_with_permission on public.asset_lifecycle_events;
create policy asset_lifecycle_events_insert_with_permission on public.asset_lifecycle_events
  for insert to authenticated with check (
    public.has_permission('asset.create') or public.has_permission('asset.update')
    or public.has_permission('asset.transfer') or public.has_permission('asset.dispose')
  );

comment on column public.assets.lifecycle_status is 'Canonical lifecycle: ordered -> received -> ready -> checked_out -> repair -> returned -> disposed';
comment on column public.assets.barcode is 'Optional physical barcode value; asset_code remains the primary QR payload';
