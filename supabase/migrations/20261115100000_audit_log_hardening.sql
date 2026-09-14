-- Audit evidence hardening: explicit event taxonomy, immutable hash evidence,
-- operational alerts, retention controls, and a non-destructive archive.

alter table public.audit_logs
  add column if not exists event_category text not null default 'system',
  add column if not exists privileged_action boolean not null default false,
  add column if not exists correlation_id text,
  add column if not exists entry_hash text,
  add column if not exists hash_algorithm text not null default 'sha256';

alter table public.login_logs
  add column if not exists event_type text not null default 'login_attempt',
  add column if not exists request_id text,
  add column if not exists correlation_id text,
  add column if not exists entry_hash text,
  add column if not exists hash_algorithm text not null default 'sha256';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'audit_logs_event_category_check' and conrelid = 'public.audit_logs'::regclass) then
    alter table public.audit_logs add constraint audit_logs_event_category_check
      check (event_category in ('authentication', 'authorization', 'data_change', 'privileged_action', 'administration', 'access_review', 'backup', 'export', 'security', 'system'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'audit_logs_hash_algorithm_check' and conrelid = 'public.audit_logs'::regclass) then
    alter table public.audit_logs add constraint audit_logs_hash_algorithm_check
      check (hash_algorithm in ('sha256', 'legacy'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'login_logs_event_type_check' and conrelid = 'public.login_logs'::regclass) then
    alter table public.login_logs add constraint login_logs_event_type_check
      check (event_type in ('login_attempt', 'logout', 'mfa_challenge', 'password_reset', 'password_change', 'session_refresh'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'login_logs_hash_algorithm_check' and conrelid = 'public.login_logs'::regclass) then
    alter table public.login_logs add constraint login_logs_hash_algorithm_check
      check (hash_algorithm in ('sha256', 'legacy'));
  end if;
end $$;

-- Classify pre-existing events without changing their original payload.
update public.audit_logs
set correlation_id = coalesce(correlation_id, request_id),
    event_category = case
      when upper(action) in ('LOGIN', 'LOGOUT', 'MFA_CHALLENGE', 'PASSWORD_RESET', 'PASSWORD_CHANGE')
        or lower(module) in ('auth', 'authentication', 'login') then 'authentication'
      when upper(action) in ('ACCESS_DENIED', 'PERMISSION_DENIED')
        or lower(module) in ('authorization', 'permission', 'rbac') then 'authorization'
      when upper(action) like 'EXPORT%' or lower(module) like '%export%' then 'export'
      when lower(module) like '%backup%' or lower(module) like '%recovery%' then 'backup'
      when lower(module) like '%access%review%' or lower(module) like '%certification%' then 'access_review'
      when upper(action) like '%PASSWORD%' or upper(action) like '%MFA%'
        or upper(action) like '%SECURITY%' then 'security'
      when upper(action) like '%ROLE%' or upper(action) like '%PERMISSION%'
        or lower(module) in ('admin', 'administration', 'settings', 'users') then 'administration'
      when upper(action) in ('CREATE', 'UPDATE', 'DELETE', 'INSERT', 'UPSERT')
        or upper(action) like 'CREATE_%' or upper(action) like 'UPDATE_%'
        or upper(action) like 'DELETE_%' then 'data_change'
      else 'system'
    end,
    privileged_action = (
      upper(action) in ('ACCESS_DENIED', 'PERMISSION_DENIED')
      or upper(action) like '%APPROV%'
      or upper(action) like '%REJECT%'
      or upper(action) like '%EXPORT%'
      or upper(action) like '%ARCHIVE%'
      or upper(action) like '%VERIFY%'
      or upper(action) like '%DEPLOY%'
      or upper(action) like '%ROLE%'
      or upper(action) like '%PERMISSION%'
      or upper(action) like '%PASSWORD%'
      or upper(action) like '%MFA%'
      or lower(module) in ('admin', 'administration', 'rbac', 'permission', 'audit', 'backup')
    ),
    hash_algorithm = case when entry_hash is null then 'legacy' else hash_algorithm end
where entry_hash is null or correlation_id is null or event_category = 'system';

update public.login_logs
set correlation_id = coalesce(correlation_id, request_id),
    hash_algorithm = case when entry_hash is null then 'legacy' else hash_algorithm end
where entry_hash is null or correlation_id is null;

create index if not exists audit_logs_event_category_idx on public.audit_logs (event_category, created_at desc);
create index if not exists audit_logs_privileged_action_idx on public.audit_logs (privileged_action, created_at desc);
create index if not exists audit_logs_request_id_idx on public.audit_logs (request_id) where request_id is not null;
create index if not exists audit_logs_correlation_id_idx on public.audit_logs (correlation_id) where correlation_id is not null;
create index if not exists audit_logs_entry_hash_idx on public.audit_logs (entry_hash) where entry_hash is not null;
create index if not exists login_logs_event_type_idx on public.login_logs (event_type, created_at desc);
create index if not exists login_logs_request_id_idx on public.login_logs (request_id) where request_id is not null;
create index if not exists login_logs_correlation_id_idx on public.login_logs (correlation_id) where correlation_id is not null;
create index if not exists login_logs_entry_hash_idx on public.login_logs (entry_hash) where entry_hash is not null;

-- A durable alert is created for failed/denied/privileged activity. The trigger
-- is deliberately fail-open so an alerting outage can never block audit capture.
create table if not exists public.audit_activity_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_key text not null unique,
  alert_type text not null check (alert_type in ('PRIVILEGED_ACTION', 'ACCESS_DENIED', 'ACTION_FAILURE', 'LOGIN_FAILURE')),
  severity text not null check (severity in ('high', 'critical')),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_email text,
  title text not null,
  message text not null,
  event_count integer not null default 1 check (event_count > 0),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  last_event_id uuid not null,
  last_request_id text,
  status text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists audit_activity_alerts_status_idx on public.audit_activity_alerts (status, last_seen_at desc);
create index if not exists audit_activity_alerts_type_idx on public.audit_activity_alerts (alert_type, last_seen_at desc);

create or replace function public.record_audit_activity_alert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_alert_type text;
  v_severity text;
  v_actor_id uuid;
  v_actor_email text;
  v_event_id uuid;
  v_event_at timestamptz;
  v_request_id text;
  v_alert_key text;
  v_title text;
  v_message text;
begin
  if tg_table_name = 'audit_logs' then
    if new.privileged_action then
      v_alert_type := 'PRIVILEGED_ACTION';
      v_severity := 'critical';
      v_title := 'Privileged action detected';
      v_message := coalesce(new.action, 'unknown action') || ' on ' || coalesce(new.module, 'unknown module');
    elsif new.result = 'denied' then
      v_alert_type := 'ACCESS_DENIED';
      v_severity := 'high';
      v_title := 'Access denied event';
      v_message := 'Denied ' || coalesce(new.action, 'unknown action') || ' on ' || coalesce(new.module, 'unknown module');
    elsif new.result = 'fail' then
      v_alert_type := 'ACTION_FAILURE';
      v_severity := 'high';
      v_title := 'Audit action failed';
      v_message := 'Failed ' || coalesce(new.action, 'unknown action') || ' on ' || coalesce(new.module, 'unknown module');
    else
      return new;
    end if;
    v_actor_id := new.actor_id;
    v_actor_email := new.actor_email;
    v_event_id := new.id;
    v_event_at := new.created_at;
    v_request_id := coalesce(new.request_id, new.correlation_id);
  else
    if new.success then
      return new;
    end if;
    v_alert_type := 'LOGIN_FAILURE';
    v_severity := 'high';
    v_title := 'Login attempt failed';
    v_message := 'Failed authentication attempt for ' || coalesce(new.email_attempted, 'unknown identity');
    v_actor_id := new.user_id;
    v_actor_email := new.email_attempted;
    v_event_id := new.id;
    v_event_at := new.created_at;
    v_request_id := coalesce(new.request_id, new.correlation_id);
  end if;

  v_alert_key := v_alert_type || ':' || coalesce(v_actor_id::text, lower(coalesce(v_actor_email, 'unknown')), 'unknown') || ':' || to_char(v_event_at at time zone 'UTC', 'YYYY-MM-DD');
  insert into public.audit_activity_alerts (
    alert_key, alert_type, severity, actor_id, actor_email, title, message,
    event_count, first_seen_at, last_seen_at, last_event_id, last_request_id
  ) values (
    v_alert_key, v_alert_type, v_severity, v_actor_id, v_actor_email, v_title, v_message,
    1, v_event_at, v_event_at, v_event_id, v_request_id
  )
  on conflict (alert_key) do update set
    event_count = public.audit_activity_alerts.event_count + 1,
    last_seen_at = excluded.last_seen_at,
    last_event_id = excluded.last_event_id,
    last_request_id = excluded.last_request_id,
    message = excluded.message,
    updated_at = now(),
    status = 'OPEN';
  return new;
exception when others then
  raise warning 'audit activity alert failed: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_audit_logs_activity_alert on public.audit_logs;
create trigger trg_audit_logs_activity_alert
  after insert on public.audit_logs
  for each row execute function public.record_audit_activity_alert();
drop trigger if exists trg_login_logs_activity_alert on public.login_logs;
create trigger trg_login_logs_activity_alert
  after insert on public.login_logs
  for each row execute function public.record_audit_activity_alert();

create trigger trg_audit_activity_alerts_set_updated_at
  before update on public.audit_activity_alerts
  for each row execute function public.set_updated_at();

alter table public.audit_activity_alerts enable row level security;
drop policy if exists audit_activity_alerts_select_with_permission on public.audit_activity_alerts;
create policy audit_activity_alerts_select_with_permission on public.audit_activity_alerts
  for select to authenticated using (public.has_permission('audit.view'));
grant select on public.audit_activity_alerts to authenticated;

-- Archive retains the original row as a JSON evidence record. Source audit and
-- login rows remain online and immutable, so archiving is recoverable and does
-- not weaken the primary evidence trail.
create table if not exists public.audit_log_archive (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null unique,
  recorded_at timestamptz not null,
  payload jsonb not null,
  checksum text not null,
  archived_at timestamptz not null default now(),
  archived_by uuid references auth.users(id) on delete set null
);
create table if not exists public.login_log_archive (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null unique,
  recorded_at timestamptz not null,
  payload jsonb not null,
  checksum text not null,
  archived_at timestamptz not null default now(),
  archived_by uuid references auth.users(id) on delete set null
);
create index if not exists audit_log_archive_recorded_at_idx on public.audit_log_archive (recorded_at desc);
create index if not exists login_log_archive_recorded_at_idx on public.login_log_archive (recorded_at desc);

alter table public.audit_log_archive enable row level security;
alter table public.login_log_archive enable row level security;
drop policy if exists audit_log_archive_select_with_permission on public.audit_log_archive;
create policy audit_log_archive_select_with_permission on public.audit_log_archive
  for select to authenticated using (public.has_permission('audit.view'));
drop policy if exists login_log_archive_select_with_permission on public.login_log_archive;
create policy login_log_archive_select_with_permission on public.login_log_archive
  for select to authenticated using (public.has_permission('audit.view'));
grant select on public.audit_log_archive to authenticated;
grant select on public.login_log_archive to authenticated;

create or replace function public.archive_audit_history(cutoff_input timestamptz)
returns table (audit_archived integer, login_archived integer)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  audit_count integer;
  login_count integer;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'AUDIT_ARCHIVE_FORBIDDEN';
  end if;
  if cutoff_input is null then
    raise exception using errcode = '22023', message = 'AUDIT_ARCHIVE_CUTOFF_REQUIRED';
  end if;

  insert into public.audit_log_archive (source_id, recorded_at, payload, checksum, archived_by)
  select id, created_at, to_jsonb(a), md5(to_jsonb(a)::text), auth.uid()
  from public.audit_logs a
  where created_at < cutoff_input
  on conflict (source_id) do nothing;
  get diagnostics audit_count = row_count;

  insert into public.login_log_archive (source_id, recorded_at, payload, checksum, archived_by)
  select id, created_at, to_jsonb(l), md5(to_jsonb(l)::text), auth.uid()
  from public.login_logs l
  where created_at < cutoff_input
  on conflict (source_id) do nothing;
  get diagnostics login_count = row_count;

  return query select audit_count, login_count;
end;
$$;
revoke all on function public.archive_audit_history(timestamptz) from public, anon, authenticated;
grant execute on function public.archive_audit_history(timestamptz) to service_role;

create table if not exists public.audit_retention_policies (
  id uuid primary key default gen_random_uuid(),
  policy_code text not null unique,
  audit_retention_days integer not null check (audit_retention_days between 30 and 36500),
  login_retention_days integer not null check (login_retention_days between 30 and 36500),
  archive_after_days integer not null check (archive_after_days between 1 and 36500),
  legal_hold boolean not null default false,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);
insert into public.audit_retention_policies (
  policy_code, audit_retention_days, login_retention_days, archive_after_days, notes
) values (
  'AUDIT-DEFAULT-7Y', 2555, 730, 365, 'Default audit evidence retention; adjust only through an approved governance change.'
)
on conflict (policy_code) do nothing;
alter table public.audit_retention_policies enable row level security;
drop policy if exists audit_retention_policies_select_with_permission on public.audit_retention_policies;
create policy audit_retention_policies_select_with_permission on public.audit_retention_policies
  for select to authenticated using (public.has_permission('audit.view'));
grant select on public.audit_retention_policies to authenticated;

create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception using errcode = '55000', message = 'AUDIT_LOG_IMMUTABLE';
end;
$$;

drop trigger if exists trg_audit_logs_immutable on public.audit_logs;
create trigger trg_audit_logs_immutable
  before update or delete on public.audit_logs
  for each row execute function public.prevent_audit_log_mutation();
drop trigger if exists trg_login_logs_immutable on public.login_logs;
create trigger trg_login_logs_immutable
  before update or delete on public.login_logs
  for each row execute function public.prevent_audit_log_mutation();

comment on table public.audit_activity_alerts is 'Operational alerts derived from privileged, denied, failed, and failed-authentication events.';
comment on table public.audit_log_archive is 'Non-destructive archive/evidence copy of immutable audit_logs rows.';
comment on table public.login_log_archive is 'Non-destructive archive/evidence copy of immutable login_logs rows.';
