-- ============================================================================
-- Master Data: departments, positions
-- Legacy: ระบบเดิมเก็บหน่วยงาน/ตำแหน่งเป็น free-text ในหลาย Sheet (Users.Department,
-- Employees.Department/Position ฯลฯ) — ตารางนี้เป็นของใหม่ทั้งหมด ต้องทำ Data Cleansing
-- ก่อน Import ข้อมูลจริงใน Phase 7 (ดู docs/migration/phase0-risk_register.md ข้อ R-06)
-- ============================================================================

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name_th text not null,
  name_en text,
  parent_department_id uuid references public.departments(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint departments_code_unique unique (code)
);

create index departments_parent_department_id_idx on public.departments (parent_department_id);
create index departments_status_idx on public.departments (status);

create trigger trg_departments_set_updated_at
  before update on public.departments
  for each row execute function public.set_updated_at();

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name_th text not null,
  name_en text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint positions_code_unique unique (code)
);

create index positions_status_idx on public.positions (status);

create trigger trg_positions_set_updated_at
  before update on public.positions
  for each row execute function public.set_updated_at();

-- RLS: เปิดใช้งานที่นี่ก่อน ส่วน Policy ที่ต้องใช้ has_permission() จะเพิ่มใน
-- 20260805100004_rbac.sql หลังจากตารางสิทธิ์/ฟังก์ชันตรวจสิทธิ์ถูกสร้างแล้ว
alter table public.departments enable row level security;
alter table public.positions enable row level security;
