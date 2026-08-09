-- ============================================================================
-- Phase 6 Module 8: Asset — ควบรวม Module_Asset.gs (ทะเบียนทรัพย์สิน + ยืม/คืน/โอนย้าย/ส่งซ่อม),
-- Module_AssetExtras.gs (สต็อกตรวจนับ/audit), Module_ITAssetExtras.gs + Module_PMExtras.gs
-- (PM/บำรุงรักษา + Inventory + Software License), และ Module_Employee.gs ส่วน EmployeeAssignments
-- (เลื่อนมาจาก Module 3 ตามที่ระบุไว้ใน 20260809100000_employees.sql — "ย้ายไปทำพร้อม Asset module
-- ลำดับ 8 เพราะจะซ้ำซ้อนกับตาราง assignment ของ Asset") ตามที่ roadmap ลำดับ 8 กำหนดให้ "ควบรวม IT Asset
-- Extras เข้าด้วยกัน" — เป็นโมดูลเดียวที่รวม 5 ไฟล์เดิมเข้าด้วยกัน
--
-- ขอบเขตที่ตัดออกจากไฟล์เดิมทั้ง 4 ไฟล์ (Module_AssetExtras/InventoryExtras/ITAssetExtras/PMExtras):
-- - Reports/Users/Settings/Tester-QA (sub-module ใน Module_ITAssetExtras.gs) — ไม่ใช่ domain ของ Asset
--   เลย เป็นการรวมไฟล์ตามความสะดวกของระบบเดิมเท่านั้น (ชื่อไฟล์ทำให้เข้าใจผิด) Users ย้ายไปแล้วใน
--   Module 2, Settings/Audit Log คือ roadmap ลำดับ 22, Reports Center คือ roดmap ลำดับ 20, Tester/QA
--   เป็นเครื่องมือ dev-only ของระบบเดิม ไม่ใช่ business module ที่ต้องย้าย
-- - PM v2 schema (PMSchedules/PMWorkOrders/PMChecklistResults/PMFindings/PMStatusHistory ใน Config.gs)
--   — grep ทั้ง legacy-gas/ แล้วไม่มีไฟล์ .gs ใดอ่าน/เขียนตารางกลุ่มนี้เลยแม้แต่ตารางเดียว เป็น schema ที่
--   ออกแบบไว้ล่วงหน้าแต่ไม่เคยถูกเชื่อมใช้งานจริง จึงไม่มี behavior ให้ย้าย (PM ที่ implement จริงคือ
--   MaintenancePlans + PMChecklistTemplates ตารางเดียวที่ย้ายในไฟล์นี้)
-- - Analytics แบบ Chart.js เต็มรูปแบบ (getAssetAnalytics/getBorrowAnalytics/getPMAnalytics/
--   getInventoryAnalytics — breakdown by category/department/technician + 6-month trend) — เลื่อนไปทำใน
--   Report Center (roadmap ลำดับ 20 "รวมศูนย์จากที่กระจายอยู่เดิม") แทนที่จะสร้างหน้า analytics แยกราย
--   โมดูลอีก หน้ารายการของโมดูลนี้แสดงเฉพาะ KPI นับจำนวนพื้นฐาน (available/overdue/low-stock ฯลฯ) พอ
-- - การแจ้งเตือนหมดอายุ License ทาง Email/LINE (sendLicenseExpiryNotifications_) และ PM/low-stock
--   reminder — ระบบใหม่ยังไม่มี Cloudflare Cron Trigger, ผู้ให้บริการ Email หรือ LINE Channel Secret
--   (แนวทางเดียวกับ TaskReminders ที่เลื่อนใน Module 7) การคำนวณสถานะหมดอายุ (checkExpireLicenses_)
--   ยังคงย้ายมาเป็น endpoint กดคำนวณเองได้ เฉพาะการ "ส่งแจ้งเตือน" เท่านั้นที่เลื่อน
-- - ปุ่มพิมพ์เอกสาร (ใบยืม/QR label/ใบขอซื้อ popup) — เป็น UI polish ไม่กระทบ business logic เลื่อนไปพร้อม
--   รอบทำ PDF/Print center (เดียวกับเหตุผลที่ Field/PDF Designer ถูกเลื่อนทั้ง roadmap)
-- - Ticket/Evidence linkage บนรายการเคลื่อนไหวทรัพย์สิน (RelatedTicketID/EvidenceLink) — เก็บคอลัมน์ไว้
--   รองรับอนาคตแต่ยังไม่เชื่อม UI แนบไฟล์ (ช่องว่าง cross-cutting เดียวกับที่ Ticket/Task/ServiceRequest/
--   AccessRequest ทุกโมดูลก่อนหน้ายังไม่เชื่อมกับ file_attachments เช่นกัน)
-- - addAssetMovement(form) (Module_ITAssetExtras.gs) — ตรวจสอบแล้วว่า UI จริง (ITAssetExtras.html)
--   ไม่ได้เรียกใช้ฟังก์ชันนี้เลย (เรียก assignAsset/returnAsset/transferAsset/sendToRepair แยกฟังก์ชัน
--   แทน) เข้าข่าย dead code ไม่ย้าย
--
-- การปรับปรุงจากของเดิม (ไม่ใช่การตัดขอบเขต แต่ใช้ประโยชน์จากโครงสร้างใหม่ที่มีอยู่แล้ว):
-- - Asset.Owner/OwnerName/OwnerEmail (free text เดิม) → owner_employee_id อ้างอิง employees(id) จริง
--   ตามที่ comment ใน 20260809100000_employees.sql ระบุไว้ล่วงหน้าแล้วว่า "Asset/Ticket ต้องการ owner
--   ที่ถูกต้อง" — Assign/Transfer ในระบบใหม่จึงเลือกพนักงานจริงจาก dropdown แทนการพิมพ์ชื่อเอง
-- - Asset.Category (free text เดิม) → category_id อ้างอิง asset_categories(id) ที่มีอยู่แล้วตั้งแต่
--   20260807100000_ticket_asset_categories.sql (สร้างล่วงหน้าไว้ก่อน Module 8 ตามลำดับ Master Data)
-- - Vendor ยังเป็น free text (vendor_name) เพราะโมดูล Contract/Vendor (roadmap ลำดับ 13) ยังไม่ถูกย้าย
--   — จะ normalize เป็น FK จริงตอนโมดูลนั้นถึงคิว
--
-- Permission: ไม่มี owner-only RLS แบบ Task — ทุกตารางในไฟล์นี้เป็นข้อมูลปฏิบัติการฝ่าย IT (back-office)
-- ตรงกับ MODULE_ACCESS เดิมที่ทุกโมดูล (asset/borrow/maintenance/inventory/license/employees) เป็น
-- ITAdmin แก้ไข + Executive อ่านอย่างเดียว ล้วนไม่มีแนวคิด "ข้อมูลส่วนตัว" เลย จึงใช้รูปแบบ
-- has_permission(...) ล้วน (แบบเดียวกับ Ticket/Employee) ไม่ใช่ owner_id = auth.uid()
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PM Checklist Templates (สร้างก่อน maintenance_plans เพราะถูกอ้างอิงเป็น FK)
-- ----------------------------------------------------------------------------
create table public.pm_checklist_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  items_json jsonb not null default '[]'::jsonb,
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

create index pm_checklist_templates_status_idx on public.pm_checklist_templates (status);

create trigger trg_pm_checklist_templates_set_updated_at
  before update on public.pm_checklist_templates
  for each row execute function public.set_updated_at();

alter table public.pm_checklist_templates enable row level security;

create policy pm_checklist_templates_select_with_permission on public.pm_checklist_templates
  for select to authenticated using (public.has_permission('maintenance.view'));

create policy pm_checklist_templates_write_with_permission on public.pm_checklist_templates
  for all to authenticated
  using (public.has_permission('maintenance.manage'))
  with check (public.has_permission('maintenance.manage'));

-- ----------------------------------------------------------------------------
-- Assets (AssetRegister เดิม)
-- ----------------------------------------------------------------------------
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  asset_code text not null,
  name text not null,
  -- ประเภท ISMS เดิม (ใช้คู่กับ Patch/Criticality) — เก็บคู่ขนานกับ category_id ตามฟิลด์เดิม
  asset_type text not null default 'อื่นๆ' check (asset_type in (
    'Server', 'Network Device', 'Software/License', 'Endpoint', 'Storage', 'อื่นๆ'
  )),
  category_id uuid references public.asset_categories(id) on delete set null,
  brand text,
  model text,
  serial_number text,
  vendor_name text,
  purchase_date date,
  warranty_expire date,
  price numeric,
  useful_life_years smallint,
  license_no text,
  license_expiry date,
  location text,
  department_id uuid references public.departments(id) on delete set null,
  owner_employee_id uuid references public.employees(id) on delete set null,
  patch_status text,
  patch_date date,
  criticality text check (criticality is null or criticality in ('สูง', 'กลาง', 'ต่ำ')),
  status text not null default 'พร้อมใช้งาน' check (status in (
    'พร้อมใช้งาน', 'ใช้งานอยู่', 'ซ่อมบำรุง', 'จำหน่าย/เลิกใช้', 'สูญหาย'
  )),
  qr_code_url text,
  last_audit_date date,
  last_audit_by uuid references auth.users(id) on delete set null,
  audit_status text,
  loan_date date,
  loan_due_date date,
  notes text,
  remark text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint assets_asset_code_unique unique (asset_code)
);

