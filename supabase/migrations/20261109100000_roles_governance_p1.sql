-- Roles P1 governance metadata, immutable version history and safety controls.
-- This migration is additive and keeps the existing configurable permission model intact.

alter table public.roles
  add column if not exists owner_id uuid references public.profiles(id) on delete set null,
  add column if not exists scope text,
  add column if not exists review_frequency text not null default 'quarterly',
  add column if not exists sensitive_role boolean not null default false,
  add column if not exists version integer not null default 1;

do $$
begin
  alter table public.roles
    add constraint roles_review_frequency_check
    check (review_frequency in ('monthly', 'quarterly', 'semiannual', 'annual'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.roles
    add constraint roles_version_positive_check
    check (version > 0);
exception when duplicate_object then null;
end $$;

create index if not exists roles_owner_id_idx on public.roles (owner_id);
create index if not exists roles_sensitive_role_idx on public.roles (sensitive_role) where sensitive_role;

-- Every saved role state is retained as a JSON snapshot. Snapshots are append-only;
-- the current version number on roles is only a fast pointer for the list screen.
create table if not exists public.role_versions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.roles(id) on delete cascade,
  version_number integer not null,
  snapshot jsonb not null,
  change_type text not null default 'UPDATE',
  change_summary text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  constraint role_versions_role_version_unique unique (role_id, version_number),
  constraint role_versions_version_positive_check check (version_number > 0),
  constraint role_versions_snapshot_object_check check (jsonb_typeof(snapshot) = 'object')
);

create index if not exists role_versions_role_id_idx
  on public.role_versions (role_id, version_number desc);

-- A small, data-backed SoD catalog. Adding a rule later does not require a Worker release.
create table if not exists public.role_sod_conflict_rules (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  description text not null,
  permission_keys text[] not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint role_sod_conflict_rules_two_permissions_check check (cardinality(permission_keys) = 2)
);

drop trigger if exists trg_role_sod_conflict_rules_set_updated_at on public.role_sod_conflict_rules;
create trigger trg_role_sod_conflict_rules_set_updated_at
  before update on public.role_sod_conflict_rules
  for each row execute function public.set_updated_at();

insert into public.role_sod_conflict_rules (key, label, description, permission_keys)
values
  ('change_requester_approver', 'ยื่นคำขอ + อนุมัติ Change', 'ผู้ยื่น Change ไม่ควรเป็นผู้อนุมัติ Change เดียวกัน', array['change.create', 'change.approve']),
  ('change_tester_approver', 'ทดสอบ + อนุมัติ Change', 'ผู้รับรองผลทดสอบไม่ควรเป็นผู้อนุมัติ Change เดียวกัน', array['change.test', 'change.approve']),
  ('change_approver_deployer', 'อนุมัติ + ติดตั้ง Change', 'ผู้อนุมัติไม่ควรเป็นผู้ติดตั้ง Change เดียวกัน', array['change.approve', 'change.deploy']),
  ('access_requester_approver', 'ยื่นคำขอ + อนุมัติสิทธิ์', 'ผู้ยื่นคำขอสิทธิ์ไม่ควรเป็นผู้อนุมัติคำขอเดียวกัน', array['access_request.create', 'access_request.approve']),
  ('access_approver_processor', 'อนุมัติ + ดำเนินการให้สิทธิ์', 'ผู้อนุมัติไม่ควรเป็นผู้ดำเนินการให้สิทธิ์เดียวกัน', array['access_request.approve', 'access_request.process']),
  ('service_requester_approver', 'ยื่นคำขอบริการ + อนุมัติ', 'ผู้ยื่นคำขอบริการไม่ควรเป็นผู้อนุมัติคำขอเดียวกัน', array['service_request.create', 'service_request.approve']),
  ('risk_manager_acceptor', 'จัดการ Risk + รับรอง Risk Acceptance', 'ผู้ดูแล Risk ไม่ควรเป็นผู้รับรองการยอมรับความเสี่ยงเดียวกัน', array['risk.manage', 'risk.accept']),
  ('data_manager_destroyer', 'จัดการข้อมูล + อนุมัติทำลายข้อมูล', 'ผู้ดูแลทะเบียนข้อมูลไม่ควรเป็นผู้อนุมัติทำลายข้อมูลเดียวกัน', array['data_class.manage', 'data_class.approve'])
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  permission_keys = excluded.permission_keys,
  updated_at = now();

alter table public.role_versions enable row level security;
alter table public.role_sod_conflict_rules enable row level security;

drop policy if exists role_versions_select_with_role_view on public.role_versions;
create policy role_versions_select_with_role_view on public.role_versions
  for select to authenticated
  using (public.has_permission('role.view') or public.has_permission('role.manage'));

drop policy if exists role_sod_conflict_rules_select_with_role_view on public.role_sod_conflict_rules;
create policy role_sod_conflict_rules_select_with_role_view on public.role_sod_conflict_rules
  for select to authenticated
  using (public.has_permission('role.view') or public.has_permission('role.manage'));

grant select on public.role_versions to authenticated;
grant select on public.role_sod_conflict_rules to authenticated;

-- System roles are read-only. Inserts from seed/migrations remain possible, while
-- authenticated callers can only create/update/delete custom roles.
create or replace function public.prevent_system_role_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system then
      raise exception using errcode = '23514', message = 'SYSTEM_ROLE_LOCKED';
    end if;
    return old;
  end if;

  if old.is_system then
    if new.key is distinct from old.key
      or new.name_th is distinct from old.name_th
      or new.name_en is distinct from old.name_en
      or new.description is distinct from old.description
      or new.is_system is distinct from old.is_system
      or new.status is distinct from old.status
      or new.owner_id is distinct from old.owner_id
      or new.scope is distinct from old.scope
      or new.review_frequency is distinct from old.review_frequency
      or new.sensitive_role is distinct from old.sensitive_role
      or new.version is distinct from old.version then
      raise exception using errcode = '23514', message = 'SYSTEM_ROLE_LOCKED';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_system_role_mutation on public.roles;
create trigger trg_prevent_system_role_mutation
  before update or delete on public.roles
  for each row execute function public.prevent_system_role_mutation();

-- The FK on user_roles is intentionally cascade for account cleanup, but role
-- deletion must be explicit and blocked while even one assignment remains.
create or replace function public.prevent_role_delete_when_assigned()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.user_roles where role_id = old.id) then
    raise exception using errcode = '23514', message = 'ROLE_HAS_ASSIGNED_USERS';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_prevent_role_delete_when_assigned on public.roles;
