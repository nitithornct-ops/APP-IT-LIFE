-- ============================================================================
-- Phase 6 Module 9: CMDB — ย้าย Module_CMDB.gs (CMDB.html) ตามที่ roadmap ลำดับ 9 กำหนด "ตามแผนเดิม"
-- แหล่งอ้างอิงสเปก: ไม่มี field-level detail ใน docs/migration/ เลย (phase0-module_matrix.md ระบุแค่
-- role symbol ระดับโมดูล) จึงอ้างอิงจาก legacy-gas/Module_CMDB.gs (ground truth) +
-- legacy-gas/docs/15_CMDB_SERVICE_CATALOG_v1.10.md (business rules ที่สอดคล้องกับโค้ดจริง) โดยตรง
--
-- 2 ตารางเดิม: ConfigurationItems (CI) + CIRelationships (edge ความสัมพันธ์ระหว่าง node แบบ polymorphic
-- 8 ประเภท: CI/Asset/Vendor/Contract/Cloud/Backup/Incident/Change) — CI เป็นคนละแนวคิดกับ Asset (Module 8):
-- Asset = ทะเบียนครุภัณฑ์ (depreciation/custody/serial), CI = ทะเบียนโครงสร้าง IT เชิงบริการ (server/database/
-- application/website ฯลฯ รวมของที่จับต้องไม่ได้) เชื่อมกันแบบ soft-link ทางเดียว (CI.AssetID อ้าง Asset,
-- Asset ไม่รู้จัก CMDB เลย — grep แล้ว Module_Asset.gs/Asset.html ไม่มี "CMDB"/"ConfigurationItem" แม้แต่จุดเดียว)
--
-- ขอบเขตที่ตัดออก:
-- - Relationship Map แบบ SVG force-layout graph (cmdbDrawMap_ ใน CMDB.html) — เป็น presentation layer
--   บนข้อมูลที่จัดการได้ครบผ่านตาราง/ฟอร์มอยู่แล้ว แนวทางเดียวกับการเลื่อน Chart.js analytics ใน Module 8
--   ไปที่ Report Center — ตารางความสัมพันธ์ + หน้า detail ของแต่ละ CI (แสดงรายการความสัมพันธ์ที่เกี่ยวข้อง)
--   ทดแทนได้ในแง่ข้อมูล ส่วนกราฟภาพจะทำทีหลังได้โดยไม่กระทบ schema/business logic เลย
-- - SourceType/TargetType อีก 6 ประเภทจาก 8 (Vendor/Contract/Cloud/Backup/Incident/Change) — schema/CHECK
--   รองรับครบ 8 ประเภทไว้ล่วงหน้า (ไม่ต้อง migration เพิ่มทีหลัง) แต่ frontend dropdown เปิดให้เลือกจริง
--   เฉพาะ CI/Asset (2 ตารางที่มีอยู่จริงตอนนี้) ส่วนอีก 6 ประเภทรอโมดูลที่เกี่ยวข้องถึงคิว (Vendor/Contract
--   คือ roadmap ลำดับ 13, Backup คือลำดับ 16, Incident คือลำดับ 10 ถัดไป, Change คือลำดับ 12) — เช่นเดียวกับ
--   vendor_name ที่เป็น free text ใน Module 8 ตอนนี้เพิ่ม vendor_name/contract_ref/cloud_ref บน CI เอง
--   (แทน VendorID/ContractRef/CloudID เดิม) ด้วยเหตุผลเดียวกัน
-- - "Contract" เป็น node แบบ virtual ในระบบเดิม (สร้างจาก VendorRegister.ContractNo ไม่มีตาราง Contracts จริง)
--   — ระบบใหม่ยังไม่มีตาราง contracts เลย (รอ roadmap ลำดับ 13) จึงยังไม่ผูก endpoint ประเภทนี้เหมือนกัน
--
-- การปรับปรุงจากของเดิม:
-- - CI.Owner/Administrator (free text เดิม) → owner_employee_id/administrator_employee_id อ้าง employees(id)
--   จริง เหตุผลเดียวกับ Asset.owner_employee_id ใน Module 8 (มี Employee infra แล้ว)
-- - CI.AssetID (soft-FK ตรวจใน App code เท่านั้น) → asset_id อ้าง assets(id) จริงระดับ DB + partial unique
--   index บังคับ "Asset ผูกได้กับ CI เดียว" ที่ DB โดยตรง (เดิมตรวจใน cmdbValidateCiUniqueness_ ฝั่ง code
--   เท่านั้น) — ตรงกับความเสี่ยงที่ระบุใน phase0-risk_register.md ("CMDB ไม่มี Foreign Key จริงในระดับ
--   ฐานข้อมูล") ที่การย้ายมา Postgres แก้ได้โดยตรงสำหรับ 2 ประเภท node ที่มีตารางจริงแล้ว (CI เอง + Asset)
-- - CIRelationships.SourceName/TargetName (denormalized cache เดิม เอกสารเดิมเองระบุว่า "cache ไม่ใช่
--   ความจริงหลัก") — ตัดออก ใช้ query จริงตอนอ่านแทน (Postgres join ได้ตรง ๆ ไม่ต้องพึ่ง cache แบบ
--   Google Sheets ที่ join ข้าม sheet ยาก)
-- - เงื่อนไข "required if" (RPO/RTO เมื่อ Active+Production+Criticality สูง, BackupReference เมื่อ
--   BackupRequired) ย้ายจาก JS validation ฝั่ง server เดิม มาเป็น CHECK constraint ระดับ DB ตรง ๆ
--   (บังคับได้แน่นอนกว่า ตรงกับที่ risk register เสนอให้ Postgres ช่วยแก้จุดอ่อนเรื่อง data integrity)
-- - BackupRequired (Yes/No text เดิม) → boolean จริง
--
-- Cycle detection (DEPENDS_ON/RUNS_ON ห้ามเกิด cycle) และกฎ semantic ของ RelationshipType (เช่น
-- SUPPLIED_BY ต้องชี้ Vendor, BACKED_UP_BY ต้องชี้ Backup หรือ CI ประเภท Backup Job) ย้ายไปเป็น business
-- logic ในชั้น API (apps/api/src/routes/cmdb.ts) เหมือนระบบเดิม (ไม่ใช่ DB trigger) เพราะเดิมก็เป็น App code
-- ล้วน ไม่ใช่ DB-level — คงรูปแบบเดิมไว้ ต่างจาก required-if ข้างต้นที่ CHECK constraint แสดงออกได้ตรงไปตรงมา
--
-- Permission: ระบบเดิม MODULE_ACCESS.cmdb = { roles:['ITAdmin'], readOnlyRoles:['Approver','Executive','DPO'] }
-- (เทียบเท่ากับ asset เดิมที่ roles:['ITAdmin'], readOnlyRoles:['Executive'] เป๊ะ — Module 8 ขยายสิทธิ์เขียน
-- ให้ technician ด้วยแล้วเพราะเป็นงานปฏิบัติการ IT ประจำวัน ไม่ใช่แค่ผู้ดูแลระบบระดับสูง ที่นี่ให้เหตุผล
-- เดียวกัน: technician ควรแก้ CI ที่ผูกกับ Asset ที่ตัวเองดูแลได้ ไม่งั้นจะเกิดช่องว่างที่แก้ Asset ได้แต่แก้
-- CI คู่กันไม่ได้) จึงใช้ cmdb.view/cmdb.manage (2 คีย์ แบบเดียวกับ maintenance/inventory/license ใน
-- Module 8 ไม่ใช่แบบ asset ที่แยกคีย์ตาม action เพราะ CMDB เดิมไม่เคยแยกสิทธิ์ระดับ action เลยสักจุด) —
-- manager/executive/auditor ได้ view ตาม convention เดียวกับ Module 8 (กว้างกว่าที่ระบบเดิมระบุ แต่เป็น
-- แนวทางที่ใช้สม่ำเสมอทุกโมดูลปฏิบัติการ IT ตั้งแต่ Module 8) — dpo ได้ view เพิ่มเป็นพิเศษเฉพาะโมดูลนี้
-- ตรงกับที่ระบบเดิมระบุไว้ชัดเจน (ไม่เหมือน asset ที่ dpo ไม่มีสิทธิ์) เพราะ CI มีฟิลด์ DataClassification/
-- RPO/RTO/BackupRequired ที่เกี่ยวข้องกับงาน DPO โดยตรง ไม่ใช่แค่ port role list เดิมมาเฉย ๆ
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Configuration Items (CI)
-- ----------------------------------------------------------------------------
create table public.configuration_items (
  id uuid primary key default gen_random_uuid(),
  ci_code text not null,
  name text not null,
  ci_type text not null check (ci_type in (
    'Server', 'VM', 'Database', 'Application', 'Website', 'Network Device', 'Firewall',
    'Switch', 'Access Point', 'Domain', 'SSL Certificate', 'API', 'Cloud Service',
    'Backup Job', 'Business Service', 'Other'
  )),
  environment text not null check (environment in ('Production', 'UAT', 'Development', 'DR', 'Shared', 'N/A')),
  business_service text,
  owner_employee_id uuid references public.employees(id) on delete set null,
  administrator_employee_id uuid references public.employees(id) on delete set null,
  criticality text not null default 'Medium' check (criticality in ('Low', 'Medium', 'High', 'Critical')),
  ip_address text,
  url text,
  version text,
  vendor_name text,
  contract_ref text,
  asset_id uuid references public.assets(id) on delete set null,
  cloud_ref text,
  data_classification text not null default 'ไม่ลับ' check (data_classification in ('ไม่ลับ', 'ลับ', 'ลับมาก')),
  rpo_hours numeric(8, 2) check (rpo_hours is null or (rpo_hours >= 0 and rpo_hours <= 87600)),
  rto_hours numeric(8, 2) check (rto_hours is null or (rto_hours >= 0 and rto_hours <= 87600)),
  backup_required boolean not null default false,
  backup_reference text,
  location text,
  status text not null default 'Draft' check (status in ('Draft', 'Active', 'Maintenance', 'Degraded', 'Retired')),
  status_reason text,
  last_verified_at timestamptz,
  last_verified_by uuid references auth.users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint configuration_items_ci_code_unique unique (ci_code),
  constraint configuration_items_backup_reference_required check (
    backup_required = false or backup_reference is not null
  ),
  constraint configuration_items_rpo_rto_required check (
    not (status = 'Active' and environment = 'Production' and criticality in ('High', 'Critical'))
    or (rpo_hours is not null and rto_hours is not null)
  )
);

-- ชื่อ CI ต้องไม่ซ้ำภายใน Environment เดียวกัน ยกเว้นตัวที่ Retired แล้ว (ตรงกับ cmdbValidateCiReferences_ เดิม)
create unique index configuration_items_name_environment_unique
  on public.configuration_items (name, environment) where status <> 'Retired';

-- Asset/Cloud หนึ่งตัวผูกได้กับ CI เดียวเท่านั้น (เดิมตรวจแค่ใน App code — ที่นี่บังคับที่ DB ได้จริง)
create unique index configuration_items_asset_id_unique
  on public.configuration_items (asset_id) where asset_id is not null;
create unique index configuration_items_cloud_ref_unique
  on public.configuration_items (cloud_ref) where cloud_ref is not null;

create index configuration_items_ci_type_idx on public.configuration_items (ci_type);
create index configuration_items_environment_idx on public.configuration_items (environment);
create index configuration_items_status_idx on public.configuration_items (status);
create index configuration_items_criticality_idx on public.configuration_items (criticality);
create index configuration_items_owner_employee_id_idx on public.configuration_items (owner_employee_id);

create trigger trg_configuration_items_set_updated_at
  before update on public.configuration_items
  for each row execute function public.set_updated_at();

alter table public.configuration_items enable row level security;

create policy configuration_items_select_with_permission on public.configuration_items
  for select to authenticated using (public.has_permission('cmdb.view'));

create policy configuration_items_write_with_permission on public.configuration_items
  for all to authenticated
  using (public.has_permission('cmdb.manage'))
  with check (public.has_permission('cmdb.manage'));

-- ----------------------------------------------------------------------------
-- CI Relationships — edge แบบ polymorphic เชื่อม node 8 ประเภท (CI/Asset/Vendor/Contract/Cloud/Backup/
-- Incident/Change) ไม่มี FK จริงข้ามประเภทได้ (Postgres ไม่รองรับ FK แบบมีเงื่อนไขตาม discriminator column
-- โดยตรง) — ตรวจการมีอยู่จริงของปลายทางในชั้น API แทน (ทำได้เฉพาะ CI/Asset ที่มีตารางจริงตอนนี้ — เหมือน
-- ระบบเดิมที่ตรวจทุกประเภทในชั้น App code เท่ากัน เพียงแต่ตอนนี้ตรวจได้จริงแค่ 2 ใน 8 ประเภทที่มีตารางแล้ว)
-- ----------------------------------------------------------------------------
create table public.ci_relationships (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('CI', 'Asset', 'Vendor', 'Contract', 'Cloud', 'Backup', 'Incident', 'Change')),
  source_id uuid not null,
  target_type text not null check (target_type in ('CI', 'Asset', 'Vendor', 'Contract', 'Cloud', 'Backup', 'Incident', 'Change')),
  target_id uuid not null,
  relationship_type text not null check (relationship_type in (
    'DEPENDS_ON', 'RUNS_ON', 'HOSTS', 'CONNECTS_TO', 'USES', 'BACKED_UP_BY',
    'SUPPLIED_BY', 'COVERED_BY_CONTRACT', 'IMPACTED_BY', 'CHANGED_BY', 'LINKED_TO'
  )),
  direction text not null default 'Forward' check (direction in ('Forward', 'Bidirectional')),
  impact_level text not null default 'Medium' check (impact_level in ('Low', 'Medium', 'High', 'Critical')),
  description text,
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  status_reason text,
  valid_from date,
  valid_until date,
  last_verified_at timestamptz,
  last_verified_by uuid references auth.users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint ci_relationships_no_self_link check (not (source_type = target_type and source_id = target_id)),
  constraint ci_relationships_valid_range check (valid_until is null or valid_from is null or valid_until >= valid_from),
  constraint ci_relationships_bidirectional_types check (
    direction = 'Forward' or relationship_type in ('CONNECTS_TO', 'LINKED_TO')
  )
);

