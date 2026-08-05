-- Trigger function กลาง: อัปเดต updated_at อัตโนมัติทุกครั้งที่มีการ UPDATE แถว
-- ใช้ร่วมกันทุกตารางที่มีคอลัมน์ updated_at (ตามมาตรฐาน created_at/updated_at/created_by/updated_by)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
