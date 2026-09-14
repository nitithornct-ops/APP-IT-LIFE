-- Permission Matrix P1: approval gate for high-impact role permission changes.
-- Requests are append-only from the product point of view: the proposed matrix is
-- stored with the request and is applied only by the approval RPC.

create table if not exists public.role_permission_change_requests (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.roles(id) on delete cascade,
  base_version integer not null check (base_version > 0),
  requested_by uuid not null references public.profiles(id) on delete restrict,
  approver_id uuid not null references public.profiles(id) on delete restrict,
  proposed_permissions jsonb not null,
  changes jsonb not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decision_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint role_permission_change_requests_proposed_array check (jsonb_typeof(proposed_permissions) = 'array'),
  constraint role_permission_change_requests_changes_array check (jsonb_typeof(changes) = 'array'),
  constraint role_permission_change_requests_different_actors check (requested_by <> approver_id)
);

create unique index if not exists role_permission_change_requests_one_pending_per_role
  on public.role_permission_change_requests(role_id)
  where status = 'pending';
create index if not exists role_permission_change_requests_approver_status_idx
  on public.role_permission_change_requests(approver_id, status, requested_at desc);
create index if not exists role_permission_change_requests_role_requested_idx
  on public.role_permission_change_requests(role_id, requested_at desc);

drop trigger if exists trg_role_permission_change_requests_set_updated_at on public.role_permission_change_requests;
create trigger trg_role_permission_change_requests_set_updated_at
  before update on public.role_permission_change_requests
  for each row execute function public.set_updated_at();

alter table public.role_permission_change_requests enable row level security;
drop policy if exists role_permission_change_requests_select_with_role_view on public.role_permission_change_requests;
create policy role_permission_change_requests_select_with_role_view on public.role_permission_change_requests
  for select to authenticated
  using (public.has_permission('role.view') or public.has_permission('role.manage'));

-- The API uses the service-role client after checking role.manage and the named
-- approver. No direct authenticated writes are granted on this queue.
revoke all on table public.role_permission_change_requests from anon, authenticated;

create or replace function public.decide_role_permission_change_request(
  request_id_input uuid,
  actor_id_input uuid,
  decision_input text,
  comment_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_row public.role_permission_change_requests;
  role_row public.roles;
  next_version integer;
begin
  if decision_input not in ('approve', 'reject') then
    raise exception using errcode = '22023', message = 'ROLE_PERMISSION_REQUEST_DECISION_INVALID';
  end if;

  select * into request_row
  from public.role_permission_change_requests
  where id = request_id_input
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ROLE_PERMISSION_REQUEST_NOT_FOUND';
  end if;
  if request_row.status <> 'pending' then
    raise exception using errcode = '23514', message = 'ROLE_PERMISSION_REQUEST_ALREADY_DECIDED';
  end if;
  if request_row.approver_id <> actor_id_input then
    raise exception using errcode = '42501', message = 'ROLE_PERMISSION_APPROVER_MISMATCH';
  end if;

  if decision_input = 'reject' then
    update public.role_permission_change_requests
    set status = 'rejected', decided_at = now(), decision_comment = nullif(btrim(comment_input), '')
    where id = request_id_input;
    return jsonb_build_object('id', request_id_input, 'status', 'rejected');
  end if;

  select * into role_row from public.roles where id = request_row.role_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'ROLE_NOT_FOUND'; end if;
  if role_row.is_system then raise exception using errcode = '23514', message = 'SYSTEM_ROLE_LOCKED'; end if;
  if role_row.version <> request_row.base_version then
    raise exception using errcode = '40001', message = 'ROLE_PERMISSION_REQUEST_STALE';
  end if;

  delete from public.role_permissions where role_id = request_row.role_id;
  insert into public.role_permissions (role_id, permission_id, effect, created_by, updated_by)
  select request_row.role_id, item.permission_id, item.effect, actor_id_input, actor_id_input
  from jsonb_to_recordset(request_row.proposed_permissions) as item(permission_id uuid, effect text);

  next_version := role_row.version + 1;
  update public.roles set version = next_version, updated_by = actor_id_input where id = role_row.id;
  insert into public.role_versions (role_id, version_number, snapshot, change_type, change_summary, created_by)
  values (role_row.id, next_version, public.build_role_snapshot(role_row.id), 'PERMISSIONS', 'อนุมัติการเปลี่ยน Permission Matrix', actor_id_input);

  update public.role_permission_change_requests
  set status = 'approved', decided_at = now(), decision_comment = nullif(btrim(comment_input), '')
  where id = request_id_input;
  return jsonb_build_object('id', request_id_input, 'status', 'approved', 'version', next_version);
end;
$$;

revoke all on function public.decide_role_permission_change_request(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.decide_role_permission_change_request(uuid, uuid, text, text) to service_role;