-- กันคู่ซ้ำ (source,target,type) ตรงตัว — ส่วนกรณี reverse-duplicate (Bidirectional/CONNECTS_TO/LINKED_TO)
-- ตรวจในชั้น API เพราะต้องสลับ source/target เทียบ ซึ่ง unique index ทำแบบมีเงื่อนไขตาม relationship_type
-- ไม่ได้ตรงไปตรงมา (เดิมก็ตรวจใน App code เท่านั้นเช่นกัน)
create unique index ci_relationships_source_target_type_unique
  on public.ci_relationships (source_type, source_id, target_type, target_id, relationship_type);

create index ci_relationships_source_idx on public.ci_relationships (source_type, source_id);
create index ci_relationships_target_idx on public.ci_relationships (target_type, target_id);
create index ci_relationships_relationship_type_idx on public.ci_relationships (relationship_type);
create index ci_relationships_status_idx on public.ci_relationships (status);

create trigger trg_ci_relationships_set_updated_at
  before update on public.ci_relationships
  for each row execute function public.set_updated_at();

alter table public.ci_relationships enable row level security;

create policy ci_relationships_select_with_permission on public.ci_relationships
  for select to authenticated using (public.has_permission('cmdb.view'));

create policy ci_relationships_write_with_permission on public.ci_relationships
  for all to authenticated
  using (public.has_permission('cmdb.manage'))
  with check (public.has_permission('cmdb.manage'));
