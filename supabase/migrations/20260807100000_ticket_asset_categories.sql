-- ============================================================================
-- Master Data: ticket_categories, asset_categories
-- Legacy: TicketCategories/AssetCategories (Config.gs > DB_SCHEMA, legacy-gas/docs/02) —
-- หมวดหมู่ที่โมดูล Ticket (Phase 6 ลำดับที่ 4) และ Asset (ลำดับที่ 8) จะอ้างอิงต่อ สร้างล่วงหน้า
-- ไว้ที่นี่เพราะเป็น Master Data ตามลำดับ Phase 6 ข้อ 1 ใน phase0-migration_roadmap.md
-- (Field Designer ของโมดูล D8 เดิม ไม่ย้าย — phase0-migration_matrix.md เสนอให้ตัด/เลื่อนไว้แล้ว)
-- ============================================================================

create table public.ticket_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- ค่ามาตรฐาน 4 ระดับเดียวกับ Tickets.Priority ของระบบเดิม (legacy-gas/docs/02, บรรทัด Tickets)
  default_priority text not null default 'ปานกลาง' check (default_priority in ('ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต')),
  response_sla_hours numeric,
  resolution_sla_hours numeric,
  sla_hours numeric,
  is_security_default boolean not null default false,
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint ticket_categories_name_unique unique (name)
);

create index ticket_categories_status_idx on public.ticket_categories (status);

create trigger trg_ticket_categories_set_updated_at
  before update on public.ticket_categories
  for each row execute function public.set_updated_at();

alter table public.ticket_categories enable row level security;

create policy ticket_categories_select_all_authenticated on public.ticket_categories
  for select to authenticated using (true);

create policy ticket_categories_write_with_permission on public.ticket_categories
  for all to authenticated
  using (public.has_permission('ticket_category.manage'))
  with check (public.has_permission('ticket_category.manage'));

-- code_prefix ใช้สร้างรหัสทรัพย์สินอัตโนมัติ (เช่น "NB-0001") ในโมดูล Asset ที่จะสร้างใน Phase 6 ลำดับ 8
create table public.asset_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code_prefix text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint asset_categories_name_unique unique (name),
  constraint asset_categories_code_prefix_unique unique (code_prefix)
);

create index asset_categories_status_idx on public.asset_categories (status);

create trigger trg_asset_categories_set_updated_at
  before update on public.asset_categories
  for each row execute function public.set_updated_at();

alter table public.asset_categories enable row level security;

create policy asset_categories_select_all_authenticated on public.asset_categories
  for select to authenticated using (true);

create policy asset_categories_write_with_permission on public.asset_categories
  for all to authenticated
  using (public.has_permission('asset_category.manage'))
  with check (public.has_permission('asset_category.manage'));
