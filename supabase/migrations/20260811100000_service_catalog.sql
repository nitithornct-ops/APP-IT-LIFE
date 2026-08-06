-- ============================================================================
-- Phase 6 Module 5: Service Catalog / คำขอบริการ — เส้นทางผู้ใช้ที่ login แล้วเท่านั้น
-- สืบทอดจาก ServiceCatalog/ServiceRequests/ServiceRequestTasks/ServiceRequestHistory เดิม
-- (Module_ServiceCatalog.gs)
--
-- ขอบเขตที่ตัดออกจาก Module นี้ (จะทำในภายหลังเมื่อ dependency พร้อม):
-- - Workflow Engine เต็มรูปแบบ (WorkflowDefinitionID/WorkflowInstanceID/WorkflowJSON แบบ multi-step
--   routing) — รอโมดูล Workflow Approval ลำดับ 17 ของเดิมยังไม่มีอยู่จริง Module นี้ใช้การอนุมัติ
--   แบบ single-step ผ่าน "กลุ่มอนุมัติ" (approval_groups จาก Module 2) แทน ซึ่งยืดหยุ่นกว่าระบบเดิมที่
--   ผูกกับอีเมลผู้อนุมัติคนเดียวตายตัว (ดูคอลัมน์ approval_group_id ด้านล่าง)
-- - Approval Mode "หัวหน้างาน" (auto-resolve จาก Users.Supervisor เดิม) — ตาราง employees/profiles
--   ของระบบใหม่ยังไม่มีฟิลด์สายบังคับบัญชา (manager/supervisor hierarchy) รองรับแค่ 'ไม่ต้องอนุมัติ'
--   และ 'กลุ่มอนุมัติ' (ระบุกลุ่มที่กำหนดไว้ล่วงหน้า) ไปก่อน
-- - Integration Outbox / Auto-create Target (FulfillmentTarget/AutoCreateTarget/TargetMappingJSON,
--   Related AccessRequestID/AssetID/CIID/ChangeID) — โมดูลปลายทาง (Access Request #6, Asset #8,
--   CMDB #9, Change #12) ยังไม่มีอยู่จริง และ Integration Outbox (E12 ใน module_matrix) ยังไม่ได้
--   ออกแบบ ไม่ผูก Foreign Key/Auto-create จนกว่าโมดูลเหล่านั้นจะพร้อม
-- - Attachment Registry เต็มรูปแบบสำหรับ Checklist Task (EvidenceAttachmentIDsJSON) — เก็บเฉพาะ
--   evidence_link แบบ text ไปก่อน (เหมือนฟิลด์ EvidenceLink เดิมที่มีอยู่คู่กับ Attachment IDs)
--   คำขอระดับบน (ServiceRequests) ยังใช้ file_attachments (Phase 4) ผ่าน policy เพิ่มเติมด้านล่างได้
-- - SLA แบบ "เวลาทำการ" (business hours) — คำนวณแบบชั่วโมงปฏิทินธรรมดา (now() + interval) เหมือน
--   Module 4 (Ticket) ไปก่อน (อยู่ในกลุ่ม Operations Hardening ที่จะทำภายหลัง)
--
-- Design note: RLS ของ service_requests อนุญาตแบบกว้างระดับแถว (row-level) ตามแนวทางเดียวกับ
-- tickets (Module 4)/profiles (Phase 2) — Backend (Cloudflare Workers) เป็นผู้บังคับว่าใครแก้ไข
-- คอลัมน์ไหนได้บ้างตาม action จริง เพราะ RLS ตรวจได้แค่ระดับแถว ไม่ใช่ระดับคอลัมน์
-- ============================================================================

create table public.service_catalog (
  id uuid primary key default gen_random_uuid(),
  service_code text not null,
  service_name text not null,
  category text,
  description text,
  eligibility jsonb,
  form_schema jsonb not null default '[]'::jsonb,
  attachment_required boolean not null default false,
  sla_hours numeric not null default 24,
  approval_mode text not null default 'none' check (approval_mode in ('none', 'group')),
  approval_group_id uuid references public.approval_groups(id) on delete set null,
  fulfillment_group_id uuid references public.departments(id) on delete set null,
  checklist jsonb not null default '[]'::jsonb,
  close_mode text not null default 'requester_confirms' check (close_mode in ('requester_confirms', 'it_closes')),
  close_condition text,
  status text not null default 'draft' check (status in ('draft', 'active', 'suspended', 'retired')),
  version integer not null default 1,
  published_at timestamptz,
  owner_id uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint service_catalog_code_unique unique (service_code),
  constraint service_catalog_group_mode_requires_group
    check (approval_mode <> 'group' or approval_group_id is not null)
);

create index service_catalog_status_idx on public.service_catalog (status);

create trigger trg_service_catalog_set_updated_at
  before update on public.service_catalog
  for each row execute function public.set_updated_at();

create table public.service_requests (
  id uuid primary key default gen_random_uuid(),
  catalog_id uuid references public.service_catalog(id) on delete set null,
  catalog_version integer not null default 1,
  service_code text not null,
  service_name text not null,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  requested_for text,
  summary text not null,
  request_details jsonb not null default '{}'::jsonb,
  business_justification text,
  priority text not null default 'ปานกลาง' check (priority in ('ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต')),
  impact text not null default 'ปานกลาง' check (impact in ('ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต')),
  sla_hours numeric,
  due_at timestamptz,
  approval_mode text not null default 'none' check (approval_mode in ('none', 'group')),
  approval_group_id uuid references public.approval_groups(id) on delete set null,
  approval_status text not null default 'not_required'
    check (approval_status in ('not_required', 'pending', 'approved', 'rejected')),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  close_mode text not null default 'requester_confirms' check (close_mode in ('requester_confirms', 'it_closes')),
  assigned_group_id uuid references public.departments(id) on delete set null,
  assignee_id uuid references public.profiles(id) on delete set null,
  status text not null default 'รอมอบหมาย' check (status in (
    'รออนุมัติ', 'รอมอบหมาย', 'กำลังดำเนินการ', 'รอผู้ใช้งาน', 'รอผู้ให้บริการ',
    'รอยืนยันผล', 'ปิดงาน', 'ปฏิเสธ', 'ยกเลิก'
  )),
  checklist_snapshot jsonb not null default '[]'::jsonb,
  fulfillment_notes text,
  completion_evidence text,
  requester_confirmed_at timestamptz,
  requester_confirmation boolean,
  completed_at timestamptz,
  closed_at timestamptz,
  cancel_reason text,
  idempotency_key text,
  source_channel text not null default 'web_internal',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint service_requests_group_mode_requires_group
    check (approval_mode <> 'group' or approval_group_id is not null)
);

create unique index service_requests_requester_idempotency_key_idx
  on public.service_requests (requester_id, idempotency_key)
  where idempotency_key is not null;

create index service_requests_requester_id_idx on public.service_requests (requester_id);
create index service_requests_assignee_id_idx on public.service_requests (assignee_id);
create index service_requests_status_idx on public.service_requests (status);
create index service_requests_catalog_id_idx on public.service_requests (catalog_id);
create index service_requests_approval_group_id_idx on public.service_requests (approval_group_id);

create trigger trg_service_requests_set_updated_at
  before update on public.service_requests
  for each row execute function public.set_updated_at();

create table public.service_request_tasks (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests(id) on delete cascade,
  sequence integer not null default 1,
  task_name text not null,
  task_type text,
  owner_group_id uuid references public.departments(id) on delete set null,
  assignee_id uuid references public.profiles(id) on delete set null,
  is_required boolean not null default true,
  status text not null default 'รอดำเนินการ'
    check (status in ('รอดำเนินการ', 'กำลังดำเนินการ', 'เสร็จสิ้น', 'ข้าม')),
  due_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete set null,
  evidence_link text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

create index service_request_tasks_request_id_idx on public.service_request_tasks (request_id);

create trigger trg_service_request_tasks_set_updated_at
  before update on public.service_request_tasks
  for each row execute function public.set_updated_at();

create table public.service_request_history (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests(id) on delete cascade,
  action text not null,
  status_from text,
  status_to text,
  comment text,
  is_public boolean not null default true,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index service_request_history_request_id_idx on public.service_request_history (request_id);

alter table public.service_catalog enable row level security;
alter table public.service_requests enable row level security;
alter table public.service_request_tasks enable row level security;
alter table public.service_request_history enable row level security;

-- ----------------------------------------------------------------------------
-- RLS Policies — service_catalog (อ่านได้ทุกคนที่ login แล้วเพื่อ browse ก่อนยื่นคำขอ, Backend
-- เป็นผู้กรอง status='active' ให้ผู้ใช้ทั่วไปเห็นเฉพาะบริการที่เปิดใช้งานจริง)
-- ----------------------------------------------------------------------------

create policy service_catalog_select_all_authenticated on public.service_catalog
  for select to authenticated using (true);

create policy service_catalog_write_with_permission on public.service_catalog
  for all to authenticated
  using (public.has_permission('service_catalog.manage'))
  with check (public.has_permission('service_catalog.manage'));

-- ----------------------------------------------------------------------------
-- RLS Policies — service_requests
-- ----------------------------------------------------------------------------

create policy service_requests_select_participant_or_staff on public.service_requests
  for select to authenticated
  using (
    requester_id = auth.uid()
    or assignee_id = auth.uid()
    or public.has_permission('service_request.view')
    or (
      approval_group_id is not null
      and exists (
        select 1 from public.approval_group_members m
        where m.group_id = service_requests.approval_group_id
          and m.user_id = auth.uid() and m.status = 'active'
      )
    )
  );

create policy service_requests_insert_own_with_permission on public.service_requests
  for insert to authenticated
  with check (requester_id = auth.uid() and public.has_permission('service_request.create'));

-- แถวของตนเอง (สำหรับยกเลิก/ยืนยันผล) หรือกลุ่มอนุมัติ (สำหรับอนุมัติ/ปฏิเสธ) หรือมีสิทธิ์จัดการ —
-- Backend จำกัดคอลัมน์ที่แก้ได้จริงตาม action (เหมือนแนวทาง tickets ใน Module 4)
create policy service_requests_update_participant_or_staff on public.service_requests
  for update to authenticated
  using (
    requester_id = auth.uid()
    or public.has_permission('service_request.update')
    or public.has_permission('service_request.assign')
    or public.has_permission('service_request.close')
    or public.has_permission('service_request.approve')
    or (
      approval_group_id is not null
      and exists (
        select 1 from public.approval_group_members m
        where m.group_id = service_requests.approval_group_id
          and m.user_id = auth.uid() and m.status = 'active'
      )
    )
  )
  with check (
    requester_id = auth.uid()
    or public.has_permission('service_request.update')
    or public.has_permission('service_request.assign')
    or public.has_permission('service_request.close')
    or public.has_permission('service_request.approve')
    or (
      approval_group_id is not null
      and exists (
        select 1 from public.approval_group_members m
        where m.group_id = service_requests.approval_group_id
          and m.user_id = auth.uid() and m.status = 'active'
      )
    )
  );

-- ----------------------------------------------------------------------------
-- RLS Policies — service_request_tasks (Checklist ต่อคำขอ ให้เจ้าหน้าที่เป็นผู้ดูแลเท่านั้น
-- แถวแรกสุดถูกสร้างจาก catalog.checklist ตอนยื่นคำขอโดยผู้ขอเอง (ไม่มี service_request.update) —
-- Backend ใช้ Admin client เขียนชุดแรกนี้จุดเดียว บทเรียนเดียวกับ ticket_worklogs ใน Module 4
-- ----------------------------------------------------------------------------

create policy service_request_tasks_select_participant_or_staff on public.service_request_tasks
  for select to authenticated
  using (
    public.has_permission('service_request.view')
    or public.has_permission('service_request.update')
    or assignee_id = auth.uid()
    or exists (
      select 1 from public.service_requests r
      where r.id = service_request_tasks.request_id
        and (r.requester_id = auth.uid() or r.assignee_id = auth.uid())
    )
  );

create policy service_request_tasks_write_with_permission on public.service_request_tasks
  for all to authenticated
  using (public.has_permission('service_request.update'))
  with check (public.has_permission('service_request.update'));

-- ----------------------------------------------------------------------------
-- RLS Policies — service_request_history (immutable log ต่อคำขอ, เขียนได้เฉพาะผู้มีสิทธิ์
-- ดำเนินการจริงในแต่ละ action หรือสมาชิกกลุ่มอนุมัติ — รายการแรกสุด "ยื่นคำขอ" เขียนผ่าน
-- Admin client เหมือน ticket_worklogs)
-- ----------------------------------------------------------------------------

create policy service_request_history_select_participant_or_staff on public.service_request_history
  for select to authenticated
  using (
    public.has_permission('service_request.view')
    or (
      is_public
      and exists (
        select 1 from public.service_requests r
        where r.id = service_request_history.request_id
          and (r.requester_id = auth.uid() or r.assignee_id = auth.uid())
      )
    )
  );

create policy service_request_history_insert_with_permission on public.service_request_history
  for insert to authenticated
  with check (
    public.has_permission('service_request.update')
    or public.has_permission('service_request.assign')
    or public.has_permission('service_request.close')
    or public.has_permission('service_request.approve')
    or exists (
      select 1 from public.service_requests r
      join public.approval_group_members m on m.group_id = r.approval_group_id
      where r.id = service_request_history.request_id
        and m.user_id = auth.uid() and m.status = 'active'
    )
  );

-- ----------------------------------------------------------------------------
-- ขยาย RLS ของ file_attachments (Phase 4) ให้ผู้เกี่ยวข้องกับคำขอบริการมองเห็นไฟล์แนบของคำขอ
-- นั้นได้ ไม่ใช่แค่ผู้ที่อัปโหลดเอง (แนวทางเดียวกับ tickets ใน Module 4)
-- ----------------------------------------------------------------------------

create policy file_attachments_select_service_request_participant on public.file_attachments
  for select to authenticated
  using (
    module = 'service_request'
    and target_table = 'service_requests'
    and exists (
      select 1 from public.service_requests r
      where r.id::text = file_attachments.target_id
        and (
          r.requester_id = auth.uid()
          or r.assignee_id = auth.uid()
          or public.has_permission('service_request.view')
        )
    )
  );
