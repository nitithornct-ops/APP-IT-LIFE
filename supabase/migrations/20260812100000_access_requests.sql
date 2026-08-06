-- ============================================================================
-- Phase 6 Module 6: คำขอสิทธิ์ระบบ (Access Request) — เส้นทางผู้ใช้ที่ login แล้วเท่านั้น
-- สืบทอดจาก AccessRequests/UserAccessRegistry เดิม (Module_AccessControl.gs)
-- Workflow: ผู้ใช้ยื่นคำขอ → หัวหน้างานอนุมัติ → IT ดำเนินการ → บันทึกสิทธิ์ + ตั้งรอบทบทวน
--
-- ขอบเขตที่ตัดออกจาก Module นี้ (จะทำในภายหลังเมื่อ dependency พร้อม):
-- - SourceServiceRequestID/WorkflowInstanceID — Integration Outbox ยังไม่ได้ออกแบบ (เหมือน Module 5)
-- - ผู้ยื่นคำขอไม่มีปุ่ม "ยกเลิกคำขอ" ของตนเอง — ระบบเดิมก็ไม่มีความสามารถนี้เช่นกัน (ไม่มีฟังก์ชัน
--   cancel ใน Module_AccessControl.gs) จึงคงพฤติกรรมเดิมไว้ตรงๆ ไม่ใช่การตัดขอบเขต
--
-- Design note: การอนุมัติใช้ profiles.supervisor_id (สร้างไว้ตั้งแต่ Phase 2) เป็นเส้นทางหลัก —
-- ผู้ยื่นคำขอต้องมีการกำหนดหัวหน้างานไว้ล่วงหน้าในทะเบียนผู้ใช้ก่อนจึงจะยื่นคำขอได้ (เหมือนระบบเดิม
-- ที่ต้องมี Users.Supervisor ก่อน) — Module นี้เพิ่มหน้าจัดการ "หัวหน้างาน" ใน UsersPage (Phase 3)
-- ที่ยังไม่มีมาก่อน เพื่อให้ Workflow นี้ใช้งานได้จริง
-- ============================================================================

-- ----------------------------------------------------------------------------
-- แก้ RLS ของ profiles (Phase 2): เดิมอ่านได้เฉพาะแถวตนเอง หรือมี user.manage เท่านั้น ทำให้ทุก
-- embedded join ไปยัง profiles ของ "อีกฝ่าย" (เช่น requester ของ Ticket ที่ staff ไม่ได้เป็นเจ้าของ,
-- assignee, approver, IT handler) ถูก RLS กรองเป็น null แบบเงียบๆ สำหรับผู้ใช้ที่ไม่มี user.manage —
-- เป็นบั๊กแฝงที่ Ticket (Module 4)/Service Request (Module 5) มีอยู่แล้ว และจะกระทบ Module นี้ด้วย
-- (ผู้อนุมัติ/ไอทีต้องเห็นชื่อผู้ยื่นคำขอ) เปิดให้อ่านได้ทุกคนที่ login แล้ว ตามแนวทางเดียวกับ
-- departments/positions/ticket_categories/approval_groups (ข้อมูลแบบ directory ภายในองค์กรเดียวกัน
-- ความอ่อนไหวต่ำ) — สิทธิ์แก้ไข (update) ยังคงจำกัดเฉพาะเจ้าของแถวหรือผู้มี user.manage เหมือนเดิม
-- ----------------------------------------------------------------------------

drop policy profiles_select_own_or_managed on public.profiles;

create policy profiles_select_all_authenticated on public.profiles
  for select to authenticated using (true);

create table public.access_systems (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint access_systems_name_unique unique (name)
);

create index access_systems_status_idx on public.access_systems (status);

create trigger trg_access_systems_set_updated_at
  before update on public.access_systems
  for each row execute function public.set_updated_at();

create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  system_id uuid not null references public.access_systems(id) on delete restrict,
  access_level text not null check (access_level in ('Standard', 'Admin')),
  reason text not null,
  request_type text not null default 'ขอเพิ่มสิทธิ์' check (request_type in ('ขอเพิ่มสิทธิ์', 'เพิกถอนสิทธิ์')),
  -- snapshot ผู้อนุมัติ ณ เวลายื่นคำขอ (จาก profiles.supervisor_id ของผู้ยื่น) — เปลี่ยนหัวหน้างานทีหลัง
  -- ไม่กระทบคำขอที่ยื่นไปแล้ว
  approver_id uuid not null references public.profiles(id) on delete restrict,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  approved boolean,
  approval_comment text,
  it_handler_id uuid references public.profiles(id) on delete set null,
  it_action_at timestamptz,
  it_success boolean,
  it_comment text,
  status text not null default 'รออนุมัติจากหัวหน้างาน' check (status in (
    'รออนุมัติจากหัวหน้างาน', 'รอส่วนงานไอทีดำเนินการ', 'เสร็จสิ้น', 'ปฏิเสธ'
  )),
  review_due timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

