-- ============================================================================
-- Phase 6 Module 3: Employee — ทะเบียนพนักงาน (Employees เดิม)
-- เพิ่มจากแผนเดิมเพราะ Asset/Ticket (Phase 6 ลำดับถัดไป) ต้องผูก "เจ้าของ" กับพนักงานจริง
-- ไม่ใช่บัญชี login เท่านั้น — ตามที่ระบุไว้แล้วใน comment ของ 20260805100003_profiles.sql
-- (พนักงานบางคนอาจไม่มีบัญชี Supabase Auth เลยก็ได้ เช่น End User ทั่วไปที่ยังไม่เคย login)
-- Position/Department เดิมเป็น free text — เปลี่ยนเป็น position_id/department_id ตามแนวทางที่วางไว้แล้ว
-- ขอบเขต Module 3 นี้ตัด EmployeeAssignments (ย้ายไปทำพร้อม Asset module ลำดับ 8 เพราะจะซ้ำซ้อนกับ
-- ตาราง assignment ของ Asset) และ EmployeeLifecycle/JML ออก (migration matrix จัดอยู่ใน
-- "Operations Hardening" cross-cutting service ซึ่งเป็นคนละช่วงเวลากับทะเบียนพนักงานพื้นฐาน)
-- ============================================================================

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_code text not null,
  prefix_th text,
  first_name_th text not null,
  last_name_th text not null,
  nickname text,
  prefix_en text,
  first_name_en text,
  last_name_en text,
  department_id uuid references public.departments(id) on delete set null,
  position_id uuid references public.positions(id) on delete set null,
  username_ad text,
  upn text,
  email text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint employees_employee_code_unique unique (employee_code)
);

create index employees_department_id_idx on public.employees (department_id);
create index employees_position_id_idx on public.employees (position_id);
create index employees_status_idx on public.employees (status);

-- Email ไม่บังคับกรอก (ไม่ใช่พนักงานทุกคนมี Mailbox) แต่ถ้ากรอกต้องไม่ซ้ำ — ตรงกับ
-- validateEmployeeUnique_() เดิมที่เช็คซ้ำเฉพาะเมื่อมีค่า
create unique index employees_email_unique_idx on public.employees (lower(email))
  where email is not null and email <> '';

create trigger trg_employees_set_updated_at
  before update on public.employees
  for each row execute function public.set_updated_at();

alter table public.employees enable row level security;

-- อ่านได้ทุกคนที่ login แล้ว (โมดูล Ticket/Asset ในอนาคตต้องใช้ทำ dropdown เลือกเจ้าของ)
create policy employees_select_all_authenticated on public.employees
  for select to authenticated using (true);

create policy employees_write_with_permission on public.employees
  for all to authenticated
  using (public.has_permission('employee.manage'))
  with check (public.has_permission('employee.manage'));
