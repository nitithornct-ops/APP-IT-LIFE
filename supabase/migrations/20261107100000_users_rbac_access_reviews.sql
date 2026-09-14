-- Users / RBAC P0-P1 extensions.
-- This migration is additive: existing profiles, roles and overrides remain valid.

alter table public.profiles
  add column if not exists last_login_at timestamptz,
  add column if not exists last_password_change_at timestamptz,
  add column if not exists account_source text not null default 'unknown',
  add column if not exists employment_status text not null default 'active';

do $$
begin
  alter table public.profiles
    add constraint profiles_account_source_check
    check (account_source in ('local', 'invite', 'sso', 'import', 'unknown'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.profiles
    add constraint profiles_employment_status_check
    check (employment_status in ('active', 'on_leave', 'terminated', 'contractor', 'retired'));
exception when duplicate_object then null;
end $$;

create index if not exists profiles_last_login_at_idx on public.profiles (last_login_at desc);
create index if not exists profiles_employment_status_idx on public.profiles (employment_status);

alter table public.permissions
  add column if not exists is_privileged boolean not null default false;

-- Mark high-impact permissions explicitly so privileged access does not depend on a
-- hard-coded list in the Worker.
update public.permissions
set is_privileged = true
where key in (
  'user.manage',
  'role.manage',
  'access_registry.manage',
  'approval_group.manage',
  'employee.manage',
  'audit.view',
  'report.export',
  'evidence.export',
  'workflow.approve',
  'access_request.approve',
  'change.approve',
  'service_request.approve',
  'data_class.approve',
  'risk.accept'
);

-- Keep newly seeded or created high-impact permissions protected as well.
create or replace function public.sync_permission_privilege_metadata()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.key in (
    'user.manage',
    'role.manage',
    'access_registry.manage',
    'approval_group.manage',
    'employee.manage',
    'audit.view',
    'report.export',
    'evidence.export',
    'workflow.approve',
    'access_request.approve',
    'change.approve',
    'service_request.approve',
    'data_class.approve',
    'risk.accept'
  ) then
    new.is_privileged := true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_permission_privilege_metadata on public.permissions;
create trigger trg_sync_permission_privilege_metadata
  before insert or update of key on public.permissions
  for each row execute function public.sync_permission_privilege_metadata();

alter table public.user_permission_overrides
  add column if not exists is_temporary boolean not null default false,
  add column if not exists privileged_access boolean not null default false,
  add column if not exists approval_status text not null default 'approved',
  add column if not exists approval_requested_by uuid references public.profiles(id) on delete set null,
  add column if not exists approval_requested_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists approval_comment text;

do $$
begin
  alter table public.user_permission_overrides
    add constraint user_permission_overrides_approval_status_check
    check (approval_status in ('pending', 'approved', 'rejected'));
exception when duplicate_object then null;
end $$;

-- Backfill privilege metadata for rows created before this migration.
update public.user_permission_overrides o
set privileged_access = p.is_privileged,
    is_temporary = (o.end_at is not null)
from public.permissions p
where p.id = o.permission_id;

do $$
begin
  alter table public.user_permission_overrides
    add constraint user_permission_overrides_temporary_expiry_check
    check (not is_temporary or end_at is not null);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.user_permission_overrides
    add constraint user_permission_overrides_privileged_expiry_check
    check (not (effect = 'allow' and privileged_access) or end_at is not null);
exception when duplicate_object then null;
end $$;

create or replace function public.sync_permission_override_metadata()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  select p.is_privileged
    into new.privileged_access
  from public.permissions p
  where p.id = new.permission_id;

  new.is_temporary := new.end_at is not null;
  return new;
end;
$$;

drop trigger if exists trg_sync_permission_override_metadata on public.user_permission_overrides;
create trigger trg_sync_permission_override_metadata
  before insert or update of permission_id, effect, start_at, end_at
  on public.user_permission_overrides
  for each row execute function public.sync_permission_override_metadata();

-- Explicit RBAC groups. Approval groups remain a separate concept and do not
-- silently grant permissions.
create table if not exists public.access_groups (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  constraint access_groups_key_unique unique (key)
);

create table if not exists public.access_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.access_groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  valid_from timestamptz,
  valid_until timestamptz,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  constraint access_group_members_group_user_unique unique (group_id, user_id),
  constraint access_group_members_valid_range check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

create table if not exists public.access_group_permissions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.access_groups(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  effect text not null default 'allow' check (effect in ('allow', 'deny')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  constraint access_group_permissions_unique unique (group_id, permission_id)
);

create index if not exists access_group_members_user_id_idx on public.access_group_members (user_id);
create index if not exists access_group_members_group_id_idx on public.access_group_members (group_id);
create index if not exists access_group_permissions_permission_id_idx on public.access_group_permissions (permission_id);

drop trigger if exists trg_access_groups_set_updated_at on public.access_groups;
create trigger trg_access_groups_set_updated_at
  before update on public.access_groups
  for each row execute function public.set_updated_at();

drop trigger if exists trg_access_group_members_set_updated_at on public.access_group_members;
create trigger trg_access_group_members_set_updated_at
  before update on public.access_group_members
  for each row execute function public.set_updated_at();

drop trigger if exists trg_access_group_permissions_set_updated_at on public.access_group_permissions;
create trigger trg_access_group_permissions_set_updated_at
  before update on public.access_group_permissions
  for each row execute function public.set_updated_at();

alter table public.access_groups enable row level security;
alter table public.access_group_members enable row level security;
alter table public.access_group_permissions enable row level security;

drop policy if exists access_groups_select_with_role_view on public.access_groups;
create policy access_groups_select_with_role_view on public.access_groups
  for select to authenticated
  using (public.has_permission('role.view') or public.has_permission('role.manage') or public.has_permission('user.manage'));

drop policy if exists access_groups_write_with_role_manage on public.access_groups;
create policy access_groups_write_with_role_manage on public.access_groups
  for all to authenticated
  using (public.has_permission('role.manage'))
  with check (public.has_permission('role.manage'));

drop policy if exists access_group_members_select_own_or_role_view on public.access_group_members;
create policy access_group_members_select_own_or_role_view on public.access_group_members
  for select to authenticated
  using (user_id = auth.uid() or public.has_permission('role.view') or public.has_permission('role.manage') or public.has_permission('user.manage'));

drop policy if exists access_group_members_write_with_role_manage on public.access_group_members;
create policy access_group_members_write_with_role_manage on public.access_group_members
  for all to authenticated
  using (public.has_permission('role.manage'))
  with check (public.has_permission('role.manage'));

drop policy if exists access_group_permissions_select_with_role_view on public.access_group_permissions;
create policy access_group_permissions_select_with_role_view on public.access_group_permissions
  for select to authenticated
  using (public.has_permission('role.view') or public.has_permission('role.manage') or public.has_permission('user.manage'));

drop policy if exists access_group_permissions_write_with_role_manage on public.access_group_permissions;
create policy access_group_permissions_write_with_role_manage on public.access_group_permissions
  for all to authenticated
  using (public.has_permission('role.manage'))
  with check (public.has_permission('role.manage'));

grant select, insert, update, delete on public.access_groups to authenticated;
grant select, insert, update, delete on public.access_group_members to authenticated;
grant select, insert, update, delete on public.access_group_permissions to authenticated;

-- A review row is a decision record plus an immutable permission snapshot.
create table if not exists public.user_access_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  reviewer_id uuid references public.profiles(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'revoked', 'exception')),
  due_at timestamptz not null default (now() + interval '90 days'),
  snapshot jsonb not null default '[]'::jsonb,
  decision_note text,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_access_reviews_user_id_idx on public.user_access_reviews (user_id, created_at desc);
create index if not exists user_access_reviews_status_due_idx on public.user_access_reviews (status, due_at);

drop trigger if exists trg_user_access_reviews_set_updated_at on public.user_access_reviews;
create trigger trg_user_access_reviews_set_updated_at
  before update on public.user_access_reviews
  for each row execute function public.set_updated_at();

alter table public.user_access_reviews enable row level security;

drop policy if exists user_access_reviews_select_with_role_view on public.user_access_reviews;
create policy user_access_reviews_select_with_role_view on public.user_access_reviews
  for select to authenticated
  using (user_id = auth.uid() or public.has_permission('role.view') or public.has_permission('role.manage') or public.has_permission('user.manage'));

drop policy if exists user_access_reviews_write_with_role_manage on public.user_access_reviews;
create policy user_access_reviews_write_with_role_manage on public.user_access_reviews
  for all to authenticated
  using (public.has_permission('role.manage'))
  with check (public.has_permission('role.manage'));

grant select, insert, update on public.user_access_reviews to authenticated;

-- Return every permission, including implicit DENY rows, so an auditor can see
-- both what is effective and why it is effective.
create or replace function public.effective_permissions_for_user(target_user_id uuid)
returns table (
  permission_id uuid,
  permission_key text,
  module_key text,
  action text,
  description text,
  effective_effect text,
  source text,
  sources jsonb,
  is_privileged boolean,
  expires_at timestamptz
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
with source_rows as (
  select
    p.id as permission_id,
    'role'::text as source_type,
    r.id as source_id,
    r.name_th as source_name,
    rp.effect::text as grant_effect,
    null::timestamptz as starts_at,
    null::timestamptz as ends_at,
    false as temporary_access,
    'approved'::text as approval_status,
    null::text as reason
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id and r.status = 'active'
  join public.role_permissions rp on rp.role_id = r.id
  join public.permissions p on p.id = rp.permission_id and p.status = 'active'
  where ur.user_id = target_user_id

  union all

  select
    p.id,
    'group'::text,
    g.id,
    g.name,
    gp.effect::text,
    m.valid_from,
    m.valid_until,
    m.valid_until is not null,
    'approved'::text,
    null::text
  from public.access_group_members m
  join public.access_groups g on g.id = m.group_id and g.status = 'active'
  join public.access_group_permissions gp on gp.group_id = g.id
  join public.permissions p on p.id = gp.permission_id and p.status = 'active'
  where m.user_id = target_user_id
    and m.status = 'active'
    and (m.valid_from is null or m.valid_from <= now())
    and (m.valid_until is null or m.valid_until >= now())

  union all

  select
    p.id,
    'override'::text,
    o.id,
    'User Override'::text,
    o.effect::text,
    o.start_at,
    o.end_at,
    o.is_temporary,
    o.approval_status,
    o.reason
  from public.user_permission_overrides o
  join public.permissions p on p.id = o.permission_id and p.status = 'active'
  where o.user_id = target_user_id
    and o.status = 'active'
    and o.approval_status = 'approved'
    and (o.start_at is null or o.start_at <= now())
    and (o.end_at is null or o.end_at >= now())
),
override_state as (
  select
    sr.permission_id,
    case when bool_or(sr.grant_effect = 'deny') then 'deny' else 'allow' end as effective_effect,
    jsonb_agg(jsonb_build_object(
      'type', sr.source_type,
      'id', sr.source_id,
      'name', sr.source_name,
      'effect', sr.grant_effect,
      'startsAt', sr.starts_at,
      'endsAt', sr.ends_at,
      'temporary', sr.temporary_access,
      'approvalStatus', sr.approval_status,
      'reason', sr.reason
    ) order by sr.source_name) as sources,
    min(sr.ends_at) filter (where sr.grant_effect = 'allow' and sr.ends_at is not null) as expires_at
  from source_rows sr
  where sr.source_type = 'override'
  group by sr.permission_id
),
base_state as (
  select
    sr.permission_id,
    case when bool_or(sr.grant_effect = 'deny') then 'deny' else 'allow' end as effective_effect,
    bool_or(sr.source_type = 'role') as has_role,
    bool_or(sr.source_type = 'group') as has_group,
    jsonb_agg(jsonb_build_object(
      'type', sr.source_type,
      'id', sr.source_id,
      'name', sr.source_name,
      'effect', sr.grant_effect,
      'startsAt', sr.starts_at,
      'endsAt', sr.ends_at,
      'temporary', sr.temporary_access,
      'approvalStatus', sr.approval_status,
      'reason', sr.reason
    ) order by sr.source_type, sr.source_name) as sources,
    min(sr.ends_at) filter (where sr.grant_effect = 'allow' and sr.ends_at is not null) as expires_at
  from source_rows sr
  where sr.source_type in ('role', 'group')
  group by sr.permission_id
)
select
  p.id,
  p.key,
  p.module_key,
  p.action,
  p.description,
  coalesce(os.effective_effect, bs.effective_effect, 'deny'),
  case
    when os.permission_id is not null then 'override'
    when coalesce(bs.has_group, false) then 'group'
    when coalesce(bs.has_role, false) then 'role'
    else 'none'
  end,
  coalesce(os.sources, bs.sources, '[]'::jsonb),
  p.is_privileged,
  coalesce(os.expires_at, bs.expires_at)
from public.permissions p
left join override_state os on os.permission_id = p.id
left join base_state bs on bs.permission_id = p.id
where p.status = 'active'
  and exists (select 1 from public.profiles target where target.id = target_user_id and target.status = 'active');
$$;

revoke all on function public.effective_permissions_for_user(uuid) from public, anon;
grant execute on function public.effective_permissions_for_user(uuid) to authenticated, service_role;

-- Keep the authorization decision and the admin-facing explanation on one source of truth.
create or replace function public.has_permission(permission_key_input text)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select ep.effective_effect = 'allow'
      from public.effective_permissions_for_user(auth.uid()) ep
      where ep.permission_key = permission_key_input
    ),
    false
  );
$$;

revoke all on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated, service_role;

alter function public.sync_permission_override_metadata() set search_path = public, pg_temp;
revoke all on function public.sync_permission_override_metadata() from public, anon, authenticated;
grant execute on function public.sync_permission_override_metadata() to service_role;
revoke all on function public.sync_permission_privilege_metadata() from public, anon, authenticated;
grant execute on function public.sync_permission_privilege_metadata() to service_role;
