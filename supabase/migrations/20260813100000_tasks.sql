-- ============================================================================
-- Phase 6 Module 7: Task / งานของฉัน (My Work) — สืบทอดจาก PersonalTasks/TaskSubtasks/
-- TaskProgressLogs/TaskLinks เดิม (Module_Task.gs) เพิ่ม Kanban view ใหม่ตามที่ roadmap กำหนด
--
-- ขอบเขตความเป็นส่วนตัว (สืบทอดจากระบบเดิมทุกประการ — ไม่ใช่การตัดขอบเขต):
-- ระบบเดิมกรองทุกการอ่าน/เขียนด้วย OwnerEmail ฝั่ง Server และระบุชัดเจนว่า "ผู้ดูแลระบบก็ไม่เห็นงาน
-- ของผู้ใช้อื่นผ่านโมดูลนี้" จึงไม่มี Permission แบบ staff-bypass เหมือนโมดูลอื่น (Ticket/Service
-- Request/Access Request) — RLS ของทุกตารางในไฟล์นี้จำกัดด้วย owner_id = auth.uid() เท่านั้น ไม่มี
-- เงื่อนไข OR has_permission(...) ใดๆ ทั้งสิ้น มี Permission เดียวคือ task.view สำหรับเปิด/ปิดการเห็น
-- เมนูทั้งโมดู (ทุกคนที่มี task.view จัดการได้เฉพาะข้อมูลของตนเองเท่านั้นอยู่ดี)
--
-- ขอบเขตที่ตัดออกจาก Module นี้ (จะทำในภายหลังเมื่อ dependency พร้อม):
-- - TaskReminders (LINE/Email/Calendar) + trigger รายวัน dailyNotificationCheck_() — ระบบใหม่ยังไม่มี
--   Cloudflare Cron Trigger, ผู้ให้บริการ Email หรือ LINE Channel Secret (R-11 ยังไม่ได้รับค่า) ให้ใช้งาน
--   เลย เก็บ due_date ไว้ในตารางหลักเพื่อให้ UI แสดง "เลยกำหนด/ใกล้ครบกำหนด" ได้ทันที ส่วนการแจ้งเตือน
--   อัตโนมัติจะย้ายมาพร้อมกับ Notification Scheduler แบบ cross-cutting ในภายหลัง (แนวทางเดียวกับที่ SLA
--   แบบเวลาทำการถูกเลื่อนไปเป็น Operations Hardening ใน Module 4)
-- - TaskAttachments — ใช้โครงสร้าง file_attachments กลาง (Phase 4) ผ่าน module='task' ได้ทันทีโดยไม่ต้อง
--   สร้างตารางใหม่ (RLS เดิมของ file_attachments กรองด้วย uploaded_by = auth.uid() อยู่แล้ว ซึ่งตรงกับ
--   owner ของ Task เสมอเพราะเป็นข้อมูลส่วนตัว) — ยังไม่เชื่อมหน้าจอ Upload ในรอบนี้ เพราะทุกโมดูลก่อนหน้า
--   (Ticket/Service Request/Access Request) ก็ยังไม่ได้เชื่อม UI แนบไฟล์เข้ากับ file_attachments เช่นกัน
--   (ช่องว่าง cross-cutting เดียวกัน ไม่ใช่ปัญหาเฉพาะโมดูลนี้)
-- - Calendar view แบบลากวันครบกำหนด (FullCalendar เดิม) — ระบบใหม่ยังไม่มี Calendar library และ
--   roadmap ระบุเฉพาะ "รวม Kanban ใหม่" เป็นสิ่งที่ต้องเพิ่ม ไม่ได้ระบุ Calendar โดยเจาะจง จึงทำ List +
--   Kanban ให้ครบก่อน endpoint set_task_due_date (POST /:id/due-date) ยังคงมีไว้รองรับ Calendar ในอนาคต
--   ผู้ใช้แก้ไขวันครบกำหนดผ่านฟอร์มแก้ไขงาน/แผงรายละเอียดไปก่อน
-- ============================================================================

