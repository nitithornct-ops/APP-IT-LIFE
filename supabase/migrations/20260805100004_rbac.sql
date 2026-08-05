-- ============================================================================
-- Configurable RBAC: roles, permissions, user_roles, role_permissions,
-- user_permission_overrides — ไม่ hard-code สิทธิ์ไว้ที่ Frontend/Backend
-- Legacy: Users.Role เดิมเป็นค่าเดียวต่อผู้ใช้ 1 คน (ไม่ใช่ many-to-many) — ชุดตารางนี้
-- แก้ข้อจำกัดนั้น (ดู docs/migration/phase0-risk_register.md ข้อ R-02)
-- แนวคิด effect ALLOW/DENY + user override precedence สืบทอดมาจาก ActionPermissions/
-- RoleActionPermissions/UserPermissionOverrides ของระบบเดิมที่ออกแบบไว้ดีอยู่แล้ว
-- ============================================================================

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  name_th text not null,
  name_en text,
  description text,
  is_system boolean not null default false,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint roles_key_unique unique (key)
);

create trigger trg_roles_set_updated_at
  before update on public.roles
  for each row execute function public.set_updated_at();

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  module_key text not null,
  action text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint permissions_key_unique unique (key)
);

create index permissions_module_key_idx on public.permissions (module_key);

create trigger trg_permissions_set_updated_at
  before update on public.permissions
  for each row execute function public.set_updated_at();

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id) on delete set null,
  constraint user_roles_user_role_unique unique (user_id, role_id)
);

create index user_roles_user_id_idx on public.user_roles (user_id);
create index user_roles_role_id_idx on public.user_roles (role_id);

create table public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  effect text not null default 'allow' check (effect in ('allow', 'deny')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint role_permissions_role_permission_unique unique (role_id, permission_id)
);

create index role_permissions_role_id_idx on public.role_permissions (role_id);
create index role_permissions_permission_id_idx on public.role_permissions (permission_id);

create trigger trg_role_permissions_set_updated_at
  before update on public.role_permissions
  for each row execute function public.set_updated_at();

create table public.user_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  effect text not null check (effect in ('allow', 'deny')),
  start_at timestamptz,
  end_at timestamptz,
  reason text not null,
  approved_by uuid references auth.users(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

create index user_permission_overrides_user_id_idx on public.user_permission_overrides (user_id);
create index user_permission_overrides_permission_id_idx on public.user_permission_overrides (permission_id);

create trigger trg_user_permission_overrides_set_updated_at
  before update on public.user_permission_overrides
  for each row execute function public.set_updated_at();

alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_permission_overrides enable row level security;

-- ----------------------------------------------------------------------------
-- Helper functions — ใช้ตรวจสิทธิ์ใน RLS Policy ทุกตาราง (รวมตารางโมดูลที่จะเพิ่มใน Phase 6)
-- SECURITY DEFINER: ให้ฟังก์ชันอ่านตารางสิทธิ์ได้โดยไม่ขึ้นกับ RLS ของผู้เรียก (มาตรฐาน Supabase)
-- ----------------------------------------------------------------------------

create or replace function public.has_permission(permission_key_input text)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_permission_id uuid;
  v_permission_status text;
  v_override_effect text;
  v_has_deny boolean;
  v_has_allow boolean;
begin
  if v_user_id is null then
    return false;
  end if;

  -- ผู้ใช้ที่ถูกระงับ (Disable User) ไม่มีสิทธิ์ใดๆ ทันที ไม่ว่า Role จะเป็นอะไร
  if not exists (
    select 1 from public.profiles p where p.id = v_user_id and p.status = 'active'
  ) then
    return false;
  end if;

  select id, status into v_permission_id, v_permission_status
  from public.permissions
  where key = permission_key_input;

  -- unknown/inactive permission key = ปฏิเสธเสมอ (fail-closed ตามแนวทางระบบเดิม)
  if v_permission_id is null or v_permission_status <> 'active' then
    return false;
  end if;

  -- user-level override ที่ active และอยู่ในช่วงเวลาที่กำหนด มี precedence เหนือ role เสมอ
  select o.effect into v_override_effect
  from public.user_permission_overrides o
  where o.user_id = v_user_id
    and o.permission_id = v_permission_id
    and o.status = 'active'
    and (o.start_at is null or o.start_at <= now())
    and (o.end_at is null or o.end_at >= now())
  order by (o.effect = 'deny') desc
  limit 1;

  if v_override_effect is not null then
    return v_override_effect = 'allow';
  end if;

  -- role-based: รวมสิทธิ์จากทุก Role ที่ผู้ใช้มี — DENY ชนะเสมอเมื่อขัดแย้งกัน
  select
    bool_or(rp.effect = 'deny'),
    bool_or(rp.effect = 'allow')
  into v_has_deny, v_has_allow
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id and r.status = 'active'
  join public.role_permissions rp on rp.role_id = r.id and rp.permission_id = v_permission_id
  where ur.user_id = v_user_id;

  if v_has_deny then
    return false;
  end if;

  return coalesce(v_has_allow, false);
end;
$$;

create or replace function public.has_role(role_key_input text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid()
      and r.key = role_key_input
      and r.status = 'active'
      and p.status = 'active'
  );
$$;

create or replace function public.current_department_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select department_id from public.profiles where id = auth.uid();
$$;

-- ป้องกันไม่ให้ระบบเหลือ super_admin ที่ Active เป็น 0 คน (สืบทอดแนวคิดจาก
-- Module_ActionPermission.gs เดิม: "ป้องกันการทำให้ระบบไม่มีผู้ดูแลคนสุดท้าย")
create or replace function public.prevent_last_super_admin_removal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_key text;
  v_remaining_count integer;
begin
  select key into v_role_key from public.roles where id = old.role_id;

  if v_role_key = 'super_admin' then
    select count(*) into v_remaining_count
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.user_id
    where r.key = 'super_admin'
      and p.status = 'active'
      and ur.user_id <> old.user_id;

    if v_remaining_count = 0 then
      raise exception 'ไม่สามารถลบบทบาท super_admin คนสุดท้ายของระบบได้ (last-admin guard)';
    end if;
  end if;

  return old;
end;
$$;

create trigger trg_prevent_last_super_admin_removal
  before delete on public.user_roles
  for each row execute function public.prevent_last_super_admin_removal();

-- ----------------------------------------------------------------------------
-- RLS Policies — departments / positions (ตารางถูกสร้างไว้ก่อนแล้วในไฟล์ migration ก่อนหน้า)
-- ----------------------------------------------------------------------------

create policy departments_select_all_authenticated on public.departments
  for select to authenticated using (true);

create policy departments_write_with_permission on public.departments
  for all to authenticated
  using (public.has_permission('department.manage'))
  with check (public.has_permission('department.manage'));

create policy positions_select_all_authenticated on public.positions
  for select to authenticated using (true);

create policy positions_write_with_permission on public.positions
  for all to authenticated
  using (public.has_permission('position.manage'))
  with check (public.has_permission('position.manage'));

-- ----------------------------------------------------------------------------
-- RLS Policies — profiles
-- ----------------------------------------------------------------------------

create policy profiles_select_own_or_managed on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.has_permission('user.manage'));

