-- ============================================================================
-- บัญชี Username/Password ที่ไม่มีอีเมลจริง — ผู้ดูแลสร้างให้พนักงานที่ไม่มีอีเมลองค์กรได้โดยตรง
--
-- ยังใช้ Supabase Auth เหมือนเดิมทุกประการ ไม่แยกระบบ login ใหม่ เพราะ RLS ทุก policy ในระบบยืนอยู่บน
-- auth.uid() ถ้าสร้างระบบ login ของตัวเองขึ้นมาคู่ขนาน บัญชีเหล่านั้นจะใช้ roles/permissions ที่มีอยู่ไม่ได้เลย
-- แต่ Supabase Auth รับตัวระบุได้แค่ email/phone จึงเติม auth.users.email ด้วยอีเมลที่ส่งไม่ถึงจริง
-- รูปแบบ <username>@no-email.invalid (.invalid เป็น TLD สงวนตาม RFC 2606 การันตีว่าไม่ชนโดเมนของใคร)
-- ผู้ใช้ไม่เคยเห็นและไม่เคยพิมพ์ค่านี้ — ตัวระบุที่ใช้ login จริงคือ profiles.username
--
-- DDL ของไฟล์นี้เป็น additive-only: ADD COLUMN / ADD CONSTRAINT / CREATE INDEX / CREATE FUNCTION
-- ไม่มีคำสั่งใดลบหรือแก้ข้อมูลของแถวเดิม (โปรเจกต์นี้ไม่มี restore point อยู่จริง ดู docs/rollback.md)
--
-- ข้อยกเว้นเดียวคือ drop function public.my_profile() ก่อนสร้างใหม่ ซึ่ง "จำเป็น" ไม่ใช่ทางเลือก:
-- PostgreSQL ไม่ยอมให้ CREATE OR REPLACE FUNCTION เปลี่ยนรายการคอลัมน์ของ RETURNS TABLE
-- (ERROR: cannot change return type of existing function) ถ้าแก้กลับไปเป็น CREATE OR REPLACE
-- migration นี้จะล้มทันทีตอน supabase db push — ฟังก์ชันไม่ใช่ข้อมูล การ drop จึงไม่ทำให้ข้อมูลใดหาย
-- แต่ต้อง grant execute ใหม่หลัง create เสมอ เพราะฟังก์ชันที่สร้างใหม่เป็น object ใหม่ที่ไม่มีสิทธิ์ติดมา
-- ============================================================================

alter table public.profiles add column if not exists username text;

-- ตัวพิมพ์เล็กล้วนโดยบังคับที่ constraint (Backend lowercase ให้ก่อนแล้วด้วย Zod .toLowerCase())
-- เพื่อให้ "สมชาย" กับ "SOMCHAI" เป็นคนละชื่อไม่ได้ และกันอักขระที่ทำให้ระบุตัวตนกำกวม เช่น ช่องว่าง
alter table public.profiles
  drop constraint if exists profiles_username_format;
alter table public.profiles
  add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9._-]{3,32}$');

-- unique แบบ case-insensitive และเฉพาะแถวที่มี username (บัญชีอีเมลเดิมทั้งหมดเป็น null จึงไม่ชนกันเอง)
-- ใช้ lower() index แทนการเปิด extension citext เพราะโปรเจกต์นี้ตั้งใจไม่มี extension เพิ่มเลย
-- (ดู 20260805100000_extensions.sql) — index นี้คือหลักประกันว่า username ซ้ำไม่ได้แม้มีสองคำขอพร้อมกัน
create unique index if not exists profiles_username_unique_idx
  on public.profiles (lower(username))
  where username is not null;

comment on column public.profiles.username is
  'ชื่อผู้ใช้สำหรับบัญชีที่ login ด้วย username/password โดยไม่มีอีเมลจริง — null สำหรับบัญชีที่เชิญด้วยอีเมลตามปกติ '
  'จัดชั้นความลับเท่ากับ phone: ไม่อยู่ใน GRANT ของ authenticated จึงอ่านข้ามผู้ใช้ไม่ได้ '
  'เจ้าของอ่านของตนเองผ่าน public.my_profile() ส่วนผู้ดูแลอ่านผ่าน Backend ที่ตรวจ user.manage แล้วใช้ service role';

-- ตั้งใจไม่ grant select (username) ให้ authenticated (ต่างจาก email/full_name ที่เป็นข้อมูล directory)
-- ยึดหลักเดียวกับ phone ใน 20260908100000_tighten_directory_access.sql — ไม่มีโมดูลใดต้องค้นหา username
-- ของเพื่อนร่วมงาน การเพิ่มคอลัมน์เฉย ๆ ไม่ทำให้ authenticated เห็น เพราะ GRANT เดิมระบุรายชื่อคอลัมน์ไว้แล้ว

-- ----------------------------------------------------------------------------
-- my_profile() — เพิ่ม username เพื่อให้หน้าโปรไฟล์ของตนเองแสดง "ชื่อผู้ใช้เข้าสู่ระบบ" แทนอีเมลปลอมได้
-- (update_my_profile() ไม่ต้องแก้: ProfilePage ทิ้ง response ของ PATCH แล้ว invalidate ['me'] ไปดึงใหม่อยู่แล้ว
--  และตั้งใจไม่ให้ผู้ใช้แก้ username ของตนเอง เพราะเป็นตัวระบุสำหรับ login เช่นเดียวกับ status/department_id)
--
-- body ยกมาจากนิยามล่าสุดใน 20260918100000_user_onboarding_state.sql ทั้งหมด เพิ่มแค่ username
-- คอลัมน์ onboarding_* ต้องคงไว้ ไม่งั้นการ์ด "เริ่มใช้ครั้งแรก" จะเด้งซ้ำทุกครั้งที่เปิดหน้าแรก
-- ----------------------------------------------------------------------------
drop function if exists public.my_profile();

