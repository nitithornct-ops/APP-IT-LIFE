-- ปิดช่องทางเขียน profiles ตรงจาก browser/PostgREST
-- Frontend ใช้ Supabase โดยตรงเฉพาะ Auth เท่านั้น การแก้ข้อมูลธุรกิจต้องผ่าน Worker API
-- เพื่อให้ validation, permission และ audit ทำงานครบทุกครั้ง

drop policy if exists profiles_update_own_or_managed on public.profiles;
revoke update on public.profiles from authenticated;

-- ผู้ใช้ยังแก้ชื่อ/โทรศัพท์ของตนเองได้ผ่าน RPC แคบ ๆ เท่านั้น ห้ามเปลี่ยน status,
-- department, supervisor หรือข้อมูลสิทธิ์อื่นด้วย anon key โดยตรง
create or replace function public.update_my_profile(
  full_name_input text,
  phone_input text default null
)
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
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  normalized_name text := btrim(full_name_input);
  normalized_phone text := nullif(btrim(coalesce(phone_input, '')), '');
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if normalized_name = '' or char_length(normalized_name) > 200 then
    raise exception using errcode = '22023', message = 'full_name is invalid';
  end if;
  if normalized_phone is not null and (
    char_length(normalized_phone) > 30 or normalized_phone !~ '^[0-9+() -]+$'
  ) then
    raise exception using errcode = '22023', message = 'phone is invalid';
  end if;

  return query
  update public.profiles p
  set full_name = normalized_name,
      phone = normalized_phone,
      updated_by = caller_id
  where p.id = caller_id
    and p.status = 'active'
  returning p.id, p.employee_code, p.full_name, p.email, p.phone,
            p.department_id, p.position_id, p.supervisor_id, p.status, p.avatar_url,
            p.created_at, p.updated_at;

  if not found then
    raise exception using errcode = '42501', message = 'account is inactive or profile is missing';
  end if;
end;
$$;

revoke all on function public.update_my_profile(text,text) from public, anon;
grant execute on function public.update_my_profile(text,text) to authenticated;

comment on function public.update_my_profile(text,text) is
  'ช่องทางเดียวสำหรับผู้ใช้แก้โปรไฟล์ตนเอง จำกัดเฉพาะ full_name/phone และปฏิเสธบัญชี inactive';