create index assets_category_id_idx on public.assets (category_id);
create index assets_department_id_idx on public.assets (department_id);
create index assets_owner_employee_id_idx on public.assets (owner_employee_id);
create index assets_status_idx on public.assets (status);

create trigger trg_assets_set_updated_at
  before update on public.assets
  for each row execute function public.set_updated_at();

alter table public.assets enable row level security;

create policy assets_select_with_permission on public.assets
  for select to authenticated using (public.has_permission('asset.view'));

create policy assets_insert_with_permission on public.assets
  for insert to authenticated with check (public.has_permission('asset.create'));

-- update ครอบคลุมหลาย action (แก้ไขข้อมูล/เปลี่ยนสถานะ/ยืม-คืน-โอนย้าย/จำหน่าย) — คุมสิทธิ์ละเอียด
-- รายชนิด action ที่ชั้น API (requirePermission ต่อ endpoint) ไม่ใช่ที่ RLS
create policy assets_update_with_permission on public.assets
  for update to authenticated
  using (
    public.has_permission('asset.update') or public.has_permission('asset.transfer')
    or public.has_permission('asset.dispose')
  )
  with check (
    public.has_permission('asset.update') or public.has_permission('asset.transfer')
    or public.has_permission('asset.dispose')
  );

-- ----------------------------------------------------------------------------
-- Asset Movements (Asset_History เดิม) — ประวัติยืม/คืน/โอนย้าย/ส่งซ่อม/ตรวจนับ ต่อท้ายอย่างเดียว
-- ----------------------------------------------------------------------------
create table public.asset_movements (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  action_type text not null check (action_type in (
    'Create', 'Update', 'Status', 'Retire', 'Assign', 'Return', 'Transfer',
    'ส่งซ่อม', 'รับคืนจากซ่อม', 'Audit'
  )),
  from_employee_id uuid references public.employees(id) on delete set null,
  to_employee_id uuid references public.employees(id) on delete set null,
  vendor_name text,
  department_id uuid references public.departments(id) on delete set null,
  location text,
  related_ticket_id uuid references public.tickets(id) on delete set null,
  status_label text,
  evidence_link text,
  notes text,
  due_date date,
  condition text,
  action_date timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index asset_movements_asset_id_idx on public.asset_movements (asset_id, action_date desc);

alter table public.asset_movements enable row level security;

create policy asset_movements_select_with_permission on public.asset_movements
  for select to authenticated using (public.has_permission('asset.view'));

create policy asset_movements_insert_with_permission on public.asset_movements
  for insert to authenticated with check (
    public.has_permission('asset.create') or public.has_permission('asset.update')
    or public.has_permission('asset.transfer') or public.has_permission('asset.dispose')
  );

-- ----------------------------------------------------------------------------
-- Maintenance Plans (MaintenancePlans เดิม — PM/บำรุงรักษา)
-- ----------------------------------------------------------------------------
create table public.maintenance_plans (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  plan_date date not null,
  actual_date date,
  status text not null default 'วางแผน' check (status in (
    'วางแผน', 'กำลังดำเนินการ', 'ดำเนินการแล้ว', 'ยกเลิก'
  )),
  recurrence text not null default 'ครั้งเดียว' check (recurrence in (
    'ครั้งเดียว', 'รายเดือน', 'รายไตรมาส', 'รายปี'
  )),
  next_due_date date,
  technician_id uuid references public.employees(id) on delete set null,
  checklist_json jsonb not null default '[]'::jsonb,
  result text,
  notes text,
  template_id uuid references public.pm_checklist_templates(id) on delete set null,
  recurring_parent_id uuid references public.maintenance_plans(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

create index maintenance_plans_asset_id_idx on public.maintenance_plans (asset_id);
create index maintenance_plans_status_idx on public.maintenance_plans (status);
create index maintenance_plans_plan_date_idx on public.maintenance_plans (plan_date);

create trigger trg_maintenance_plans_set_updated_at
  before update on public.maintenance_plans
  for each row execute function public.set_updated_at();

alter table public.maintenance_plans enable row level security;

create policy maintenance_plans_select_with_permission on public.maintenance_plans
  for select to authenticated using (public.has_permission('maintenance.view'));

create policy maintenance_plans_write_with_permission on public.maintenance_plans
  for all to authenticated
  using (public.has_permission('maintenance.manage'))
  with check (public.has_permission('maintenance.manage'));

-- ----------------------------------------------------------------------------
-- Inventory (Inventory + InventoryTransactions เดิม) — อะไหล่/วัสดุสิ้นเปลือง
-- ----------------------------------------------------------------------------
create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  item_name text not null,
  category text,
  unit text not null,
  stock_qty numeric not null default 0 check (stock_qty >= 0),
  min_qty numeric not null default 0 check (min_qty >= 0),
  location text,
  unit_price numeric,
  reorder_qty numeric,
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

create index inventory_items_status_idx on public.inventory_items (status);

create trigger trg_inventory_items_set_updated_at
  before update on public.inventory_items
  for each row execute function public.set_updated_at();

alter table public.inventory_items enable row level security;

create policy inventory_items_select_with_permission on public.inventory_items
  for select to authenticated using (public.has_permission('inventory.view'));

create policy inventory_items_write_with_permission on public.inventory_items
  for all to authenticated
  using (public.has_permission('inventory.manage'))
  with check (public.has_permission('inventory.manage'));

-- transaction_type: IN/OUT (การเบิก-รับปกติ, Module_ITAssetExtras.gs) + ADJUST (ตรวจนับสต็อก,
-- Module_InventoryExtras.gs) — รวมเป็น type เดียวกันแทนที่จะแยก endpoint ตามที่ระบุไว้ใน research
-- (ทั้งสองเส้นทางอัปเดต StockQty แล้วต่อท้าย ledger เหมือนกันทุกประการ ต่างกันแค่วิธีคำนวณ qty)
create table public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  transaction_type text not null check (transaction_type in ('IN', 'OUT', 'ADJUST')),
  qty numeric not null,
  balance_after numeric not null,
  variance numeric,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index inventory_transactions_item_id_idx on public.inventory_transactions (item_id, created_at desc);

alter table public.inventory_transactions enable row level security;

create policy inventory_transactions_select_with_permission on public.inventory_transactions
  for select to authenticated using (public.has_permission('inventory.view'));

create policy inventory_transactions_insert_with_permission on public.inventory_transactions
  for insert to authenticated with check (public.has_permission('inventory.manage'));

-- ----------------------------------------------------------------------------
-- Software Licenses (SoftwareLicenses เดิม)
-- ----------------------------------------------------------------------------
create table public.software_licenses (
  id uuid primary key default gen_random_uuid(),
  software_name text not null,
  license_type text,
  total_qty numeric not null default 0 check (total_qty >= 0),
  used_qty numeric not null default 0 check (used_qty >= 0),
  start_date date,
  expire_date date,
  vendor_name text,
  assigned_to text,
  status text not null default 'Active' check (status in ('Active', 'Expired', 'Inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint software_licenses_used_le_total check (used_qty <= total_qty)
);

create index software_licenses_status_idx on public.software_licenses (status);

create trigger trg_software_licenses_set_updated_at
  before update on public.software_licenses
  for each row execute function public.set_updated_at();

alter table public.software_licenses enable row level security;

create policy software_licenses_select_with_permission on public.software_licenses
  for select to authenticated using (public.has_permission('license.view'));

create policy software_licenses_write_with_permission on public.software_licenses
  for all to authenticated
  using (public.has_permission('license.manage'))
  with check (public.has_permission('license.manage'));

-- ----------------------------------------------------------------------------
-- Employee Assignments (เลื่อนมาจาก Module 3 — Module_Employee.gs ส่วน EmployeeAssignments)
-- ทรัพย์สิน/อุปกรณ์/ซอฟต์แวร์ที่พนักงานคนหนึ่งครอบครองอยู่ หนึ่งแถวต่อหนึ่งรายการ อาจผูกกับ assets.id
-- (เมื่อเป็นทรัพย์สินที่ขึ้นทะเบียนกลาง) หรือเป็นรายการอิสระ (เช่น License ซอฟต์แวร์) ก็ได้
-- ----------------------------------------------------------------------------
create table public.employee_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  category text not null default 'อื่นๆ' check (category in (
    'Computer', 'Notebook', 'Monitor', 'iPad', 'โทรศัพท์มือถือ', 'IP Phone Yealink',
    'Printer', 'Scanner', 'Software', 'Network', 'อื่นๆ'
  )),
  item_name text not null,
  asset_id uuid references public.assets(id) on delete set null,
  asset_code text,
  ip_address text,
  producer text,
  model text,
  mac_address text,
  asset_number text,
  serial_number text,
  os_system text,
  hardware_spec text,
  software_name text,
  software_license text,
  phone_number text,
  scan_user text,
  scan_folder text,
  status text not null default 'ครอบครอง' check (status in ('ครอบครอง', 'คืนแล้ว', 'ส่งซ่อม', 'สูญหาย')),
  assigned_date date,
  returned_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

create index employee_assignments_employee_id_idx on public.employee_assignments (employee_id);
create index employee_assignments_asset_id_idx on public.employee_assignments (asset_id);
create index employee_assignments_status_idx on public.employee_assignments (status);

create trigger trg_employee_assignments_set_updated_at
  before update on public.employee_assignments
  for each row execute function public.set_updated_at();

alter table public.employee_assignments enable row level security;

-- อ่านได้ทั้งสาย "จัดการทะเบียนพนักงาน" (employee.manage) และสาย "งาน IT Asset" (asset.view) เพราะ
-- ช่างเทคนิคที่ดูแล asset ก็ต้องเห็นว่าใครถืออุปกรณ์ชิ้นไหนอยู่เช่นกัน
create policy employee_assignments_select_with_permission on public.employee_assignments
  for select to authenticated using (
    public.has_permission('employee.manage') or public.has_permission('asset.view')
  );

create policy employee_assignments_write_with_permission on public.employee_assignments
  for all to authenticated
  using (public.has_permission('employee.manage'))
  with check (public.has_permission('employee.manage'));