create function public.my_profile()
returns table (
  id uuid,
  employee_code text,
  full_name text,
  email text,
  username text,
  phone text,
  department_id uuid,
  position_id uuid,
  supervisor_id uuid,
  status text,
  avatar_url text,
  created_at timestamptz,
  updated_at timestamptz,
  onboarding_completed_at timestamptz,
  onboarding_dismissed_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.employee_code, p.full_name, p.email, p.username, p.phone,
         p.department_id, p.position_id, p.supervisor_id, p.status, p.avatar_url,
         p.created_at, p.updated_at,
         p.onboarding_completed_at, p.onboarding_dismissed_at
  from public.profiles p
  where p.id = auth.uid();
$$;

revoke all on function public.my_profile() from public, anon;
grant execute on function public.my_profile() to authenticated;

-- ----------------------------------------------------------------------------
-- handle_new_user() — รับ username มาพร้อมกำเนิดบัญชี
--
-- เขียน username ในทรานแซกชันเดียวกับที่แถว profiles เกิด ไม่ใช่ UPDATE ตามหลัง เพราะถ้า UPDATE นั้นล้ม
-- จะได้บัญชีที่ login ไม่ได้เลย (ไม่มี username ให้ค้น และอีเมลก็เป็นค่าปลอมที่ผู้ใช้ไม่รู้) และการเขียนพร้อมกัน
-- ยังทำให้ unique index ปฏิเสธ username ซ้ำได้ตั้งแต่ต้น -> auth.admin.createUser() ล้มทั้งก้อน
-- ไม่เหลือบัญชี auth.users กำพร้าไว้ ปลอดภัยกว่าการเช็คก่อนเขียนซึ่งมีช่องว่าง TOCTOU
--
-- null-safe: บัญชีที่เชิญด้วยอีเมลไม่ได้ส่ง key 'username' มาใน metadata จึงได้ null เหมือนเดิมทุกประการ
--
-- ใช้ create or replace (ไม่ใช่ drop+create) โดยตั้งใจ เพราะการ replace รักษาสิทธิ์เดิมของฟังก์ชันไว้ —
-- 20261005100000_security_followup.sql revoke execute ของ public/anon/authenticated ไปแล้ว และ
-- ต้องคง search_path เป็น public, pg_temp ตามที่ migration นั้น alter ไว้ ไม่ใช่ public เฉย ๆ แบบนิยามแรก
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name, username, status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    nullif(btrim(lower(new.raw_user_meta_data ->> 'username')), ''),
    'active'
  );
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- resolve_login_email() — แปลง "สิ่งที่ผู้ใช้พิมพ์ในช่อง login" เป็นอีเมลที่ Supabase Auth รู้จัก
--
-- Supabase Auth รับได้แค่ email/phone หน้า Login จึงต้องถามค่านี้ก่อนเรียก signInWithPassword
-- ทำเป็นฟังก์ชันในฐานข้อมูลแทนการต่อสตริงตัวกรอง PostgREST ที่ฝั่ง Worker โดยตั้งใจ เพราะการเทียบด้วย
-- .or()/.ilike() กับค่าที่ผู้ใช้พิมพ์เองเปิดช่องให้ส่ง % หรือ , เข้ามาเป็นไวลด์การ์ด/ไวยากรณ์ตัวกรองได้
-- (โปรเจกต์นี้เคยเจอบั๊กชนิดนี้มาแล้ว ดู comment หัวไฟล์ apps/api/src/utils/search.ts) ซึ่งกรณีนี้จะร้ายกว่าเดิม
-- เพราะผลลัพธ์คือ "อีเมลจริงของผู้ใช้คนอื่น" ที่หลุดออกไปให้คนที่ยังไม่ได้ login การเทียบด้วย = แบบ
-- parameterized ตรงนี้ปิดช่องนั้นทั้งชนิด
--
-- ไม่เจอให้คืน null แล้วให้ Worker แทนด้วยอีเมลปลอมคงที่ เพื่อให้ผลลัพธ์ที่ผู้เรียกเห็นเหมือนกันทุกกรณี
-- (กันการไล่เดาว่าชื่อผู้ใช้ใดมีอยู่จริง) — ห้าม grant ให้ anon/authenticated เด็ดขาด ให้ Worker เรียกเท่านั้น
-- ----------------------------------------------------------------------------
create or replace function public.resolve_login_email(identifier_input text)
returns text
language sql
security definer
stable
-- search_path ว่างตามแนวทางล่าสุดของโปรเจกต์ (register_vendor_portal_login_failure ใน
-- 20261005100000_security_followup.sql) เพราะ body อ้างชื่อตารางแบบเต็มอยู่แล้ว
set search_path = ''
as $$
  select p.email
  from public.profiles p
  where lower(p.username) = lower(btrim(identifier_input))
     or lower(p.email) = lower(btrim(identifier_input))
  limit 1;
$$;

revoke all on function public.resolve_login_email(text) from public, anon, authenticated;
grant execute on function public.resolve_login_email(text) to service_role;

comment on function public.resolve_login_email(text) is
  'แปลง username หรือ email ที่ผู้ใช้พิมพ์ ให้เป็นอีเมลที่ Supabase Auth ใช้ login — เรียกได้เฉพาะ service role '
  '(Cloudflare Worker) เท่านั้น ไม่เจอคืน null และผู้เรียกต้องแทนด้วยค่าคงที่เสมอเพื่อไม่ให้แยกได้ว่าบัญชีมีจริงหรือไม่';
