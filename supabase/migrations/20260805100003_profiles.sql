-- ============================================================================
-- profiles — ข้อมูลผู้ใช้งานที่ผูกกับบัญชี Supabase Auth (auth.users) แบบ 1:1
-- Legacy: รวมมาจาก Users sheet (บัญชี login) เท่านั้น — Employees (บุคลากรที่อาจไม่มี
-- บัญชี login) จะย้ายเป็นตาราง employees แยกต่างหากตอน Phase 6 (โมดูล Employee)
-- ============================================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  employee_code text,
  full_name text not null,
  email text not null,
  phone text,
  department_id uuid references public.departments(id) on delete set null,
  position_id uuid references public.positions(id) on delete set null,
  supervisor_id uuid references public.profiles(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint profiles_employee_code_unique unique (employee_code)
);

create index profiles_department_id_idx on public.profiles (department_id);
create index profiles_position_id_idx on public.profiles (position_id);
create index profiles_supervisor_id_idx on public.profiles (supervisor_id);
create index profiles_status_idx on public.profiles (status);

create trigger trg_profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

-- สร้าง profiles แถวใหม่อัตโนมัติทุกครั้งที่มีบัญชี Supabase Auth ใหม่ (ผู้ดูแลเป็นผู้เชิญ/สร้าง
-- บัญชีผ่าน Supabase Auth Admin API เท่านั้น — ปิด Public Sign-up ตามสเปกความปลอดภัย)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    'active'
  );
  return new;
end;
$$;

create trigger trg_handle_new_user
  after insert on auth.users
  for each row execute function public.handle_new_user();
