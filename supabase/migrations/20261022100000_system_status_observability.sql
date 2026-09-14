-- System Status observability: durable samples and automatically reconciled incidents.
-- These tables are service-role only. The API exposes a deliberately reduced internal view
-- to authenticated users and never returns payloads, URLs, credentials, or raw upstream errors.

create table if not exists public.system_status_checks (
  id uuid primary key default gen_random_uuid(),
  component text not null check (component in (
    'api', 'database', 'supabase_auth', 'storage', 'cloudflare_worker',
    'line_messaging', 'smtp', 'google_drive', 'scheduled_jobs', 'outbox_queue'
  )),
  status text not null check (status in ('operational', 'degraded', 'down', 'not_configured')),
  response_time_ms integer check (response_time_ms is null or response_time_ms >= 0),
  failure_reason text,
  source text not null default 'scheduled' check (source in ('scheduled', 'internal_request')),
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists system_status_checks_component_time_idx
  on public.system_status_checks (component, checked_at desc);

create table if not exists public.system_status_incidents (
  id uuid primary key default gen_random_uuid(),
  component text not null check (component in (
    'api', 'database', 'supabase_auth', 'storage', 'cloudflare_worker',
    'line_messaging', 'smtp', 'google_drive', 'scheduled_jobs', 'outbox_queue'
  )),
  status text not null default 'open' check (status in ('open', 'resolved')),
  severity text not null check (severity in ('minor', 'major', 'critical')),
  title text not null,
  summary text not null default '',
  started_at timestamptz not null,
  last_failure_at timestamptz not null,
  resolved_at timestamptz,
  failure_count integer not null default 1 check (failure_count > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint system_status_incidents_resolved_at_check check (
    (status = 'open' and resolved_at is null) or (status = 'resolved' and resolved_at is not null)
  )
);

create unique index if not exists system_status_incidents_one_open_component_idx
  on public.system_status_incidents (component) where status = 'open';
create index if not exists system_status_incidents_history_idx
  on public.system_status_incidents (started_at desc, component);

alter table public.system_status_checks enable row level security;
alter table public.system_status_incidents enable row level security;

drop policy if exists system_status_checks_service_role_only on public.system_status_checks;
drop policy if exists system_status_incidents_service_role_only on public.system_status_incidents;

-- No authenticated/anon policies are intentional: service-role access is confined to the API.
revoke all on public.system_status_checks from anon, authenticated;
revoke all on public.system_status_incidents from anon, authenticated;

drop trigger if exists trg_system_status_incidents_set_updated_at on public.system_status_incidents;
create trigger trg_system_status_incidents_set_updated_at
  before update on public.system_status_incidents
  for each row execute function public.set_updated_at();

create or replace function public.system_status_window_metrics(
  component_input text,
  since_input timestamptz,
  until_input timestamptz
)
returns table (
  sample_count bigint,
  operational_count bigint,
  degraded_count bigint,
  down_count bigint,
  not_configured_count bigint,
  average_response_time_ms numeric
)
language sql
security definer
set search_path = public
as $$
  select
    count(*)::bigint,
    count(*) filter (where status = 'operational')::bigint,
    count(*) filter (where status = 'degraded')::bigint,
    count(*) filter (where status = 'down')::bigint,
    count(*) filter (where status = 'not_configured')::bigint,
    round(avg(response_time_ms))
  from public.system_status_checks
  where component = component_input
    and checked_at >= since_input
    and checked_at <= until_input;
$$;

revoke all on function public.system_status_window_metrics(text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.system_status_window_metrics(text, timestamptz, timestamptz) to service_role;

insert into public.system_settings
  (key, value, description, group_key, value_type, min_value, max_value, options, is_editable, support_status, sort_order)
values
  ('STATUS_SLO_TARGET_PERCENT', '99.9', 'เป้าหมาย SLO availability ของระบบในช่วง 30 วัน', 'Live Health', 'number', 90, 100, '[]', true, 'active', 1210),
  ('STATUS_SLA_TARGET_PERCENT', '99.5', 'เป้าหมาย SLA availability สำหรับการรายงานภายใน', 'Live Health', 'number', 90, 100, '[]', true, 'active', 1220),
  ('STATUS_RESPONSE_TIME_TARGET_MS', '3000', 'response time สูงสุดที่คาดหวังสำหรับ health check', 'Live Health', 'number', 100, 30000, '[]', true, 'active', 1230)
on conflict (key) do update set
  description = excluded.description,
  group_key = excluded.group_key,
  value_type = excluded.value_type,
  min_value = excluded.min_value,
  max_value = excluded.max_value,
  options = excluded.options,
  is_editable = excluded.is_editable,
  support_status = excluded.support_status,
  sort_order = excluded.sort_order;
