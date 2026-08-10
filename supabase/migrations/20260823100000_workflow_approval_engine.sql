-- ============================================================================
-- Phase 6 Module 17: Central Workflow / Approval Engine
-- Immutable definition versions, ordered ANY/ALL/QUORUM steps, decisions,
-- delegations and an append-only business timeline.
-- ============================================================================

create table public.workflow_definitions (
  id uuid primary key default gen_random_uuid(),
  workflow_code text not null unique check (workflow_code ~ '^[A-Z0-9][A-Z0-9_-]{2,79}$'),
  workflow_name text not null,
  module_key text not null check (module_key ~ '^[a-z][a-z0-9_]{1,79}$'),
  description text,
  version integer not null default 1 check (version >= 1),
  trigger_event text not null default 'MANUAL',
  mode text not null default 'SEQUENTIAL' check (mode = 'SEQUENTIAL'),
  conditions jsonb not null default '{}'::jsonb check (jsonb_typeof(conditions) = 'object'),
  sla_hours integer not null default 72 check (sla_hours between 1 and 8760),
  is_default boolean not null default false,
  status text not null default 'ร่าง' check (status in ('ร่าง', 'ใช้งาน', 'ระงับ', 'ยกเลิก')),
  active_from timestamptz,
  active_to timestamptz,
  notes text,
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint workflow_definitions_active_range check (active_to is null or active_from is null or active_to >= active_from)
);

create table public.workflow_steps (
  id uuid primary key default gen_random_uuid(),
  definition_id uuid not null references public.workflow_definitions(id) on delete cascade,
  definition_version integer not null check (definition_version >= 1),
  step_order integer not null check (step_order between 1 and 100),
  step_code text not null check (step_code ~ '^[A-Z0-9][A-Z0-9_-]{1,79}$'),
  step_name text not null,
  approval_type text not null check (approval_type in ('USER', 'ROLE', 'GROUP')),
  approver_value text not null,
  mode text not null default 'ANY' check (mode in ('ANY', 'ALL', 'QUORUM')),
  min_approvals integer not null default 1 check (min_approvals between 1 and 100),
  condition jsonb not null default '{}'::jsonb check (jsonb_typeof(condition) = 'object'),
  sla_hours integer not null default 24 check (sla_hours between 1 and 8760),
  allow_delegation boolean not null default true,
  allow_return boolean not null default true,
  status text not null default 'ใช้งาน' check (status in ('ใช้งาน', 'ยกเลิก')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint workflow_steps_order_unique unique (definition_id, definition_version, step_order),
  constraint workflow_steps_code_unique unique (definition_id, definition_version, step_code)
);

create table public.workflow_instances (
  id uuid primary key default gen_random_uuid(),
  instance_code text not null unique,
  definition_id uuid not null references public.workflow_definitions(id) on delete restrict,
  definition_version integer not null check (definition_version >= 1),
  module_key text not null,
  record_id text not null,
  record_label text not null,
  requester_id uuid not null references public.profiles(id) on delete restrict,
  current_step_order integer,
  status text not null default 'กำลังดำเนินการ' check (status in ('กำลังดำเนินการ', 'อนุมัติแล้ว', 'ปฏิเสธ', 'ส่งกลับแก้ไข', 'ยกเลิก', 'ผิดพลาด')),
  started_at timestamptz not null default now(),
  due_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  idempotency_key text,
  notes text,
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint workflow_instances_completion_valid check ((status = 'กำลังดำเนินการ' and completed_at is null and cancelled_at is null) or status <> 'กำลังดำเนินการ'),
  constraint workflow_instances_record_unique unique (definition_id, definition_version, module_key, record_id)
);

create table public.workflow_approvals (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.workflow_instances(id) on delete cascade,
  step_id uuid not null references public.workflow_steps(id) on delete restrict,
  step_order integer not null,
  approver_id uuid not null references public.profiles(id) on delete restrict,
  original_approver_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'รอพิจารณา' check (status in ('รอพิจารณา', 'อนุมัติ', 'ปฏิเสธ', 'ส่งกลับแก้ไข', 'มอบหมายแทน', 'ข้าม', 'ยกเลิก')),
  decision text check (decision is null or decision in ('APPROVE', 'REJECT', 'RETURN')),
  comment text,
  due_at timestamptz,
  reminded_at timestamptz,
  escalated_at timestamptz,
  delegated_at timestamptz,
  decided_at timestamptz,
  decision_by uuid references public.profiles(id) on delete set null,
  signature_hash text,
  attachment_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(attachment_ids) = 'array'),
  revision integer not null default 1 check (revision >= 1),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint workflow_approvals_actor_unique unique (instance_id, step_id, original_approver_id),
  constraint workflow_approvals_decision_consistent check ((status = 'รอพิจารณา' and decision is null and decided_at is null) or status <> 'รอพิจารณา')
);

