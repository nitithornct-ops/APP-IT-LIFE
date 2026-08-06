-- ============================================================================
-- Phase 3 — Auth helper functions ที่ Backend เรียกผ่าน Supabase RPC เพื่อประกอบ
-- หน้า Login/Profile และ Permission-aware Menu โดยไม่ต้อง round-trip หลายครั้ง
-- ทั้งสองฟังก์ชันใช้ has_permission()/logic เดียวกับที่ RLS ใช้ (Phase 2) เพื่อไม่ให้
-- Logic สิทธิ์เพี้ยนไปคนละทางระหว่างหน้าที่ตรวจสิทธิ์กับหน้าที่แสดงเมนู
-- ============================================================================

create or replace function public.my_roles()
returns table (role_key text, role_name_th text, role_name_en text)
language sql
security definer
stable
set search_path = public
as $$
  select r.key, r.name_th, r.name_en
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.user_id = auth.uid()
    and r.status = 'active';
$$;

create or replace function public.my_permissions()
returns table (permission_key text)
language sql
security definer
stable
set search_path = public
as $$
  select p.key
  from public.permissions p
  where p.status = 'active'
    and public.has_permission(p.key);
$$;