create trigger trg_prevent_role_delete_when_assigned
  before delete on public.roles
  for each row execute function public.prevent_role_delete_when_assigned();

-- Restrict direct authenticated writes to custom roles. The API uses the
-- service-role RPCs below only after its role.manage middleware succeeds.
drop policy if exists roles_write_with_permission on public.roles;
drop policy if exists roles_write_custom_with_permission on public.roles;
create policy roles_write_custom_with_permission on public.roles
  for all to authenticated
  using (public.has_permission('role.manage') and not is_system)
  with check (public.has_permission('role.manage') and not is_system);

drop policy if exists role_versions_write_with_role_manage on public.role_versions;
drop policy if exists role_sod_conflict_rules_write_with_role_manage on public.role_sod_conflict_rules;

drop policy if exists role_permissions_write_with_permission on public.role_permissions;
drop policy if exists role_permissions_write_custom_with_permission on public.role_permissions;
create policy role_permissions_write_custom_with_permission on public.role_permissions
  for all to authenticated
  using (
    public.has_permission('role.manage')
    and not exists (select 1 from public.roles r where r.id = role_id and r.is_system)
  )
  with check (
    public.has_permission('role.manage')
    and not exists (select 1 from public.roles r where r.id = role_id and r.is_system)
  );

-- Stable snapshot format used by both the history view and compare endpoint.
create or replace function public.build_role_snapshot(role_id_input uuid)
returns jsonb
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'role', jsonb_build_object(
      'id', r.id,
      'key', r.key,
      'name_th', r.name_th,
      'name_en', r.name_en,
      'description', r.description,
      'scope', r.scope,
      'owner_id', r.owner_id,
      'review_frequency', r.review_frequency,
      'sensitive_role', r.sensitive_role,
      'is_system', r.is_system,
      'status', r.status
    ),
    'permissions', coalesce((
      select jsonb_agg(
        jsonb_build_object('permission_id', rp.permission_id, 'key', p.key, 'effect', rp.effect)
        order by p.key
      )
      from public.role_permissions rp
      join public.permissions p on p.id = rp.permission_id
      where rp.role_id = r.id
    ), '[]'::jsonb)
  )
  from public.roles r
  where r.id = role_id_input;
