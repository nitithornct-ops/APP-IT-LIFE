-- ============================================================================
-- File Upload / Signed URL — Bucket ส่วนตัว "attachments" ใช้ร่วมกันทุกโมดูลในอนาคต
-- (เรื่องร้องเรียน, Ticket แนบไฟล์ ฯลฯ) โดยแยก path ต่อผู้ใช้: {uploader_id}/{uuid}-{filename}
-- Policy อ้างอิงรูปแบบมาตรฐานของ Supabase (storage.foldername) — ผู้ใช้เข้าถึงได้เฉพาะโฟลเดอร์
-- ของตนเอง Backend เป็นผู้ตั้งชื่อ path นี้เสมอ (services/storageService.ts) ไม่รับ path จาก Client ตรงๆ
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 10485760) -- 10 MB
on conflict (id) do nothing;

create policy attachments_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

create policy attachments_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

create policy attachments_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- file_attachments — Metadata ของไฟล์ที่อัปโหลด (แยกจาก storage.objects เพื่อผูกกับ
-- module/target_table/target_id ของระบบเราเองได้ และ query/list ได้ง่ายกว่า)
-- ---------------------------------------------------------------------------
create table public.file_attachments (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  module text not null default 'general',
  target_table text,
  target_id text,
  uploaded_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index file_attachments_uploaded_by_idx on public.file_attachments (uploaded_by);
create index file_attachments_target_idx on public.file_attachments (target_table, target_id);

alter table public.file_attachments enable row level security;

create policy file_attachments_select_own on public.file_attachments
  for select to authenticated
  using (uploaded_by = auth.uid());

create policy file_attachments_insert_own on public.file_attachments
  for insert to authenticated
  with check (uploaded_by = auth.uid());

create policy file_attachments_delete_own on public.file_attachments
  for delete to authenticated
  using (uploaded_by = auth.uid());