create table public.personal_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  category text not null default 'งานทั่วไป' check (category in (
    'งานทั่วไป', 'ประชุม', 'ติดตาม', 'เอกสาร', 'โครงการ', 'พัฒนาระบบ', 'ส่วนตัว', 'อื่นๆ'
  )),
  priority text not null default 'ปกติ' check (priority in ('ต่ำ', 'ปกติ', 'สูง', 'เร่งด่วน')),
  status text not null default 'ต้องทำ' check (status in (
    'ต้องทำ', 'กำลังทำ', 'รอข้อมูล', 'รอผู้อื่นดำเนินการ', 'พักไว้ก่อน', 'เสร็จแล้ว', 'ยกเลิก'
  )),
  start_date date,
  due_date date,
  completed_at timestamptz,
  progress smallint not null default 0 check (progress between 0 and 100),
  tags text,
  notes text,
  sort_order bigint not null default 0,
  recurrence text not null default 'ไม่ทำซ้ำ' check (recurrence in (
    'ไม่ทำซ้ำ', 'รายวัน', 'รายสัปดาห์', 'รายเดือน', 'รายไตรมาส', 'รายปี'
  )),
  recurrence_end_date date,
  recurring_parent_id uuid references public.personal_tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

create index personal_tasks_owner_id_idx on public.personal_tasks (owner_id);
create index personal_tasks_status_idx on public.personal_tasks (status);
create index personal_tasks_due_date_idx on public.personal_tasks (due_date);

create trigger trg_personal_tasks_set_updated_at
  before update on public.personal_tasks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- ตารางลูก — owner_id ถูก denormalize ไว้ทุกตาราง (เหมือนระบบเดิมที่ทุกชีตลูกมีคอลัมน์ OwnerEmail
-- ของตัวเอง) เพื่อให้ RLS ตรวจได้ตรงไปตรงมาโดยไม่ต้อง join ทุกครั้ง — Backend (routes/tasks.ts) เป็นผู้
-- ตรวจว่า task_id ที่อ้างถึงเป็นของ owner คนเดียวกันจริงก่อน insert เสมอ (RLS ตรวจคอลัมน์ owner_id ได้
-- แค่ระดับแถว ไม่ใช่ระดับความสัมพันธ์ข้ามตาราง — แนวทางเดียวกับ ticket_worklogs ใน Module 4)
-- ---------------------------------------------------------------------------

create table public.task_subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.personal_tasks(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  status text not null default 'ต้องทำ' check (status in ('ต้องทำ', 'เสร็จแล้ว', 'ยกเลิก')),
  due_date date,
  sort_order bigint not null default 0,
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index task_subtasks_task_id_idx on public.task_subtasks (task_id);
create index task_subtasks_owner_id_idx on public.task_subtasks (owner_id);

create trigger trg_task_subtasks_set_updated_at
  before update on public.task_subtasks
  for each row execute function public.set_updated_at();

create table public.task_progress_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.personal_tasks(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  progress smallint not null check (progress between 0 and 100),
  note text not null,
  logged_at timestamptz not null default now()
);

create index task_progress_logs_task_id_idx on public.task_progress_logs (task_id);
create index task_progress_logs_owner_id_idx on public.task_progress_logs (owner_id);

create table public.task_links (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.personal_tasks(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  label text not null,
  url text not null,
  created_at timestamptz not null default now()
);

create index task_links_task_id_idx on public.task_links (task_id);
create index task_links_owner_id_idx on public.task_links (owner_id);

alter table public.personal_tasks enable row level security;
alter table public.task_subtasks enable row level security;
alter table public.task_progress_logs enable row level security;
alter table public.task_links enable row level security;

-- ----------------------------------------------------------------------------
-- RLS Policies — เจ้าของข้อมูลเท่านั้น ทุกตาราง (personal, ไม่มี staff-bypass ตามที่อธิบายด้านบน)
-- ----------------------------------------------------------------------------

create policy personal_tasks_all_own on public.personal_tasks
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy task_subtasks_all_own on public.task_subtasks
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy task_progress_logs_all_own on public.task_progress_logs
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy task_links_all_own on public.task_links
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