$$;

create or replace function public.create_role_with_version(
  key_input text,
  name_th_input text,
  name_en_input text,
  description_input text,
  scope_input text,
  owner_id_input uuid,
  review_frequency_input text,
  sensitive_role_input boolean,
  actor_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  role_row public.roles;
begin
  if owner_id_input is not null and not exists (
    select 1 from public.profiles where id = owner_id_input and status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'ROLE_OWNER_INACTIVE';
  end if;

  insert into public.roles (
    key, name_th, name_en, description, is_system, status, owner_id, scope,
    review_frequency, sensitive_role, version, created_by, updated_by
  ) values (
    btrim(key_input), btrim(name_th_input), nullif(btrim(name_en_input), ''),
    nullif(btrim(description_input), ''), false, 'active', owner_id_input,
    nullif(btrim(scope_input), ''), review_frequency_input, sensitive_role_input,
    1, actor_id_input, actor_id_input
  ) returning * into role_row;

  insert into public.role_versions (role_id, version_number, snapshot, change_type, change_summary, created_by)
  values (role_row.id, 1, public.build_role_snapshot(role_row.id), 'CREATE', 'สร้างบทบาท', actor_id_input);

  return to_jsonb(role_row);
end;
$$;

create or replace function public.update_role_with_version(
  role_id_input uuid,
  name_th_input text,
  name_en_input text,
  description_input text,
  scope_input text,
  owner_id_input uuid,
  review_frequency_input text,
  sensitive_role_input boolean,
  status_input text,
  actor_id_input uuid,
  change_summary_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  role_row public.roles;
begin
  select * into role_row from public.roles where id = role_id_input for update;
  if not found then raise exception using errcode = 'P0002', message = 'ROLE_NOT_FOUND'; end if;
  if role_row.is_system then raise exception using errcode = '23514', message = 'SYSTEM_ROLE_LOCKED'; end if;
  if owner_id_input is not null and not exists (
    select 1 from public.profiles where id = owner_id_input and status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'ROLE_OWNER_INACTIVE';
  end if;

  update public.roles
  set name_th = btrim(name_th_input),
      name_en = nullif(btrim(name_en_input), ''),
      description = nullif(btrim(description_input), ''),
      scope = nullif(btrim(scope_input), ''),
      owner_id = owner_id_input,
      review_frequency = review_frequency_input,
      sensitive_role = sensitive_role_input,
      status = status_input,
      updated_by = actor_id_input
  where id = role_id_input
  returning * into role_row;

  update public.roles set version = role_row.version + 1 where id = role_id_input returning * into role_row;

  insert into public.role_versions (role_id, version_number, snapshot, change_type, change_summary, created_by)
  values (role_id_input, role_row.version, public.build_role_snapshot(role_id_input), 'UPDATE', coalesce(change_summary_input, 'แก้ไขข้อมูลบทบาท'), actor_id_input);

  return to_jsonb(role_row);
end;
$$;

create or replace function public.set_role_permissions_with_version(
  role_id_input uuid,
  permissions_input jsonb,
  actor_id_input uuid,
  change_summary_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  role_row public.roles;
  next_version integer;
begin
  select * into role_row from public.roles where id = role_id_input for update;
  if not found then raise exception using errcode = 'P0002', message = 'ROLE_NOT_FOUND'; end if;
  if role_row.is_system then raise exception using errcode = '23514', message = 'SYSTEM_ROLE_LOCKED'; end if;
  if jsonb_typeof(permissions_input) <> 'array' then raise exception using errcode = '22023', message = 'ROLE_PERMISSIONS_INVALID'; end if;

  delete from public.role_permissions where role_id = role_id_input;

  insert into public.role_permissions (role_id, permission_id, effect, created_by, updated_by)
  select role_id_input, coalesce(item.permission_id, item."permissionId"), item.effect, actor_id_input, actor_id_input
  from jsonb_to_recordset(permissions_input) as item(permission_id uuid, "permissionId" uuid, effect text);

  next_version := role_row.version + 1;
  update public.roles set version = next_version, updated_by = actor_id_input where id = role_id_input;

  insert into public.role_versions (role_id, version_number, snapshot, change_type, change_summary, created_by)
  values (role_id_input, next_version, public.build_role_snapshot(role_id_input), 'PERMISSIONS', coalesce(change_summary_input, 'แก้ไข Permission Matrix'), actor_id_input);

  return jsonb_build_object('saved', true, 'version', next_version);
end;
$$;

create or replace function public.clone_role_with_version(
  source_role_id_input uuid,
  key_input text,
  name_th_input text,
  name_en_input text,
  description_input text,
  scope_input text,
  owner_id_input uuid,
  review_frequency_input text,
  sensitive_role_input boolean,
  actor_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  source_role public.roles;
  role_row public.roles;
begin
  select * into source_role from public.roles where id = source_role_id_input;
  if not found then raise exception using errcode = 'P0002', message = 'ROLE_NOT_FOUND'; end if;
  if owner_id_input is not null and not exists (
    select 1 from public.profiles where id = owner_id_input and status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'ROLE_OWNER_INACTIVE';
  end if;

  insert into public.roles (
    key, name_th, name_en, description, is_system, status, owner_id, scope,
    review_frequency, sensitive_role, version, created_by, updated_by
  ) values (
    btrim(key_input), btrim(name_th_input), nullif(btrim(name_en_input), ''),
    nullif(btrim(description_input), ''), false, 'active', owner_id_input,
    nullif(btrim(scope_input), ''), review_frequency_input, sensitive_role_input,
    1, actor_id_input, actor_id_input
  ) returning * into role_row;

  insert into public.role_permissions (role_id, permission_id, effect, notes, created_by, updated_by)
  select role_row.id, permission_id, effect, notes, actor_id_input, actor_id_input
  from public.role_permissions
  where role_id = source_role.id;

  insert into public.role_versions (role_id, version_number, snapshot, change_type, change_summary, created_by)
  values (role_row.id, 1, public.build_role_snapshot(role_row.id), 'CLONE', 'สร้างจากบทบาท ' || source_role.name_th, actor_id_input);

  return to_jsonb(role_row);
end;
$$;

revoke all on function public.build_role_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.create_role_with_version(text, text, text, text, text, uuid, text, boolean, uuid) from public, anon, authenticated;
revoke all on function public.update_role_with_version(uuid, text, text, text, text, uuid, text, boolean, text, uuid, text) from public, anon, authenticated;
revoke all on function public.set_role_permissions_with_version(uuid, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.clone_role_with_version(uuid, text, text, text, text, text, uuid, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.create_role_with_version(text, text, text, text, text, uuid, text, boolean, uuid) to service_role;
grant execute on function public.update_role_with_version(uuid, text, text, text, text, uuid, text, boolean, text, uuid, text) to service_role;
grant execute on function public.set_role_permissions_with_version(uuid, jsonb, uuid, text) to service_role;
grant execute on function public.clone_role_with_version(uuid, text, text, text, text, text, uuid, text, boolean, uuid) to service_role;

-- Baseline version for roles that existed before this migration.
insert into public.role_versions (role_id, version_number, snapshot, change_type, change_summary, created_by)
select r.id, r.version, public.build_role_snapshot(r.id), 'BASELINE', 'เวอร์ชันตั้งต้นก่อนเปิดใช้ Role Governance',
  case when exists (select 1 from public.profiles p where p.id = r.created_by) then r.created_by else null end
from public.roles r
on conflict (role_id, version_number) do nothing;

comment on table public.role_versions is 'Immutable snapshots of role metadata and Permission Matrix for audit and comparison.';
comment on column public.roles.owner_id is 'ผู้รับผิดชอบบทบาทและผู้ประสานงานการทบทวนสิทธิ์';
comment on column public.roles.scope is 'ขอบเขตการใช้งานของบทบาท';
comment on column public.roles.review_frequency is 'รอบทบทวนบทบาท: monthly, quarterly, semiannual or annual';
comment on column public.roles.sensitive_role is 'บทบาทที่มีความเสี่ยงสูงหรือเข้าถึงข้อมูลสำคัญ';