-- Field-level restriction (ห้ามผู้ใช้แก้ department_id/status ของตนเอง) บังคับที่ Backend
-- (Cloudflare Workers, Phase 4) — RLS ตรวจได้แค่ระดับแถว ไม่ใช่ระดับคอลัมน์
create policy profiles_update_own_or_managed on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.has_permission('user.manage'))
  with check (id = auth.uid() or public.has_permission('user.manage'));

-- ไม่มี Policy สำหรับ insert/delete ของ authenticated โดยตั้งใจ:
-- การสร้างบัญชีทำผ่าน handle_new_user() trigger (SECURITY DEFINER) เท่านั้น
-- และการปิดบัญชีใช้ status='inactive' แทนการลบจริง (Soft Delete)

-- ----------------------------------------------------------------------------
-- RLS Policies — roles / permissions / user_roles / role_permissions / overrides
-- role.view = อ่านอย่างเดียว (เช่น Auditor), role.manage = แก้ไข/มอบหมายสิทธิ์
-- ----------------------------------------------------------------------------

create policy roles_select_with_permission on public.roles
  for select to authenticated
  using (public.has_permission('role.view') or public.has_permission('role.manage'));

create policy roles_write_with_permission on public.roles
  for all to authenticated
  using (public.has_permission('role.manage'))
  with check (public.has_permission('role.manage'));

create policy permissions_select_with_permission on public.permissions
  for select to authenticated
  using (public.has_permission('role.view') or public.has_permission('role.manage'));

create policy permissions_write_with_permission on public.permissions
  for all to authenticated
  using (public.has_permission('role.manage'))
  with check (public.has_permission('role.manage'));

create policy user_roles_select_own_or_with_permission on public.user_roles
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.has_permission('role.view')
    or public.has_permission('role.manage')
  );

create policy user_roles_write_with_permission on public.user_roles
  for all to authenticated
  using (public.has_permission('role.manage'))
  with check (public.has_permission('role.manage'));

create policy role_permissions_select_with_permission on public.role_permissions
  for select to authenticated
  using (public.has_permission('role.view') or public.has_permission('role.manage'));

create policy role_permissions_write_with_permission on public.role_permissions
  for all to authenticated
  using (public.has_permission('role.manage'))
  with check (public.has_permission('role.manage'));

create policy user_permission_overrides_select_own_or_with_permission on public.user_permission_overrides
  for select to authenticated
  using (user_id = auth.uid() or public.has_permission('role.manage'));

create policy user_permission_overrides_write_with_permission on public.user_permission_overrides
  for all to authenticated
  using (public.has_permission('role.manage'))
  with check (public.has_permission('role.manage'));
