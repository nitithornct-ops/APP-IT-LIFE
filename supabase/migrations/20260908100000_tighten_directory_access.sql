-- ============================================================================
-- ปิดช่องรั่วข้อมูลบุคคล (พบจาก Pre-production QA/Security audit 2026-08-13)
--
-- ก่อนหน้านี้ทั้ง employees และ profiles เปิดให้ "ทุกคนที่ login แล้ว" อ่านได้ทั้งแถวและทุกคอลัมน์
-- (`for select to authenticated using (true)`) ผลจากการทดสอบจริงคือบัญชีที่ไม่มี role และไม่มี
-- permission ใดเลย ดึงทะเบียนพนักงานทั้งองค์กรได้ครบทุกฟิลด์ รวม email, username_ad, upn และ notes
-- ทั้งผ่าน API และผ่าน PostgREST ตรง (RLS คือขอบเขตจริง ไม่ใช่ชั้น API)
--
-- แนวทางแก้ยึดหลัก "แยกข้อมูล directory ออกจากข้อมูลทะเบียน":
--   * ทะเบียนพนักงานเต็ม  -> ต้องมี employee.manage เท่านั้น
--   * รายชื่อสำหรับ dropdown -> ผ่าน API /employees/options ที่ตรวจสิทธิ์แล้วใช้ service role
--   * profiles ยังเป็น directory ภายในองค์กร (ชื่อ + อีเมลที่ทำงาน) ตามการตัดสินใจเดิมใน
--     20260812100000_access_requests.sql เพราะ Ticket/Service Request/Workflow ต้อง join ชื่อผู้ยื่น
--     แต่ตัด `phone` และ `avatar_url` ออกจากสิทธิ์อ่านของ authenticated เพราะเป็นข้อมูลส่วนบุคคล
--     ที่ไม่มีโมดูลใดต้องใช้ข้ามผู้ใช้ — เจ้าของแถวยังอ่านของตัวเองได้ผ่าน public.my_profile()
-- ============================================================================

-- ---------------------------------------------------------------------------
-- employees — ทะเบียนพนักงาน ไม่ใช่ข้อมูล directory
-- ---------------------------------------------------------------------------
drop policy if exists employees_select_all_authenticated on public.employees;
drop policy if exists employees_select_with_permission on public.employees;

create policy employees_select_with_permission on public.employees
  for select to authenticated
  using (public.has_permission('employee.manage'));

comment on policy employees_select_with_permission on public.employees is
  'ทะเบียนพนักงานมี PII (email, upn, username_ad, notes) จึงจำกัดที่ employee.manage — '
  'โมดูลอื่นที่ต้องการรายชื่อไปทำ dropdown ให้เรียก GET /api/v1/employees/options ซึ่งตรวจสิทธิ์'
  'แล้วคืนเฉพาะ id/รหัส/ชื่อ/หน่วยงาน';

-- ---------------------------------------------------------------------------
-- profiles — จำกัดคอลัมน์ที่ผู้ใช้ทั่วไปอ่านข้ามคนได้
-- RLS จำกัดได้แค่ระดับแถว การจำกัดระดับคอลัมน์ต้องใช้ GRANT
-- ---------------------------------------------------------------------------
revoke select on public.profiles from authenticated;

grant select (
  id, employee_code, full_name, email,
  department_id, position_id, supervisor_id, status,
  created_at, updated_at, created_by, updated_by
) on public.profiles to authenticated;

comment on column public.profiles.phone is
  'ข้อมูลส่วนบุคคล — ไม่อยู่ใน GRANT ของ authenticated อ่านของตนเองผ่าน public.my_profile() '
  'และอ่านของผู้อื่นได้เฉพาะ Backend ที่ตรวจ user.manage แล้วเท่านั้น';

-- โปรไฟล์ของตนเองต้องอ่านได้ครบทุกฟิลด์ (หน้าโปรไฟล์ต้องแสดงเบอร์โทรของเจ้าของบัญชี)
-- SECURITY DEFINER จึงข้าม GRANT ระดับคอลัมน์ได้ แต่ล็อกไว้ที่ auth.uid() เท่านั้น
create or replace function public.my_profile()
returns table (
  id uuid,
  employee_code text,
  full_name text,
  email text,
  phone text,
  department_id uuid,
  position_id uuid,
  supervisor_id uuid,
  status text,
  avatar_url text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.employee_code, p.full_name, p.email, p.phone,
         p.department_id, p.position_id, p.supervisor_id, p.status, p.avatar_url,
         p.created_at, p.updated_at
  from public.profiles p
  where p.id = auth.uid();
$$;

revoke all on function public.my_profile() from public, anon;
grant execute on function public.my_profile() to authenticated;
