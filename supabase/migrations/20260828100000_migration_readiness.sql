-- Phase 7 — Data migration readiness
--
-- Every imported UUID row keeps both the legacy source sheet and its legacy key.
-- This makes reconciliation and rollback evidence possible without using legacy IDs
-- as PostgreSQL primary keys. The migration is idempotent and does not import data.

create table if not exists public.line_users (
  id uuid primary key default gen_random_uuid(),
  legacy_source text,
  legacy_id text,
  line_user_id text not null unique,
  display_name text,
  picture_url text,
  employee_code text,
  linked_user_id uuid references public.profiles(id) on delete set null,
  full_name text,
  department text,
  link_status text,
  friend_status text,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint line_users_legacy_identity_unique unique (legacy_source, legacy_id)
);

create index if not exists line_users_employee_code_idx on public.line_users (employee_code);
create index if not exists line_users_linked_user_id_idx on public.line_users (linked_user_id);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_line_users_set_updated_at') then
    create trigger trg_line_users_set_updated_at
      before update on public.line_users
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- No authenticated policies are intentional: LINE identity data is accessed only by
-- trusted server-side flows using the service role. Legacy LineSessions are not migrated.
alter table public.line_users enable row level security;

do $$
declare
  target_table text;
  target_tables text[] := array[
    'profiles', 'user_roles',
    'workflow_definitions', 'workflow_steps', 'workflow_instances', 'workflow_approvals',
    'workflow_history', 'workflow_delegations',
    'file_attachments', 'record_links',
    'permissions', 'role_permissions', 'user_permission_overrides',
    'approval_groups', 'approval_group_members',
    'task_links', 'task_progress_logs', 'task_subtasks',
    'governance_documents', 'regulatory_notifications',
    'legal_register', 'compliance_obligations', 'compliance_assessments',
    'compliance_corrective_actions', 'governance_retention_runs',
    'employee_lifecycle_events', 'employee_assignments', 'employees', 'line_users',
    'audit_logs', 'personal_tasks', 'tickets', 'ticket_categories', 'ticket_worklogs',
    'knowledge_articles', 'assets', 'asset_categories', 'asset_movements',
    'maintenance_plans', 'pm_checklist_templates', 'inventory_items', 'inventory_transactions',
    'software_licenses', 'governance_data_assets', 'data_destruction_requests',
    'access_requests', 'user_access_registry', 'change_requests', 'backup_logs',
    'recovery_tests', 'bcp_plans', 'logging_systems', 'log_reviews', 'incidents',
    'governance_risks', 'vendors', 'governance_ai_tools', 'governance_cloud_services',
    'governance_training_plans', 'governance_training_records', 'policy_acknowledgements',
    'notifications', 'governance_controls', 'privacy_ropa', 'privacy_consents', 'privacy_dsr',
    'problems', 'known_errors', 'vulnerability_findings', 'audit_engagements', 'audit_findings',
    'configuration_items', 'ci_relationships', 'service_catalog', 'service_requests',
    'service_request_tasks', 'service_request_history'
  ];
begin
  foreach target_table in array target_tables loop
    execute format('alter table public.%I add column if not exists legacy_source text', target_table);
    execute format('alter table public.%I add column if not exists legacy_id text', target_table);
    execute format(
      'create unique index if not exists %I on public.%I (legacy_source, legacy_id) where legacy_id is not null',
      target_table || '_legacy_identity_uidx',
      target_table
    );
  end loop;
end $$;

comment on column public.line_users.legacy_source is 'Legacy sheet name used for migration reconciliation';
comment on column public.line_users.legacy_id is 'Legacy row identifier preserved alongside the UUID primary key';
