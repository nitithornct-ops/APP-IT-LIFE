-- P0 Integration Center: data-driven notification rules, templates, channel governance,
-- connection telemetry and a durable dead-letter register.

create table public.notification_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null,
  name text not null,
  channel text not null check (channel in ('in-app','line-messaging','smtp','teams','webhook')),
  subject text,
  body text not null,
  variables jsonb not null default '[]'::jsonb check (jsonb_typeof(variables) = 'array'),
  version integer not null default 1 check (version > 0),
  status text not null default 'ACTIVE' check (status in ('DRAFT','ACTIVE','RETIRED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint notification_templates_key_version_unique unique (template_key, version)
);

create table public.notification_rules (
  id uuid primary key default gen_random_uuid(),
  rule_code text not null unique,
  event_key text not null,
  module_key text not null,
  severity text not null check (severity in ('INFO','WARNING','ERROR','CRITICAL')),
  channel text not null check (channel in ('in-app','line-messaging','smtp','teams','webhook')),
  recipient text not null,
  template_id uuid references public.notification_templates(id) on delete set null,
  enabled boolean not null default true,
  quiet_hours jsonb not null default '{"enabled":false,"start":"22:00","end":"07:00","timezone":"Asia/Bangkok"}'::jsonb check (jsonb_typeof(quiet_hours) = 'object'),
  retry_policy jsonb not null default '{"maxAttempts":5,"backoffSeconds":60}'::jsonb check (jsonb_typeof(retry_policy) = 'object'),
  fallback_channel text check (fallback_channel is null or fallback_channel in ('in-app','line-messaging','smtp','teams','webhook')),
  escalation_after_minutes integer check (escalation_after_minutes is null or escalation_after_minutes between 1 and 10080),
  escalation_recipient text,
  priority integer not null default 100 check (priority between 0 and 9999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint notification_rules_fallback_distinct check (fallback_channel is null or fallback_channel <> channel),
  constraint notification_rules_escalation_complete check (
    (escalation_after_minutes is null and escalation_recipient is null) or
    (escalation_after_minutes is not null and escalation_recipient is not null and length(trim(escalation_recipient)) > 0)
  )
);

create table public.integration_channels (
  channel_key text primary key check (channel_key in ('in-app','line-messaging','smtp','teams','webhook')),
  display_name text not null,
  enabled boolean not null default false,
  secret_reference text,
  webhook_signing_enabled boolean not null default false,
  idempotency_enabled boolean not null default true,
  rate_limit_per_minute integer not null default 60 check (rate_limit_per_minute between 1 and 100000),
  last_latency_ms integer check (last_latency_ms is null or last_latency_ms >= 0),
  last_successful_delivery_at timestamptz,
  last_tested_at timestamptz,
  last_test_status text check (last_test_status is null or last_test_status in ('PASS','FAIL','UNAVAILABLE')),
  last_test_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.integration_outbox
  add column if not exists delivery_channel text check (delivery_channel is null or delivery_channel in ('in-app','line-messaging','smtp','teams','webhook')),
  add column if not exists delivery_latency_ms integer check (delivery_latency_ms is null or delivery_latency_ms >= 0);

create table public.integration_dead_letters (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null unique references public.integration_outbox(id) on delete cascade,
  integration_code text not null,
  event_type text not null,
  channel text,
  attempt_count integer not null check (attempt_count >= 0),
  last_error text,
  dead_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notification_rules_event_idx on public.notification_rules(event_key, module_key, severity, priority, enabled);
create index notification_rules_channel_idx on public.notification_rules(channel, enabled);
create index notification_templates_active_idx on public.notification_templates(template_key, channel, status);
create index integration_dead_letters_open_idx on public.integration_dead_letters(dead_at desc) where resolved_at is null;

create or replace function public.capture_integration_dead_letter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'DEAD' and old.status is distinct from 'DEAD' then
    insert into public.integration_dead_letters(
      outbox_id, integration_code, event_type, channel, attempt_count, last_error, dead_at
    ) values (
      new.id, new.integration_code, new.event_type, new.delivery_channel,
      new.attempt_count, new.last_error, coalesce(new.updated_at, now())
    ) on conflict (outbox_id) do update set
      integration_code = excluded.integration_code,
      event_type = excluded.event_type,
      channel = excluded.channel,
      attempt_count = excluded.attempt_count,
      last_error = excluded.last_error,
      dead_at = excluded.dead_at,
      resolved_at = null,
      resolved_by = null,
      resolution_note = null;
  end if;
  return new;
end;
$$;

revoke all on function public.capture_integration_dead_letter() from public, anon, authenticated;
drop trigger if exists trg_integration_outbox_dead_letter on public.integration_outbox;
create trigger trg_integration_outbox_dead_letter
  after update of status on public.integration_outbox
  for each row
  when (new.status = 'DEAD' and old.status is distinct from 'DEAD')
  execute function public.capture_integration_dead_letter();

do $$
declare table_name text;
begin
  foreach table_name in array array['notification_templates','notification_rules','integration_channels','integration_dead_letters'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', 'trg_' || table_name || '_set_updated_at', table_name);
  end loop;
end $$;

alter table public.notification_templates enable row level security;
alter table public.notification_rules enable row level security;
alter table public.integration_channels enable row level security;
alter table public.integration_dead_letters enable row level security;

create policy notification_templates_select on public.notification_templates
  for select to authenticated using (public.has_permission('integration.view'));
create policy notification_templates_manage_insert on public.notification_templates
  for insert to authenticated with check (public.has_permission('integration.manage'));
create policy notification_templates_manage_update on public.notification_templates
  for update to authenticated using (public.has_permission('integration.manage')) with check (public.has_permission('integration.manage'));

create policy notification_rules_select on public.notification_rules
  for select to authenticated using (public.has_permission('integration.view'));
create policy notification_rules_manage_insert on public.notification_rules
  for insert to authenticated with check (public.has_permission('integration.manage'));
create policy notification_rules_manage_update on public.notification_rules
  for update to authenticated using (public.has_permission('integration.manage')) with check (public.has_permission('integration.manage'));

create policy integration_channels_select on public.integration_channels
  for select to authenticated using (public.has_permission('integration.view'));
create policy integration_channels_manage_insert on public.integration_channels
  for insert to authenticated with check (public.has_permission('integration.manage'));
create policy integration_channels_manage_update on public.integration_channels
  for update to authenticated using (public.has_permission('integration.manage')) with check (public.has_permission('integration.manage'));

create policy integration_dead_letters_select on public.integration_dead_letters
  for select to authenticated using (public.has_permission('integration.view'));
create policy integration_dead_letters_manage_update on public.integration_dead_letters
  for update to authenticated using (public.has_permission('integration.manage')) with check (public.has_permission('integration.manage'));

insert into public.integration_channels(
  channel_key, display_name, enabled, secret_reference, webhook_signing_enabled,
  idempotency_enabled, rate_limit_per_minute
) values
  ('in-app', 'In-app Notification', true, null, false, true, 600),
  ('line-messaging', 'LINE Messaging API', false, 'env:LINE_CHANNEL_ACCESS_TOKEN', false, true, 30),
  ('smtp', 'SMTP / Email', false, 'env:SMTP_*', false, true, 30),
  ('teams', 'Microsoft Teams', false, 'env:TEAMS_*', true, true, 30),
  ('webhook', 'Generic Webhook', false, 'env:WEBHOOK_*', true, true, 60)
on conflict (channel_key) do nothing;

insert into public.notification_templates(template_key, name, channel, subject, body, variables, version, status)
values
  ('ticket-update-line', 'Ticket update - LINE', 'line-messaging', null,
   'Ticket {{ticket_no}}\n{{title}}\nสถานะ: {{status}}\nผู้ดำเนินการ: {{assignee}}',
   '["ticket_no","title","status","assignee"]'::jsonb, 1, 'ACTIVE'),
  ('backup-critical-line', 'Backup failed - LINE', 'line-messaging', null,
   'CRITICAL: Backup {{system_name}} failed\nเหตุการณ์: {{event}}\nตรวจสอบภายใน {{escalation_minutes}} นาที',
   '["system_name","event","escalation_minutes"]'::jsonb, 1, 'ACTIVE'),
  ('backup-critical-email', 'Backup failed - Email', 'smtp', 'Critical backup failure',
   'Backup {{system_name}} failed. Please investigate immediately.',
   '["system_name"]'::jsonb, 1, 'ACTIVE')
on conflict (template_key, version) do nothing;

insert into public.notification_rules(
  rule_code, event_key, module_key, severity, channel, recipient, template_id,
  enabled, quiet_hours, retry_policy, fallback_channel, escalation_after_minutes,
  escalation_recipient, priority
)
select
  seed.rule_code,
  seed.event_key,
  seed.module_key,
  seed.severity,
  seed.channel,
  seed.recipient,
  t.id,
  seed.enabled,
  '{"enabled":false,"start":"22:00","end":"07:00","timezone":"Asia/Bangkok"}'::jsonb,
  '{"maxAttempts":5,"backoffSeconds":60}'::jsonb,
  case when seed.rule_code = 'backup-failed-critical-line' then 'smtp' else null end,
  case when seed.rule_code = 'backup-failed-critical-line' then 15 else null end,
  case when seed.rule_code = 'backup-failed-critical-line' then 'Manager' else null end,
  seed.priority
from (values
  ('ticket-created-team', 'ticket.created', 'tickets', 'INFO', 'line-messaging', 'LINE group: IT', 'ticket-update-line', true, 100),
  ('ticket-status-requester', 'ticket.status_changed', 'tickets', 'INFO', 'line-messaging', 'LINE requester', 'ticket-update-line', true, 110),
  ('access-request-approver', 'access_request.created', 'access_requests', 'WARNING', 'in-app', 'Approver group', null, true, 100),
  ('change-flow-operations', 'change.updated', 'changes', 'INFO', 'in-app', 'IT operations', null, true, 100),
  ('backup-failed-critical-line', 'backup.failed', 'backup_monitoring', 'CRITICAL', 'line-messaging', 'LINE group: IT', 'backup-critical-line', true, 10),
  ('backup-failed-critical-email', 'backup.failed', 'backup_monitoring', 'CRITICAL', 'smtp', 'Email: system administrators', 'backup-critical-email', true, 20)
) as seed(rule_code, event_key, module_key, severity, channel, recipient, template_key, enabled, priority)
left join public.notification_templates t on t.template_key = seed.template_key and t.version = 1
-- Keep the seed idempotent while resolving template references inside the database.
on conflict (rule_code) do nothing;

update public.notification_rules
set fallback_channel = case when rule_code = 'backup-failed-critical-line' then 'smtp' else fallback_channel end,
    escalation_after_minutes = case when rule_code = 'backup-failed-critical-line' then 15 else escalation_after_minutes end,
    escalation_recipient = case when rule_code = 'backup-failed-critical-line' then 'Manager' else escalation_recipient end
where rule_code = 'backup-failed-critical-line';

comment on table public.notification_rules is 'Admin-managed notification routing rules. Secrets are referenced by deployment key only and never stored here.';
comment on table public.notification_templates is 'Versioned channel templates with variable names only; no credentials or recipient secrets.';
comment on table public.integration_dead_letters is 'Dead-letter register for integration_outbox rows that exhausted their retry policy.';
comment on column public.integration_channels.secret_reference is 'Deployment secret name/reference only. Never store the secret value.';