create index access_requests_requester_id_idx on public.access_requests (requester_id);
create index access_requests_approver_id_idx on public.access_requests (approver_id);
create index access_requests_status_idx on public.access_requests (status);
create index access_requests_system_id_idx on public.access_requests (system_id);

create trigger trg_access_requests_set_updated_at
  before update on public.access_requests
  for each row execute function public.set_updated_at();

create table public.user_access_registry (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  system_id uuid not null references public.access_systems(id) on delete restrict,
  access_level text not null check (access_level in ('Standard', 'Admin')),
  granted_by uuid references public.profiles(id) on delete set null,
  grant_date timestamptz not null default now(),
  last_review_date timestamptz,
  next_review_due timestamptz,
  status text not null default 'active' check (status in ('active', 'revoked', 'suspended')),
  source_request_id uuid references public.access_requests(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

create index user_access_registry_user_id_idx on public.user_access_registry (user_id);
create index user_access_registry_system_id_idx on public.user_access_registry (system_id);
create index user_access_registry_status_idx on public.user_access_registry (status);

create trigger trg_user_access_registry_set_updated_at
  before update on public.user_access_registry
  for each row execute function public.set_updated_at();

alter table public.access_systems enable row level security;
alter table public.access_requests enable row level security;
alter table public.user_access_registry enable row level security;

-- ----------------------------------------------------------------------------
-- RLS Policies — access_systems (Master Data, แนวทางเดียวกับ ticket_categories/asset_categories)
-- ----------------------------------------------------------------------------

create policy access_systems_select_all_authenticated on public.access_systems
  for select to authenticated using (true);

create policy access_systems_write_with_permission on public.access_systems
  for all to authenticated
  using (public.has_permission('access_system.manage'))
  with check (public.has_permission('access_system.manage'));

-- ----------------------------------------------------------------------------
-- RLS Policies — access_requests
-- ----------------------------------------------------------------------------

create policy access_requests_select_participant_or_staff on public.access_requests
  for select to authenticated
  using (
    requester_id = auth.uid()
    or approver_id = auth.uid()
    or public.has_permission('access_request.view')
    or public.has_permission('access_request.approve')
    or public.has_permission('access_request.process')
  );

create policy access_requests_insert_own_with_permission on public.access_requests
  for insert to authenticated
  with check (requester_id = auth.uid() and public.has_permission('access_request.create'));

-- ผู้ยื่นคำขอไม่มีสิทธิ์แก้ไขคำขอของตนเองหลังยื่นแล้ว (ระบบเดิมก็ไม่มีปุ่มยกเลิก/แก้ไขให้ผู้ยื่น) —
-- แก้ไขได้เฉพาะผู้อนุมัติที่ถูก route มา (หรือมี access_request.approve เป็นสิทธิ์เสริม) และเจ้าหน้าที่
-- ไอทีที่มี access_request.process — Backend จำกัดคอลัมน์ที่แก้ได้จริงตาม action (แนวทางเดียวกับ
-- tickets/service_requests)
create policy access_requests_update_approver_or_it on public.access_requests
  for update to authenticated
  using (
    approver_id = auth.uid()
    or public.has_permission('access_request.approve')
    or public.has_permission('access_request.process')
  )
  with check (
    approver_id = auth.uid()
    or public.has_permission('access_request.approve')
    or public.has_permission('access_request.process')
  );

-- ----------------------------------------------------------------------------
-- RLS Policies — user_access_registry
-- ----------------------------------------------------------------------------

create policy user_access_registry_select_own_or_staff on public.user_access_registry
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.has_permission('access_request.view')
    or public.has_permission('access_registry.manage')
  );

create policy user_access_registry_write_with_permission on public.user_access_registry
  for all to authenticated
  using (public.has_permission('access_registry.manage'))
  with check (public.has_permission('access_registry.manage'));
