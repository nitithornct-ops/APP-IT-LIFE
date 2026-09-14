-- System Settings governance: version history, dependency metadata, approval queue,
-- and deployment environment context. Secret material remains deployment-managed.

alter table public.system_settings
  add column if not exists config_version integer not null default 1,
  add column if not exists criticality text not null default 'standard',
  add column if not exists depends_on text[] not null default '{}',
  add column if not exists requires_approval boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'system_settings_criticality_valid'
  ) then
    alter table public.system_settings
      add constraint system_settings_criticality_valid
      check (criticality in ('standard', 'critical'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'system_settings_dependencies_valid'
  ) then
    alter table public.system_settings
      add constraint system_settings_dependencies_valid
      check (cardinality(depends_on) <= 10);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'system_settings_config_version_valid'
  ) then
    alter table public.system_settings
      add constraint system_settings_config_version_valid
      check (config_version >= 1);
  end if;
end;
$$;

create table if not exists public.system_setting_versions (
  id uuid primary key default gen_random_uuid(),
  setting_key text not null references public.system_settings(key) on delete cascade,
  version integer not null check (version >= 1),
  value text not null,
  previous_value text,
  change_type text not null default 'update' check (change_type in ('initial', 'update', 'restore')),
  source_version integer,
  changed_by uuid references public.profiles(id) on delete set null,
  environment_label text not null default 'unknown' check (environment_label in ('dev', 'uat', 'prod', 'unknown')),
  created_at timestamptz not null default now(),
  constraint system_setting_versions_unique unique (setting_key, version),
  constraint system_setting_versions_source_valid check (source_version is null or source_version >= 1)
);

create index if not exists system_setting_versions_key_created_idx
  on public.system_setting_versions (setting_key, version desc);

