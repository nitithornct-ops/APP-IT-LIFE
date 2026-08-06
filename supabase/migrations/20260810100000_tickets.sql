-- ============================================================================
-- Phase 6 Module 4: Ticket (Help Desk) — เส้นทางผู้ใช้ที่ login แล้วเท่านั้น
-- สืบทอดจาก Tickets/Ticket_Worklogs เดิม (Module_Ticket.gs, Module_TicketExtras.gs)
--
-- ขอบเขตที่ตัดออกจาก Module นี้ (จะทำในภายหลังเมื่อ dependency พร้อม):
-- - หน้าแจ้งซ่อมสาธารณะ (ไม่ login) + LINE/Email OTP — ต้องรอ LINE Channel Secret จากเจ้าของระบบ
--   ก่อน (R-11 ใน risk register) และต้องออกแบบ auth แยกทางสำหรับ public เทียบกับ authenticated
-- - SLA แบบคำนวณ "เวลาทำการ" (business hours) + การหยุด/เดินนาฬิกา SLA ละเอียด (SLAPausedAt/Ms/
--   BusinessMinutes) — migration matrix เดิมจัดกลุ่มนี้อยู่ใน "Operations Hardening" cross-cutting
--   service (พร้อม EmployeeLifecycle) ไม่ใช่ Ticket module พื้นฐาน — Module นี้คำนวณ due date แบบ
--   ชั่วโมงปฏิทินธรรมดาไปก่อน (now() + interval)
-- - AssetID/AssetName (รอ Asset module ลำดับ 8), IncidentID (รอ Incident module ลำดับ 10),
--   OutsourceVendorID (รอ Contract/Vendor module ลำดับ 13) — เก็บเฉพาะข้อมูลอ้างอิงแบบ free text
--   ไปก่อน ไม่ผูก Foreign Key จนกว่าตารางเป้าหมายจะมีอยู่จริง
-- ============================================================================

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  requester_phone text,
  location text,
  category_id uuid references public.ticket_categories(id) on delete set null,
  priority text not null default 'ปานกลาง' check (priority in ('ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต')),
  response_sla_hours numeric,
  resolution_sla_hours numeric,
  response_due_at timestamptz,
  due_at timestamptz,
  description text not null,
  assignee_id uuid references public.profiles(id) on delete set null,
  is_security boolean not null default false,
  status text not null default 'ใหม่' check (status in (
    'ใหม่', 'รับเรื่องแล้ว', 'กำลังดำเนินการ', 'รออะไหล่', 'รอผู้ใช้งาน',
    'ส่งต่อ Outsource', 'เสร็จสิ้น', 'ปิดงาน', 'ยกเลิก', 'ยกระดับเป็น Incident'
  )),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  resolution text,
  closed_at timestamptz,
  rating smallint check (rating between 1 and 5),
  feedback text,
  feedback_at timestamptz,
  outsource_name text,
  outsource_issue_no text,
  outsource_sent_at timestamptz,
  notes text,
  reopen_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

create index tickets_requester_id_idx on public.tickets (requester_id);
create index tickets_assignee_id_idx on public.tickets (assignee_id);
create index tickets_status_idx on public.tickets (status);
create index tickets_category_id_idx on public.tickets (category_id);

create trigger trg_tickets_set_updated_at
  before update on public.tickets
  for each row execute function public.set_updated_at();

create table public.ticket_worklogs (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  action text not null,
  detail text,
  status_from text,
  status_to text,
  minutes_spent numeric,
  is_public boolean not null default true,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index ticket_worklogs_ticket_id_idx on public.ticket_worklogs (ticket_id);

alter table public.tickets enable row level security;
alter table public.ticket_worklogs enable row level security;

-- ----------------------------------------------------------------------------
-- RLS Policies — tickets
-- ----------------------------------------------------------------------------

create policy tickets_select_participant_or_staff on public.tickets
  for select to authenticated
  using (
    requester_id = auth.uid()
    or assignee_id = auth.uid()
    or public.has_permission('ticket.view')
  );

create policy tickets_insert_own_with_permission on public.tickets
  for insert to authenticated
  with check (requester_id = auth.uid() and public.has_permission('ticket.create'));

-- แถวของตนเอง (สำหรับให้คะแนนหลังปิดงาน) หรือมีสิทธิ์ ticket.update (ดำเนินงาน) — Backend
-- (Cloudflare Workers) เป็นผู้จำกัดว่า requester แก้ได้เฉพาะคอลัมน์ rating/feedback/feedback_at
-- เท่านั้น เพราะ RLS ตรวจได้แค่ระดับแถว ไม่ใช่ระดับคอลัมน์ (แนวทางเดียวกับ profiles ใน Phase 2)
create policy tickets_update_participant_or_staff on public.tickets
  for update to authenticated
  using (requester_id = auth.uid() or public.has_permission('ticket.update'))
  with check (requester_id = auth.uid() or public.has_permission('ticket.update'));

-- ----------------------------------------------------------------------------
-- RLS Policies — ticket_worklogs (immutable log ต่อ Ticket)
-- ----------------------------------------------------------------------------

create policy ticket_worklogs_select_participant_or_staff on public.ticket_worklogs
  for select to authenticated
  using (
    public.has_permission('ticket.view')
    or (
      is_public
      and exists (
        select 1 from public.tickets t
        where t.id = ticket_worklogs.ticket_id and t.requester_id = auth.uid()
      )
    )
  );

create policy ticket_worklogs_insert_with_permission on public.ticket_worklogs
  for insert to authenticated
  with check (public.has_permission('ticket.update'));

-- ----------------------------------------------------------------------------
-- ขยาย RLS ของ file_attachments (Phase 4) ให้ผู้เกี่ยวข้องกับ Ticket มองเห็นไฟล์แนบของ Ticket
-- นั้นได้ ไม่ใช่แค่ผู้ที่อัปโหลดเอง (ผู้แจ้ง/ผู้รับผิดชอบ/เจ้าหน้าที่ที่มี ticket.view) — Policy เดิม
-- (file_attachments_select_own) ยังคงอยู่ Postgres จะรวมเงื่อนไขด้วย OR ให้อัตโนมัติ
-- ----------------------------------------------------------------------------

create policy file_attachments_select_ticket_participant on public.file_attachments
  for select to authenticated
  using (
    module = 'ticket'
    and target_table = 'tickets'
    and exists (
      select 1 from public.tickets t
      where t.id::text = file_attachments.target_id
        and (t.requester_id = auth.uid() or t.assignee_id = auth.uid() or public.has_permission('ticket.view'))
    )
  );