create table public.workflow_history (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.workflow_instances(id) on delete cascade,
  approval_id uuid references public.workflow_approvals(id) on delete set null,
  action text not null,
  step_order integer,
  status_from text,
  status_to text,
  actor_id uuid references public.profiles(id) on delete set null,
  comment text,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  is_public boolean not null default true,
  action_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.workflow_delegations (
  id uuid primary key default gen_random_uuid(),
  delegator_id uuid not null references public.profiles(id) on delete cascade,
  delegate_id uuid not null references public.profiles(id) on delete cascade,
  module_key text,
  definition_id uuid references public.workflow_definitions(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  reason text not null,
  status text not null default 'Active' check (status in ('Active', 'Revoked')),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  revoke_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint workflow_delegations_not_self check (delegator_id <> delegate_id),
  constraint workflow_delegations_range check (end_at > start_at),
  constraint workflow_delegations_revoke_consistent check ((status = 'Active' and revoked_at is null) or (status = 'Revoked' and revoked_at is not null and revoked_by is not null))
);

create unique index workflow_definitions_default_module_unique on public.workflow_definitions (module_key) where is_default and status = 'ใช้งาน';
create unique index workflow_definitions_legacy_id_unique on public.workflow_definitions (legacy_id) where legacy_id is not null;
create unique index workflow_instances_idempotency_unique on public.workflow_instances (idempotency_key) where idempotency_key is not null;
create unique index workflow_instances_legacy_id_unique on public.workflow_instances (legacy_id) where legacy_id is not null;
create index workflow_steps_definition_version_idx on public.workflow_steps (definition_id, definition_version, step_order);
create index workflow_instances_requester_status_idx on public.workflow_instances (requester_id, status, started_at desc);
create index workflow_instances_status_due_idx on public.workflow_instances (status, due_at) where status = 'กำลังดำเนินการ';
create index workflow_approvals_actor_status_idx on public.workflow_approvals (approver_id, status, due_at);
create index workflow_approvals_instance_step_idx on public.workflow_approvals (instance_id, step_order);
create index workflow_history_instance_time_idx on public.workflow_history (instance_id, action_at);
create index workflow_delegations_lookup_idx on public.workflow_delegations (delegator_id, status, start_at, end_at);

create trigger trg_workflow_definitions_updated_at before update on public.workflow_definitions for each row execute function public.set_updated_at();
create trigger trg_workflow_steps_updated_at before update on public.workflow_steps for each row execute function public.set_updated_at();
create trigger trg_workflow_instances_updated_at before update on public.workflow_instances for each row execute function public.set_updated_at();
create trigger trg_workflow_approvals_updated_at before update on public.workflow_approvals for each row execute function public.set_updated_at();
create trigger trg_workflow_delegations_updated_at before update on public.workflow_delegations for each row execute function public.set_updated_at();

alter table public.workflow_definitions enable row level security;
alter table public.workflow_steps enable row level security;
alter table public.workflow_instances enable row level security;
alter table public.workflow_approvals enable row level security;
alter table public.workflow_history enable row level security;
alter table public.workflow_delegations enable row level security;

create or replace function public.can_view_workflow_instance(instance_id_input uuid)
returns boolean language sql security definer stable set search_path = public
as $$
  select public.has_permission('workflow.view') and (
    public.has_permission('workflow.view_all') or public.has_permission('workflow.manage') or
    exists (select 1 from public.workflow_instances i where i.id = instance_id_input and i.requester_id = auth.uid()) or
    exists (select 1 from public.workflow_approvals a where a.instance_id = instance_id_input and (a.approver_id = auth.uid() or a.original_approver_id = auth.uid()))
  );
$$;

revoke all on function public.can_view_workflow_instance(uuid) from public;
grant execute on function public.can_view_workflow_instance(uuid) to authenticated;

create policy workflow_definitions_select on public.workflow_definitions for select to authenticated
  using (public.has_permission('workflow.manage') or (public.has_permission('workflow.view') and status = 'ใช้งาน'));
create policy workflow_definitions_write on public.workflow_definitions for all to authenticated
  using (public.has_permission('workflow.manage')) with check (public.has_permission('workflow.manage'));
create policy workflow_steps_select on public.workflow_steps for select to authenticated
  using (exists (select 1 from public.workflow_definitions d where d.id = definition_id));
create policy workflow_steps_write on public.workflow_steps for all to authenticated
  using (public.has_permission('workflow.manage')) with check (public.has_permission('workflow.manage'));
create policy workflow_instances_select on public.workflow_instances for select to authenticated
  using (public.can_view_workflow_instance(id));
create policy workflow_instances_write on public.workflow_instances for all to authenticated
  using (public.has_permission('workflow.manage')) with check (public.has_permission('workflow.manage'));
create policy workflow_approvals_select on public.workflow_approvals for select to authenticated
  using (public.can_view_workflow_instance(instance_id));
create policy workflow_approvals_update_assignee on public.workflow_approvals for update to authenticated
  using (public.has_permission('workflow.approve') and approver_id = auth.uid())
  with check (public.has_permission('workflow.approve') and approver_id = auth.uid());
create policy workflow_history_select on public.workflow_history for select to authenticated
  using (public.can_view_workflow_instance(instance_id) and (is_public or public.has_permission('workflow.manage')));
create policy workflow_history_write_manage on public.workflow_history for insert to authenticated
  with check (public.has_permission('workflow.manage'));
create policy workflow_delegations_select on public.workflow_delegations for select to authenticated
  using (public.has_permission('workflow.manage') or (public.has_permission('workflow.view') and (delegator_id = auth.uid() or delegate_id = auth.uid())));
create policy workflow_delegations_insert on public.workflow_delegations for insert to authenticated
  with check (public.has_permission('workflow.delegate') and delegator_id = auth.uid());
create policy workflow_delegations_update on public.workflow_delegations for update to authenticated
  using (public.has_permission('workflow.manage') or (public.has_permission('workflow.delegate') and delegator_id = auth.uid()))
  with check (public.has_permission('workflow.manage') or (public.has_permission('workflow.delegate') and delegator_id = auth.uid()));
