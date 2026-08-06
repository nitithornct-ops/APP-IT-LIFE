-- ============================================================================
-- Phase 6 Module 2: User/Role/Permission — ส่วนที่ยังขาด
-- 1) user_permission_overrides: เพิ่ม unique constraint (user_id, permission_id) ให้ตรงกับ
--    แนวคิด "One governed row per user/key" ของ UserPermissionOverrides เดิม (Module_ActionPermission.gs)
--    ตารางและ RLS ถูกสร้างไว้แล้วใน 20260805100004_rbac.sql — ที่นี่แค่เติม constraint ที่ขาด
-- 2) approval_groups / approval_group_members: ย้ายจาก ApprovalGroups/ApprovalGroupMembers เดิม
--    ใช้สำหรับ routing การอนุมัติในโมดูล Workflow/Access Request/Change ที่จะตามมาใน Phase 6 ถัดๆ ไป
--    Department เดิมเป็น free text — เปลี่ยนเป็น department_id อ้าง departments(id) ตามแนวทางที่วางไว้แล้ว
-- ============================================================================

alter table public.user_permission_overrides
  add constraint user_permission_overrides_user_permission_unique unique (user_id, permission_id);

create table public.approval_groups (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  department_id uuid references public.departments(id) on delete set null,
  description text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  owner_id uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint approval_groups_code_unique unique (code),
  constraint approval_groups_code_format check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,79}$')
);

create trigger trg_approval_groups_set_updated_at
  before update on public.approval_groups
  for each row execute function public.set_updated_at();

create table public.approval_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.approval_groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  member_role text not null default 'member' check (member_role in ('primary', 'member', 'backup')),
  priority integer not null default 100 check (priority between 1 and 999),
  valid_from timestamptz,
  valid_until timestamptz,
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint approval_group_members_group_user_unique unique (group_id, user_id),
  constraint approval_group_members_valid_range
    check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

create index approval_group_members_group_id_idx on public.approval_group_members (group_id);
create index approval_group_members_user_id_idx on public.approval_group_members (user_id);

create trigger trg_approval_group_members_set_updated_at
  before update on public.approval_group_members
  for each row execute function public.set_updated_at();

alter table public.approval_groups enable row level security;
alter table public.approval_group_members enable row level security;

-- อ่านได้ทุกคนที่ login แล้ว (โมดูล Workflow/Access Request/Change ในอนาคตต้องใช้ทำ dropdown เลือกกลุ่มอนุมัติ)
create policy approval_groups_select_all_authenticated on public.approval_groups
  for select to authenticated using (true);

create policy approval_groups_write_with_permission on public.approval_groups
  for all to authenticated
  using (public.has_permission('approval_group.manage'))
  with check (public.has_permission('approval_group.manage'));

create policy approval_group_members_select_all_authenticated on public.approval_group_members
  for select to authenticated using (true);

create policy approval_group_members_write_with_permission on public.approval_group_members
  for all to authenticated
  using (public.has_permission('approval_group.manage'))
  with check (public.has_permission('approval_group.manage'));