create table if not exists public.system_setting_change_requests (
  id uuid primary key default gen_random_uuid(),
  setting_key text not null references public.system_settings(key) on delete cascade,
  requested_value text not null,
  base_version integer not null check (base_version >= 1),
  change_type text not null default 'update' check (change_type in ('update', 'restore')),
  source_version integer,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  approval_comment text check (approval_comment is null or char_length(approval_comment) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint system_setting_change_requests_source_valid check (source_version is null or source_version >= 1),
  constraint system_setting_change_requests_decision_valid check (
    status = 'pending'
    or (status in ('approved', 'rejected') and approved_by is not null and approved_at is not null)
    or (status = 'cancelled' and approved_by is null and approved_at is null)
  ),
  constraint system_setting_change_requests_sod check (approved_by is null or approved_by <> requested_by)
);

create unique index if not exists system_setting_change_requests_pending_unique
  on public.system_setting_change_requests (setting_key)
  where status = 'pending';
create index if not exists system_setting_change_requests_status_created_idx
  on public.system_setting_change_requests (status, created_at desc);

drop trigger if exists trg_system_setting_change_requests_set_updated_at on public.system_setting_change_requests;
create trigger trg_system_setting_change_requests_set_updated_at
  before update on public.system_setting_change_requests
  for each row execute function public.set_updated_at();

-- Rows added by later migrations receive an initial snapshot automatically.
create or replace function public.record_system_setting_initial_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.system_setting_versions (setting_key, version, value, change_type, environment_label)
  values (new.key, new.config_version, new.value, 'initial', 'unknown')
  on conflict (setting_key, version) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_system_setting_initial_version on public.system_settings;
create trigger trg_system_setting_initial_version
  after insert on public.system_settings
  for each row execute function public.record_system_setting_initial_version();

insert into public.system_setting_versions (setting_key, version, value, change_type, environment_label)
select key, config_version, value, 'initial', 'unknown'
from public.system_settings
on conflict (setting_key, version) do nothing;

-- Keep the first release conservative: only operationally sensitive settings need
-- a second person to approve the change. This does not expose or manage secrets.
update public.system_settings
set criticality = case
  when key in (
    'RETENTION_MODE', 'RETENTION_TRASH_EVIDENCE',
    'PUBLIC_PRIVACY_NOTICE_VERSION', 'PUBLIC_PRIVACY_NOTICE_TEXT',
    'PUBLIC_PRIVACY_NOTICE_URL', 'PUBLIC_PRIVACY_DPO_CONTACT'
  ) then 'critical'
  else 'standard'
end,
requires_approval = key in (
  'RETENTION_MODE', 'RETENTION_TRASH_EVIDENCE',
  'PUBLIC_PRIVACY_NOTICE_VERSION', 'PUBLIC_PRIVACY_NOTICE_TEXT',
  'PUBLIC_PRIVACY_NOTICE_URL', 'PUBLIC_PRIVACY_DPO_CONTACT'
),
depends_on = case
  when key = 'RETENTION_TRASH_EVIDENCE' then array['RETENTION_MODE']::text[]
  when key = 'AUTO_RESTORE_DRILL_ENABLED' then array['AUTO_BACKUP_ENABLED']::text[]
  when key = 'PUBLIC_PRIVACY_NOTICE_URL' then array['PUBLIC_PRIVACY_NOTICE_VERSION']::text[]
  else '{}'::text[]
end
where key in (
  'RETENTION_MODE', 'RETENTION_TRASH_EVIDENCE', 'PUBLIC_PRIVACY_NOTICE_VERSION',
  'PUBLIC_PRIVACY_NOTICE_TEXT', 'PUBLIC_PRIVACY_NOTICE_URL', 'PUBLIC_PRIVACY_DPO_CONTACT',
  'AUTO_RESTORE_DRILL_ENABLED'
);

insert into public.permissions (key, module_key, action, description, status)
values ('setting.approve', 'setting', 'approve', 'อนุมัติการเปลี่ยนค่าตั้งค่าระดับ Critical', 'active')
on conflict (key) do update set description = excluded.description, status = excluded.status;

insert into public.role_permissions (role_id, permission_id, effect)
select r.id, p.id, 'allow'
from public.roles r
cross join public.permissions p
where r.key in ('super_admin', 'it_admin')
  and p.key = 'setting.approve'
on conflict (role_id, permission_id) do update set effect = 'allow';

insert into public.role_permissions (role_id, permission_id, effect)
select r.id, p.id, 'allow'
from public.roles r
cross join public.permissions p
where r.key in ('approver', 'executive')
  and p.key in ('setting.view', 'setting.approve')
on conflict (role_id, permission_id) do update set effect = 'allow';

alter table public.system_setting_versions enable row level security;
alter table public.system_setting_change_requests enable row level security;

drop policy if exists system_setting_versions_select_with_permission on public.system_setting_versions;
create policy system_setting_versions_select_with_permission
  on public.system_setting_versions for select to authenticated
  using (public.has_permission('setting.view'));

drop policy if exists system_setting_change_requests_select_with_permission on public.system_setting_change_requests;
create policy system_setting_change_requests_select_with_permission
  on public.system_setting_change_requests for select to authenticated
  using (public.has_permission('setting.view'));

-- Writes are intentionally server-side only. The API checks the caller's
-- setting.manage/setting.approve permission before using the service role RPCs.

create or replace function public.apply_system_setting_change(
  setting_key_input text,
  proposed_value_input text,
  actor_id_input uuid,
  environment_label_input text,
  change_type_input text default 'update',
  source_version_input integer default null,
  change_request_id_input uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.system_settings%rowtype;
  updated_row public.system_settings%rowtype;
  next_version integer;
  source_exists boolean;
begin
  if change_type_input not in ('update', 'restore') then
    raise exception 'SETTING_CHANGE_TYPE_INVALID';
  end if;
  if environment_label_input not in ('dev', 'uat', 'prod', 'unknown') then
    raise exception 'SETTING_ENVIRONMENT_INVALID';
  end if;
  if change_type_input = 'restore' and source_version_input is null then
    raise exception 'SETTING_RESTORE_VERSION_REQUIRED';
  end if;

  select * into current_row
  from public.system_settings
  where key = upper(btrim(setting_key_input))
  for update;
  if not found then raise exception 'SETTING_NOT_FOUND'; end if;
  if not current_row.is_editable then raise exception 'SETTING_READ_ONLY'; end if;
  if source_version_input is not null then
    select exists (
      select 1 from public.system_setting_versions
      where setting_key = current_row.key
        and version = source_version_input
        and version < current_row.config_version
    ) into source_exists;
    if not source_exists then raise exception 'SETTING_RESTORE_VERSION_INVALID'; end if;
  end if;
  if current_row.value = proposed_value_input then
    return jsonb_build_object('status', 'unchanged', 'setting', to_jsonb(current_row));
  end if;

  next_version := current_row.config_version + 1;
  update public.system_settings
  set value = proposed_value_input,
      config_version = next_version,
      updated_by = actor_id_input
  where key = current_row.key
  returning * into updated_row;

  insert into public.system_setting_versions (
    setting_key, version, value, previous_value, change_type, source_version,
    changed_by, environment_label
  ) values (
    updated_row.key, next_version, updated_row.value, current_row.value,
    change_type_input, source_version_input, actor_id_input, environment_label_input
  );

  return jsonb_build_object(
    'status', 'applied',
    'setting', to_jsonb(updated_row),
    'changeRequestId', change_request_id_input
  );
end;
$$;

create or replace function public.decide_system_setting_change(
  change_request_id_input uuid,
  approver_id_input uuid,
  decision_input text,
  approval_comment_input text default null,
  environment_label_input text default 'unknown'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.system_setting_change_requests%rowtype;
  current_row public.system_settings%rowtype;
  updated_row public.system_settings%rowtype;
  next_version integer;
begin
  if decision_input not in ('approve', 'reject') then raise exception 'SETTING_DECISION_INVALID'; end if;
  if environment_label_input not in ('dev', 'uat', 'prod', 'unknown') then raise exception 'SETTING_ENVIRONMENT_INVALID'; end if;
  if approval_comment_input is not null and char_length(approval_comment_input) > 1000 then raise exception 'SETTING_APPROVAL_COMMENT_TOO_LONG'; end if;

  select * into request_row
  from public.system_setting_change_requests
  where id = change_request_id_input
  for update;
  if not found then raise exception 'SETTING_CHANGE_REQUEST_NOT_FOUND'; end if;
  if request_row.status <> 'pending' then raise exception 'SETTING_CHANGE_REQUEST_NOT_PENDING'; end if;
  if request_row.requested_by = approver_id_input then raise exception 'SETTING_APPROVAL_SOD'; end if;

  if decision_input = 'reject' then
    update public.system_setting_change_requests
    set status = 'rejected', approved_by = approver_id_input,
        approved_at = now(), approval_comment = nullif(btrim(approval_comment_input), '')
    where id = request_row.id
    returning * into request_row;
    return jsonb_build_object('status', 'rejected', 'request', to_jsonb(request_row));
  end if;

  select * into current_row
  from public.system_settings
  where key = request_row.setting_key
  for update;
  if not found then raise exception 'SETTING_NOT_FOUND'; end if;
  if not current_row.is_editable then raise exception 'SETTING_READ_ONLY'; end if;
  if current_row.config_version <> request_row.base_version then raise exception 'SETTING_CHANGE_STALE'; end if;
  if current_row.value = request_row.requested_value then
    update public.system_setting_change_requests
    set status = 'approved', approved_by = approver_id_input,
        approved_at = now(), approval_comment = nullif(btrim(approval_comment_input), '')
    where id = request_row.id
    returning * into request_row;
    return jsonb_build_object('status', 'unchanged', 'request', to_jsonb(request_row), 'setting', to_jsonb(current_row));
  end if;

  next_version := current_row.config_version + 1;
  update public.system_settings
  set value = request_row.requested_value,
      config_version = next_version,
      updated_by = approver_id_input
  where key = current_row.key
  returning * into updated_row;

  insert into public.system_setting_versions (
    setting_key, version, value, previous_value, change_type, source_version,
    changed_by, environment_label
  ) values (
    updated_row.key, next_version, updated_row.value, current_row.value,
    request_row.change_type, request_row.source_version, approver_id_input, environment_label_input
  );

  update public.system_setting_change_requests
  set status = 'approved', approved_by = approver_id_input,
      approved_at = now(), approval_comment = nullif(btrim(approval_comment_input), '')
  where id = request_row.id
  returning * into request_row;

  return jsonb_build_object('status', 'approved', 'request', to_jsonb(request_row), 'setting', to_jsonb(updated_row));
end;
$$;

revoke all on function public.apply_system_setting_change(text, text, uuid, text, text, integer, uuid) from public;
revoke all on function public.decide_system_setting_change(uuid, uuid, text, text, text) from public;
grant execute on function public.apply_system_setting_change(text, text, uuid, text, text, integer, uuid) to service_role;
grant execute on function public.decide_system_setting_change(uuid, uuid, text, text, text) to service_role;
