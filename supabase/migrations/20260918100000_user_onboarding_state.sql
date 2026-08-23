-- ============================================================================
-- Onboarding state ต่อผู้ใช้ — design_handoff_it_service_redesign 02-screens.md หัวข้อ
-- "3k สถานะที่มักถูกลืม" การ์ดที่ 5 "เริ่มใช้ครั้งแรก"
--
-- ระบบเดิมไม่มีที่เก็บเลยว่าใครเคยเห็นคำแนะนำเริ่มต้นแล้วหรือยัง ถ้าทำการ์ดนี้โดยไม่มี state
-- มันจะเด้งขึ้นทุกครั้งที่เปิดหน้าแรกตลอดไป ซึ่งแย่กว่าการไม่มีการ์ดนี้เลย
--
-- แยกเป็นสองคอลัมน์แทนธง boolean เดียว เพราะ "ทำครบแล้ว" กับ "กดข้ามไปใช้ค่าเริ่มต้น" เป็นคนละ
-- เรื่องกันเวลาย้อนดูว่าผู้ใช้กลุ่มไหนติดตรงไหน แม้ผลต่อหน้าจอจะเหมือนกันคือไม่แสดงซ้ำ
-- เก็บเป็น timestamptz ไม่ใช่ boolean จะได้รู้ด้วยว่าเกิดขึ้นเมื่อไร โดยไม่ต้องเดาจาก updated_at
-- ============================================================================

alter table public.profiles
  add column onboarding_completed_at timestamptz,
  add column onboarding_dismissed_at timestamptz;

comment on column public.profiles.onboarding_completed_at is
  'เวลาที่ผู้ใช้กดยืนยันว่าดูคำแนะนำเริ่มต้นครบแล้ว (null = ยังไม่เคย)';
comment on column public.profiles.onboarding_dismissed_at is
  'เวลาที่ผู้ใช้กดข้ามไปใช้ค่าเริ่มต้น (null = ยังไม่เคยกดข้าม)';

-- ----------------------------------------------------------------------------
-- my_profile() ต้องคืนสองคอลัมน์นี้ด้วย ไม่งั้นหน้าเว็บไม่มีทางรู้ว่าควรแสดงการ์ดหรือไม่
--
-- ต้อง drop ก่อนสร้างใหม่ เพราะ Postgres เปลี่ยนชนิดค่าที่คืน (OUT parameters) ด้วย
-- create or replace ไม่ได้ ตัว body ยกมาจาก 20260908100000 ทั้งหมด เพิ่มแค่สองคอลัมน์ท้าย
-- ----------------------------------------------------------------------------
drop function if exists public.my_profile();

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
  updated_at timestamptz,
  onboarding_completed_at timestamptz,
  onboarding_dismissed_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.employee_code, p.full_name, p.email, p.phone,
         p.department_id, p.position_id, p.supervisor_id, p.status, p.avatar_url,
         p.created_at, p.updated_at,
         p.onboarding_completed_at, p.onboarding_dismissed_at
  from public.profiles p
  where p.id = auth.uid();
$$;

revoke all on function public.my_profile() from public, anon;
grant execute on function public.my_profile() to authenticated;

-- ----------------------------------------------------------------------------
-- บันทึกว่าผู้ใช้ปิดคำแนะนำเริ่มต้นแล้ว
--
-- ต้องเป็น RPC เพราะ 20260915100000 ตัดสิทธิ์ UPDATE ตาราง profiles ของ authenticated ออกไปแล้ว
-- (กัน PostgREST ถูกใช้ข้าม Worker ไปแก้ status/department ของตนเอง) — แนวทางเดียวกับ
-- update_my_profile() ที่มีอยู่
--
-- ล็อกไว้ที่ auth.uid() เท่านั้น ไม่รับ user id จากผู้เรียก จึงไม่มีทางปิด onboarding ให้คนอื่น
-- เขียนทับได้ (ไม่ใช่ coalesce ค่าเดิม) เพราะการกดซ้ำควรอัปเดตเวลาให้ตรงกับครั้งล่าสุดที่ผู้ใช้ยืนยัน
-- ----------------------------------------------------------------------------
create or replace function public.set_my_onboarding_state(dismissed_input boolean)
returns table (
  onboarding_completed_at timestamptz,
  onboarding_dismissed_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'ONBOARDING_NOT_AUTHENTICATED';
  end if;

  return query
  update public.profiles p
  set onboarding_completed_at = case when dismissed_input then p.onboarding_completed_at else now() end,
      onboarding_dismissed_at = case when dismissed_input then now() else p.onboarding_dismissed_at end,
      updated_by = v_user_id
  where p.id = v_user_id
  returning p.onboarding_completed_at, p.onboarding_dismissed_at;
end;
$$;

revoke all on function public.set_my_onboarding_state(boolean) from public, anon;
grant execute on function public.set_my_onboarding_state(boolean) to authenticated;

comment on function public.set_my_onboarding_state(boolean) is
  'ปิดคำแนะนำเริ่มต้นของผู้ใช้ที่เรียกเอง — true = กดข้าม, false = ดูครบแล้ว';
