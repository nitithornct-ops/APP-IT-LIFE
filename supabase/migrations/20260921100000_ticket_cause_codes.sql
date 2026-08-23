-- ============================================================================
-- ทะเบียนรหัสสาเหตุ + ที่มาของบทความฐานความรู้
-- design_handoff_it_service_redesign 02-screens.md หัวข้อ "3j มือถือหน้างาน" จอ 2
-- ("ชิปสาเหตุ (สร้าง KB)")
--
-- ปัญหาเดิม: tickets.root_cause (20260905100000_helpdesk_foundation.sql:229) เป็น text อิสระ
-- ช่างพิมพ์อะไรก็ได้ ผลคือสาเหตุเดียวกันถูกบันทึกคนละสำนวนนับสิบแบบ ("สายหลุด", "สาย LAN หลุด",
-- "หลุดที่ port") จึงนับไม่ได้ว่าปัญหาใดเกิดบ่อยที่สุด และเลือกไม่ได้ว่าควรเขียน KB เรื่องไหนก่อน
--
-- แก้ด้วยการ "เพิ่มรหัส" ไม่ใช่ "แทนที่ข้อความ" — root_cause เดิมยังอยู่ครบและยังกรอกได้อิสระ
-- เพราะรายละเอียดเฉพาะหน้างานมีค่าเกินกว่าจะบีบให้เหลือแค่รหัส ที่ต้องการคือชั้นจัดกลุ่มเพิ่มขึ้นมา
-- ข้อมูลที่ช่างเคยพิมพ์ไว้แล้วจึงไม่ถูกแตะต้องเลย
-- ============================================================================

create table public.ticket_cause_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,31}$'),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  description text check (description is null or char_length(description) <= 500),
  -- null = ใช้ได้ทุกหมวดหมู่งาน (เช่น "ผู้ใช้ใช้งานไม่ถูกวิธี" ซึ่งเกิดได้กับทุกเรื่อง)
  category_id uuid references public.ticket_categories(id) on delete set null,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

comment on table public.ticket_cause_codes is
  'รหัสสาเหตุมาตรฐานสำหรับจัดกลุ่มการปิดงาน — ใช้คู่กับ tickets.root_cause ที่เป็นข้อความอิสระ';
comment on column public.ticket_cause_codes.category_id is
  'จำกัดให้เลือกได้เฉพาะงานในหมวดนี้ — null = ใช้ได้ทุกหมวด';

-- หน้าปิดงานหน้างานโหลดรายการสาเหตุตามหมวดของใบงานนั้น และตัดตัวที่ปิดใช้แล้วออก
create index ticket_cause_codes_active_category_idx
  on public.ticket_cause_codes (is_active, category_id, sort_order);

create trigger trg_ticket_cause_codes_set_updated_at
  before update on public.ticket_cause_codes
  for each row execute function public.set_updated_at();

alter table public.ticket_cause_codes enable row level security;

-- ทุกคนที่ล็อกอินต้องอ่านได้ ไม่งั้นชื่อสาเหตุบนใบงานจะแสดงเป็นรหัสเปล่า ๆ ให้ผู้แจ้งเห็น
create policy ticket_cause_codes_select_all_authenticated on public.ticket_cause_codes
  for select to authenticated using (true);

create policy ticket_cause_codes_write_with_permission on public.ticket_cause_codes
  for all to authenticated
  using (public.has_permission('cause_code.manage'))
  with check (public.has_permission('cause_code.manage'));

-- ----------------------------------------------------------------------------
-- ผูกรหัสสาเหตุกับใบงาน
--
-- on delete set null ไม่ใช่ restrict เพราะการเลิกใช้รหัสสาเหตุไม่ควรทำให้ลบไม่ได้หรือทำให้
-- ใบงานเก่าหายไป ถ้ารหัสถูกลบ ใบงานยังเหลือ root_cause ที่ช่างพิมพ์ไว้เป็นหลักฐานเสมอ
-- (ทางที่ควรใช้จริงคือ is_active = false ไม่ใช่ลบทิ้ง)
-- ----------------------------------------------------------------------------
alter table public.tickets
  add column cause_code_id uuid references public.ticket_cause_codes(id) on delete set null;

comment on column public.tickets.cause_code_id is
  'รหัสสาเหตุที่เลือกตอนปิดงาน — ใช้จัดกลุ่มสถิติ ส่วนรายละเอียดอยู่ใน root_cause';

create index tickets_cause_code_id_idx on public.tickets (cause_code_id)
  where cause_code_id is not null;

-- ----------------------------------------------------------------------------
-- ที่มาของบทความฐานความรู้
--
-- ไม่ต้องเพิ่มคอลัมน์ที่นี่ — knowledge_articles.source_ticket_id พร้อม index มีอยู่แล้วตั้งแต่
-- 20260905100000_helpdesk_foundation.sql:288 แต่ยังไม่เคยมีโค้ดฝั่งไหนเขียนค่าลงไป
-- ปุ่ม "สร้าง KB จากใบงานนี้" จะเป็นตัวแรกที่ใช้จริง
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- สิทธิ์
--
-- อ่านไม่ต้องมี permission แยก เพราะ policy select เปิดให้ทุก authenticated อยู่แล้ว
-- (ชื่อสาเหตุต้องแสดงบนใบงานที่ผู้แจ้งเปิดดูได้)
-- ----------------------------------------------------------------------------
insert into public.permissions (key, module_key, action, description, status)
values
  ('cause_code.manage', 'cause_code', 'manage', 'เพิ่ม แก้ไข และปิดใช้รหัสสาเหตุการปิดงาน', 'active')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_id, effect)
select r.id, p.id, 'allow'
from public.roles r
join public.permissions p on p.key = 'cause_code.manage'
  and r.key in ('super_admin', 'it_admin')
on conflict (role_id, permission_id) do nothing;
