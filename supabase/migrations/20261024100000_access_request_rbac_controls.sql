-- ============================================================================
-- RBAC Access Request hardening
--
-- Replace the coarse Standard/Admin choice with a catalog of access items and
-- immutable request snapshots. Legacy rows remain readable through access_level
-- while all new requests use access_control_items.
-- ============================================================================

alter table public.access_systems
  add column if not exists system_owner_id uuid references public.profiles(id) on delete set null;

create table if not exists public.access_control_items (
  id uuid primary key default gen_random_uuid(),
  system_id uuid not null references public.access_systems(id) on delete restrict,
  kind text not null check (kind in ('role', 'profile', 'group', 'entitlement')),
  code text not null,
  name text not null,
  description text,
  permission_actions text[] not null default array[]::text[],
  data_classification text not null default 'ไม่ลับ' check (data_classification in ('ไม่ลับ', 'ลับ', 'ลับมาก')),
  privileged_access boolean not null default false,
  system_owner_id uuid not null references public.profiles(id) on delete restrict,
  default_approver_id uuid references public.profiles(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint access_control_items_actions_check check (
    cardinality(permission_actions) > 0
    and permission_actions <@ array['read', 'create', 'update', 'delete', 'approve']::text[]
  ),
  constraint access_control_items_system_code_unique unique (system_id, code)
);

create index if not exists access_control_items_system_status_idx
  on public.access_control_items(system_id, status);
create index if not exists access_control_items_classification_idx
  on public.access_control_items(data_classification, privileged_access);

create trigger trg_access_control_items_set_updated_at
  before update on public.access_control_items
  for each row execute function public.set_updated_at();

drop trigger if exists trg_access_control_items_atomic_audit on public.access_control_items;
create trigger trg_access_control_items_atomic_audit
  after insert or update or delete on public.access_control_items
  for each row execute function public.audit_sensitive_table_change();

alter table public.access_requests
  alter column access_level drop not null;
alter table public.access_requests
  drop constraint if exists access_requests_access_level_check;
alter table public.access_requests
  add constraint access_requests_access_level_legacy_check
  check (access_level is null or access_level in ('Standard', 'Admin'));

alter table public.access_requests
  add column if not exists subject_user_id uuid references public.profiles(id) on delete restrict,
  add column if not exists access_item_id uuid references public.access_control_items(id) on delete restrict,
  add column if not exists requested_actions text[] not null default array[]::text[],
  add column if not exists temporary_access boolean not null default false,
  add column if not exists start_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists data_classification text,
  add column if not exists privileged_access boolean not null default false,
  add column if not exists business_reason text,
  add column if not exists system_owner_id uuid references public.profiles(id) on delete restrict,
  add column if not exists lifecycle_event text not null default 'manual',
  add column if not exists evidence_after_grant text;

update public.access_requests
set subject_user_id = requester_id
where subject_user_id is null;

update public.access_requests
set start_at = created_at
where start_at is null;

update public.access_requests
set business_reason = reason
where business_reason is null;

alter table public.access_requests
  alter column subject_user_id set not null,
  alter column start_at set not null,
  alter column business_reason set not null;

-- Keep the original direct-insert contract usable for existing integrations;
-- the API still supplies explicit snapshots for every new request.
alter table public.access_requests
  alter column subject_user_id set default auth.uid(),
  alter column start_at set default now(),
  alter column business_reason set default '';

alter table public.access_requests
  add constraint access_requests_actions_check check (
    requested_actions <@ array['read', 'create', 'update', 'delete', 'approve']::text[]
  ),
  add constraint access_requests_classification_check check (
    data_classification is null or data_classification in ('ไม่ลับ', 'ลับ', 'ลับมาก')
  ),
  add constraint access_requests_lifecycle_check check (
    lifecycle_event in ('manual', 'joiner', 'mover', 'leaver')
  ),
  add constraint access_requests_lifecycle_request_type_check check (
    (lifecycle_event = 'joiner' and request_type = 'ขอเพิ่มสิทธิ์')
    or (lifecycle_event = 'leaver' and request_type = 'เพิกถอนสิทธิ์')
    or lifecycle_event in ('manual', 'mover')
  ),
  add constraint access_requests_dates_check check (
    (temporary_access = false and expires_at is null)
    or (temporary_access = true and expires_at is not null and expires_at > start_at)
  ),
  add constraint access_requests_catalog_reference_check check (
    access_item_id is not null or access_level is not null
  );

create index if not exists access_requests_subject_user_id_idx on public.access_requests(subject_user_id);
create index if not exists access_requests_access_item_id_idx on public.access_requests(access_item_id);
create index if not exists access_requests_lifecycle_idx on public.access_requests(lifecycle_event, status);
create index if not exists access_requests_expiry_idx on public.access_requests(expires_at)
  where temporary_access = true;

alter table public.user_access_registry
  alter column access_level drop not null;
alter table public.user_access_registry
  drop constraint if exists user_access_registry_access_level_check;
alter table public.user_access_registry
  add constraint user_access_registry_access_level_legacy_check
  check (access_level is null or access_level in ('Standard', 'Admin'));
alter table public.user_access_registry
  drop constraint if exists user_access_registry_status_check;
alter table public.user_access_registry
  add constraint user_access_registry_status_check
  check (status in ('active', 'scheduled', 'revoked', 'suspended'));

alter table public.user_access_registry
  add column if not exists access_item_id uuid references public.access_control_items(id) on delete restrict,
  add column if not exists permission_actions text[] not null default array[]::text[],
  add column if not exists temporary_access boolean not null default false,
  add column if not exists start_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists data_classification text,
  add column if not exists privileged_access boolean not null default false,
  add column if not exists business_reason text,
  add column if not exists system_owner_id uuid references public.profiles(id) on delete restrict,
  add column if not exists approved_by uuid references public.profiles(id) on delete restrict,
  add column if not exists lifecycle_event text not null default 'manual',
  add column if not exists evidence_after_grant text;

update public.user_access_registry
set start_at = grant_date
where start_at is null;

alter table public.user_access_registry
  alter column start_at set not null;

alter table public.user_access_registry
  alter column start_at set default now();

alter table public.user_access_registry
  add constraint user_access_registry_actions_check check (
    permission_actions <@ array['read', 'create', 'update', 'delete', 'approve']::text[]
  ),
  add constraint user_access_registry_classification_check check (
    data_classification is null or data_classification in ('ไม่ลับ', 'ลับ', 'ลับมาก')
  ),
  add constraint user_access_registry_lifecycle_check check (
    lifecycle_event in ('manual', 'joiner', 'mover', 'leaver')
  ),
  add constraint user_access_registry_dates_check check (
    (temporary_access = false and expires_at is null)
    or (temporary_access = true and expires_at is not null and expires_at > start_at)
  );

create index if not exists user_access_registry_access_item_id_idx on public.user_access_registry(access_item_id);
create index if not exists user_access_registry_expiry_idx on public.user_access_registry(expires_at)
  where temporary_access = true;
drop index if exists user_access_registry_active_item_uidx;
create unique index user_access_registry_active_item_uidx
  on public.user_access_registry(user_id, access_item_id)
  where status in ('active', 'scheduled') and access_item_id is not null;

alter table public.access_control_items enable row level security;

create policy access_control_items_select_with_access_permission on public.access_control_items
  for select to authenticated using (
    public.has_permission('access_request.view')
    or public.has_permission('access_request.create')
    or public.has_permission('access_system.manage')
  );

create policy access_control_items_write_with_permission on public.access_control_items
  for all to authenticated
  using (public.has_permission('access_system.manage'))
  with check (public.has_permission('access_system.manage'));

-- Database-level SoD guard. API checks provide friendly messages; this trigger
-- protects direct PostgREST/RPC writes and future fulfillment integrations too.
create or replace function public.enforce_access_request_sod()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.approver_id = coalesce(new.subject_user_id, new.requester_id)
     or new.approver_id = new.requester_id then
    raise exception using errcode = '23514', message = 'ACCESS_REQUEST_SOD_REQUESTER_APPROVER';
  end if;

  if new.approved_by is not null
     and new.approved_by = coalesce(new.subject_user_id, new.requester_id) then
    raise exception using errcode = '23514', message = 'ACCESS_REQUEST_SOD_SELF_APPROVAL';
  end if;

  if new.it_handler_id is not null
     and new.approved_by is not null
     and new.it_handler_id = new.approved_by then
    raise exception using errcode = '23514', message = 'ACCESS_REQUEST_SOD_APPROVER_OPERATOR';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_access_requests_sod on public.access_requests;
create trigger trg_access_requests_sod
  before insert or update on public.access_requests
  for each row execute function public.enforce_access_request_sod();

create or replace function public.enforce_access_registry_sod()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.approved_by is not null
     and new.granted_by is not null
     and new.approved_by = new.granted_by then
    raise exception using errcode = '23514', message = 'ACCESS_REGISTRY_SOD_APPROVER_OPERATOR';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_user_access_registry_sod on public.user_access_registry;
create trigger trg_user_access_registry_sod
  before insert or update on public.user_access_registry
  for each row execute function public.enforce_access_registry_sod();

comment on table public.access_control_items is
  'Configurable RBAC Role/Profile/Group/Entitlement catalog per system.';
comment on column public.access_requests.evidence_after_grant is
  'Evidence reference captured after the operator fulfills the request.';
comment on column public.access_requests.lifecycle_event is
  'Joiner, Mover, Leaver or manual access lifecycle context.';

create or replace function public.expire_temporary_access()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected integer;
begin
  update public.user_access_registry
  set status = 'active',
      updated_at = now()
  where status = 'scheduled'
    and start_at <= now()
    and (expires_at is null or expires_at > now());

  update public.user_access_registry
  set status = 'revoked',
      notes = coalesce(nullif(notes, ''), '') || case when coalesce(notes, '') = '' then '' else ' · ' end || 'หมดอายุอัตโนมัติ',
      updated_at = now()
  where status in ('active', 'scheduled')
    and temporary_access = true
    and expires_at is not null
    and expires_at <= now();
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.expire_temporary_access() from public, anon, authenticated;
grant execute on function public.expire_temporary_access() to service_role;

comment on function public.expire_temporary_access() is
  'Activates scheduled grants and atomically revokes temporary access after expiry; callable by the scheduled service-role worker.';
