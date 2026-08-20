-- ไฟล์แนบต้องถูกสร้าง/ลบผ่าน Worker ที่ตรวจสิทธิ์ของ record เป้าหมายแล้วเท่านั้น
-- ปิดทั้ง metadata และ storage write จาก browser/PostgREST โดยตรง

drop policy if exists file_attachments_insert_own on public.file_attachments;
drop policy if exists file_attachments_delete_own on public.file_attachments;
revoke insert, update, delete on public.file_attachments from authenticated;

drop policy if exists attachments_insert_own on storage.objects;
drop policy if exists attachments_select_own on storage.objects;
drop policy if exists attachments_delete_own on storage.objects;

comment on table public.file_attachments is
  'Metadata ไฟล์แนบ เขียนผ่าน Worker service role หลังตรวจ module/target/permission เท่านั้น';
