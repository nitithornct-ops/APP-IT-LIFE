-- ============================================================================
-- notifications — การแจ้งเตือนภายในระบบ (in-app) สำหรับผู้ใช้แต่ละคน
-- ผู้ใช้อ่านและทำเครื่องหมาย "อ่านแล้ว" ได้เฉพาะการแจ้งเตือนของตนเอง เขียน (สร้าง) ได้ทาง
-- service_role เท่านั้น (ไม่มี insert policy ให้ authenticated) — ป้องกันผู้ใช้ปลอมแปลง
-- การแจ้งเตือนให้ผู้อื่น ตรงกับรูปแบบเดียวกับ audit_logs/login_logs (Phase 2)
-- ============================================================================

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_recipient_id_idx on public.notifications (recipient_id);
create index notifications_recipient_unread_idx on public.notifications (recipient_id) where not is_read;
create index notifications_created_at_idx on public.notifications (created_at desc);

alter table public.notifications enable row level security;

create policy notifications_select_own on public.notifications
  for select to authenticated
  using (recipient_id = auth.uid());

-- อนุญาตแก้ไขได้เฉพาะทำเครื่องหมายอ่าน/ยังไม่อ่านของตนเอง (with check กันการแก้ไขคอลัมน์อื่นทางอ้อม
-- ไม่ได้ในระดับ RLS โดยตรง — ฝั่ง Backend เท่านั้นที่จะเปิด endpoint ให้แก้ is_read/read_at เท่านั้น)
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- ไม่มี insert/delete policy ให้ authenticated โดยตั้งใจ — สร้างผ่าน service_role เท่านั้น
-- (services/notificationService.ts) ผู้ใช้ลบการแจ้งเตือนของตัวเองไม่ได้ในเวอร์ชันนี้ (เก็บประวัติไว้)
