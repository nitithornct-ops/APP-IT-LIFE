import type { SystemStatusComponent, SystemStatusIncident, SystemStatusResponse } from '@itlife/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '../lib/supabase';
import { probeGoogleDrive, googleDriveConfig } from './googleDriveService';
import type { Bindings } from '../types';

export type SystemStatusComponentId = SystemStatusComponent['id'];
export type SystemStatusCheckStatus = Exclude<SystemStatusComponent['status'], 'unknown'>;

export interface SystemStatusCheck {
  component: SystemStatusComponentId;
  status: SystemStatusCheckStatus;
  responseTimeMs: number | null;
  failureReason: string | null;
  checkedAt: string;
}

interface WindowMetric {
  sampleCount: number;
  operationalCount: number;
  degradedCount: number;
  downCount: number;
  notConfiguredCount: number;
  averageResponseTimeMs: number | null;
}

interface ScheduledJobsOverride {
  status: Exclude<SystemStatusCheckStatus, 'not_configured'>;
  responseTimeMs: number | null;
  failureReason?: string | null;
}

const CHECK_TIMEOUT_MS = 3_000;
const INTERNAL_PROBE_INTERVAL_MS = 60_000;
const DEFAULT_SLO_PERCENT = 99.9;
const DEFAULT_SLA_PERCENT = 99.5;
const DEFAULT_RESPONSE_TIME_TARGET_MS = 3_000;

export const SYSTEM_STATUS_COMPONENTS: Array<{
  id: SystemStatusComponentId;
  name: string;
  critical: boolean;
}> = [
  { id: 'api', name: 'API', critical: true },
  { id: 'database', name: 'Database', critical: true },
  { id: 'supabase_auth', name: 'Supabase Auth', critical: true },
  { id: 'storage', name: 'Storage', critical: true },
  { id: 'cloudflare_worker', name: 'Cloudflare Worker', critical: true },
  { id: 'line_messaging', name: 'LINE Messaging', critical: false },
  { id: 'smtp', name: 'SMTP', critical: false },
  { id: 'google_drive', name: 'Google Drive Integration', critical: false },
  { id: 'scheduled_jobs', name: 'Scheduled Jobs', critical: true },
  { id: 'outbox_queue', name: 'Outbox Queue', critical: true },
];

const COMPONENT_INFO = new Map(SYSTEM_STATUS_COMPONENTS.map((component) => [component.id, component]));
const CORE_COMPONENTS = new Set(SYSTEM_STATUS_COMPONENTS.filter((component) => component.critical).map((component) => component.id));

let lastInternalProbeAt = 0;

function nowIso(now = new Date()): string {
  return now.toISOString();
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function operationalCheck(component: SystemStatusComponentId, responseTimeMs: number | null, checkedAt: string): SystemStatusCheck {
  return { component, status: 'operational', responseTimeMs, failureReason: null, checkedAt };
}

function failedCheck(
  component: SystemStatusComponentId,
  status: Exclude<SystemStatusCheckStatus, 'operational'>,
  responseTimeMs: number | null,
  failureReason: string,
  checkedAt: string,
): SystemStatusCheck {
  return { component, status, responseTimeMs, failureReason, checkedAt };
}

async function timedCheck(
  component: SystemStatusComponentId,
  action: () => Promise<boolean>,
  checkedAt: string,
): Promise<SystemStatusCheck> {
  const startedAt = Date.now();
  try {
    const ok = await action();
    const responseTimeMs = elapsedMs(startedAt);
    return ok
      ? operationalCheck(component, responseTimeMs, checkedAt)
      : failedCheck(component, 'down', responseTimeMs, 'health_check_failed', checkedAt);
  } catch {
    return failedCheck(component, 'down', elapsedMs(startedAt), 'request_failed', checkedAt);
  }
}

async function probeHttp(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<boolean> {
  const response = await fetchImpl(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(CHECK_TIMEOUT_MS),
  });
  return response.ok;
}

async function checkDatabase(admin: SupabaseClient): Promise<boolean> {
  const { error, count } = await admin
    .from('roles')
    .select('id', { head: true, count: 'exact' })
    .abortSignal(AbortSignal.timeout(CHECK_TIMEOUT_MS));
  return !error && typeof count === 'number';
}

function configuredCheck(
  component: SystemStatusComponentId,
  configured: boolean,
  checkedAt: string,
  action: () => Promise<boolean>,
): Promise<SystemStatusCheck> {
  if (!configured) {
    return Promise.resolve(failedCheck(component, 'not_configured', null, 'not_configured', checkedAt));
  }
  return timedCheck(component, action, checkedAt);
}

async function checkLineMessaging(env: Bindings, fetchImpl: typeof fetch, checkedAt: string): Promise<SystemStatusCheck> {
  const configured = env.NOTIFY_LINE_ENABLED?.trim().toLowerCase() === 'true' && Boolean(env.LINE_CHANNEL_ACCESS_TOKEN?.trim());
  return configuredCheck('line_messaging', configured, checkedAt, () => probeHttp(fetchImpl, 'https://api.line.me/v2/bot/info', {
    headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
  }));
}

async function checkSmtp(env: Bindings, fetchImpl: typeof fetch, checkedAt: string): Promise<SystemStatusCheck> {
  const url = env.SMTP_HEALTHCHECK_URL?.trim();
  return configuredCheck('smtp', Boolean(url), checkedAt, () => probeHttp(fetchImpl, url!, { method: 'GET' }));
}

async function checkGoogleDrive(env: Bindings, fetchImpl: typeof fetch, checkedAt: string): Promise<SystemStatusCheck> {
  if (!googleDriveConfig(env)) {
    return failedCheck('google_drive', 'not_configured', null, 'not_configured', checkedAt);
  }
  const startedAt = Date.now();
  const result = await probeGoogleDrive(env, fetchImpl);
  if (result.ok) return operationalCheck('google_drive', result.responseTimeMs ?? elapsedMs(startedAt), checkedAt);
  return failedCheck('google_drive', 'down', result.responseTimeMs ?? elapsedMs(startedAt), result.reason ?? 'health_check_failed', checkedAt);
}

async function checkStorage(env: Bindings, fetchImpl: typeof fetch, checkedAt: string): Promise<SystemStatusCheck> {
  return timedCheck('storage', () => probeHttp(fetchImpl, `${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/bucket/attachments`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  }), checkedAt);
}

async function checkAuth(env: Bindings, fetchImpl: typeof fetch, checkedAt: string): Promise<SystemStatusCheck> {
  return timedCheck('supabase_auth', () => probeHttp(fetchImpl, `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/settings`, {
    headers: { apikey: env.SUPABASE_ANON_KEY },
  }), checkedAt);
}

async function checkOutbox(admin: SupabaseClient, checkedAt: string): Promise<SystemStatusCheck> {
  const startedAt = Date.now();
  try {
    const { data, error } = await admin
      .from('integration_outbox')
      .select('status,created_at')
      .in('status', ['PENDING', 'PROCESSING', 'ERROR', 'DEAD'])
      .limit(1000)
      .abortSignal(AbortSignal.timeout(CHECK_TIMEOUT_MS));
    const responseTimeMs = elapsedMs(startedAt);
    if (error) return failedCheck('outbox_queue', 'down', responseTimeMs, 'health_check_failed', checkedAt);
    const rows = data ?? [];
    const failed = rows.filter((row) => row.status === 'ERROR' || row.status === 'DEAD').length;
    const oldestWaiting = rows
      .filter((row) => row.status === 'PENDING' || row.status === 'PROCESSING')
      .map((row) => new Date(String(row.created_at)).getTime())
      .filter(Number.isFinite)
      .sort((a, b) => a - b)[0];
    const backlogAgeMs = oldestWaiting ? Date.now() - oldestWaiting : 0;
    if (failed > 0 || rows.length >= 100 || backlogAgeMs > 15 * 60_000) {
      return failedCheck('outbox_queue', 'degraded', responseTimeMs, failed > 0 ? 'delivery_failures' : 'queue_backlog', checkedAt);
    }
    return operationalCheck('outbox_queue', responseTimeMs, checkedAt);
  } catch {
    return failedCheck('outbox_queue', 'down', elapsedMs(startedAt), 'request_failed', checkedAt);
  }
}

export async function collectSystemStatusChecks(
  env: Bindings,
  options: { now?: Date; fetchImpl?: typeof fetch; scheduledJobs?: ScheduledJobsOverride } = {},
): Promise<SystemStatusCheck[]> {
  const checkedAt = nowIso(options.now);
  const fetchImpl = options.fetchImpl ?? fetch;
  const admin = createAdminClient(env);
  const [database, auth, storage, line, smtp, drive, outbox] = await Promise.all([
    timedCheck('database', () => checkDatabase(admin), checkedAt),
    checkAuth(env, fetchImpl, checkedAt),
    checkStorage(env, fetchImpl, checkedAt),
    checkLineMessaging(env, fetchImpl, checkedAt),
    checkSmtp(env, fetchImpl, checkedAt),
    checkGoogleDrive(env, fetchImpl, checkedAt),
    checkOutbox(admin, checkedAt),
  ]);
  const scheduled = options.scheduledJobs
    ? {
        component: 'scheduled_jobs' as const,
        status: options.scheduledJobs.status,
        responseTimeMs: options.scheduledJobs.responseTimeMs,
        failureReason: options.scheduledJobs.failureReason ?? null,
        checkedAt,
      }
    : failedCheck('scheduled_jobs', 'not_configured', null, 'no_heartbeat', checkedAt);

  return [
    operationalCheck('api', 0, checkedAt),
    database,
    auth,
    storage,
    operationalCheck('cloudflare_worker', 0, checkedAt),
    line,
    smtp,
    drive,
    scheduled,
    outbox,
  ];
}

function incidentSeverity(component: SystemStatusComponentId, status: SystemStatusCheckStatus): 'minor' | 'major' | 'critical' {
  if (status === 'down' && CORE_COMPONENTS.has(component)) return 'critical';
  if (status === 'down') return 'major';
  return 'minor';
}

async function reconcileIncident(admin: SupabaseClient, check: SystemStatusCheck): Promise<void> {
  if (check.status === 'not_configured') return;
  const component = COMPONENT_INFO.get(check.component);
  if (!component) return;
  const { data: openIncident } = await admin
    .from('system_status_incidents')
    .select('id,failure_count,started_at')
    .eq('component', check.component)
    .eq('status', 'open')
    .maybeSingle();

  if (check.status === 'operational') {
    if (openIncident?.id) {
      await admin.from('system_status_incidents').update({
        status: 'resolved',
        resolved_at: check.checkedAt,
        updated_at: check.checkedAt,
      }).eq('id', openIncident.id);
    }
    return;
  }

  const title = `${component.name} health issue`;
  const summary = check.status === 'degraded' ? 'ระบบยังให้บริการได้ แต่ประสิทธิภาพหรือคิวงานต่ำกว่าเป้าหมาย' : 'ระบบย่อยไม่ตอบสนองตาม health check';
  if (openIncident?.id) {
    await admin.from('system_status_incidents').update({
      last_failure_at: check.checkedAt,
      failure_count: Number(openIncident.failure_count ?? 1) + 1,
      severity: incidentSeverity(check.component, check.status),
      summary,
      updated_at: check.checkedAt,
    }).eq('id', openIncident.id);
    return;
  }
  await admin.from('system_status_incidents').insert({
    component: check.component,
    status: 'open',
    severity: incidentSeverity(check.component, check.status),
    title,
    summary,
    started_at: check.checkedAt,
    last_failure_at: check.checkedAt,
    failure_count: 1,
  });
}

export async function recordSystemStatusChecks(
  env: Bindings,
  checks: SystemStatusCheck[],
  source: 'scheduled' | 'internal_request' = 'scheduled',
): Promise<boolean> {
  const admin = createAdminClient(env);
  const { error } = await admin.from('system_status_checks').insert(checks.map((check) => ({
    component: check.component,
    status: check.status,
    response_time_ms: check.responseTimeMs,
    failure_reason: check.failureReason,
    source,
    checked_at: check.checkedAt,
  })));
  if (error) {
    console.error(JSON.stringify({ msg: 'system_status_checks_write_failed', code: error.code ?? null }));
    return false;
  }
  await Promise.all(checks.map((check) => reconcileIncident(admin, check).catch(() => undefined)));
  return true;
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : Math.round(value * 100) / 100;
}

function metricRow(raw: unknown): WindowMetric {
  const row = Array.isArray(raw) ? raw[0] : raw;
  const value = row && typeof row === 'object' ? row as Record<string, unknown> : {};
  return {
    sampleCount: toNumber(value.sample_count, 0),
    operationalCount: toNumber(value.operational_count, 0),
    degradedCount: toNumber(value.degraded_count, 0),
    downCount: toNumber(value.down_count, 0),
    notConfiguredCount: toNumber(value.not_configured_count, 0),
    averageResponseTimeMs: value.average_response_time_ms === null || value.average_response_time_ms === undefined
      ? null
      : toNumber(value.average_response_time_ms, 0),
  };
}

export function computeUptimePercent(metric: WindowMetric): number | null {
  const measuredSamples = metric.sampleCount - metric.notConfiguredCount;
  if (measuredSamples <= 0) return null;
  return round((metric.operationalCount / measuredSamples) * 100);
}

function targetFromSettings(settings: Map<string, string>, env: Bindings, key: string, fallback: number): number {
  return toNumber(settings.get(key) ?? env[key as keyof Bindings], fallback);
}

function overallStatus(components: SystemStatusComponent[]): SystemStatusResponse['overallStatus'] {
  if (!components.length || components.every((component) => component.status === 'unknown')) return 'unknown';
  const core = components.filter((component) => CORE_COMPONENTS.has(component.id));
  if (core.some((component) => component.status === 'down')) return 'down';
  if (core.some((component) => component.status === 'unknown')) return 'unknown';
  if (components.some((component) => component.status === 'degraded' || component.status === 'down')) return 'degraded';
  return 'operational';
}

function formatIncident(raw: Record<string, unknown>): SystemStatusIncident {
  const component = String(raw.component ?? '');
  return {
    id: String(raw.id ?? ''),
    component,
    componentName: COMPONENT_INFO.get(component as SystemStatusComponentId)?.name ?? component,
    status: raw.status === 'resolved' ? 'resolved' : 'open',
    severity: raw.severity === 'critical' || raw.severity === 'major' ? raw.severity : 'minor',
    title: String(raw.title ?? 'System health incident'),
    summary: String(raw.summary ?? ''),
    startedAt: String(raw.started_at ?? ''),
    lastFailureAt: String(raw.last_failure_at ?? raw.started_at ?? ''),
    resolvedAt: raw.resolved_at ? String(raw.resolved_at) : null,
    failureCount: Math.max(0, toNumber(raw.failure_count, 0)),
  };
}

export async function loadSystemStatus(env: Bindings, now = new Date()): Promise<SystemStatusResponse> {
  const startedAt = Date.now();
  const admin = createAdminClient(env);
  const until = now.getTime();
  const windows = [24 * 60 * 60_000, 7 * 24 * 60 * 60_000, 30 * 24 * 60 * 60_000] as const;
  type RawQueryResult = { data?: unknown; error?: { code?: string } | null };
  const queryPromises: PromiseLike<unknown>[] = [
    admin.from('system_status_checks').select('component,status,response_time_ms,failure_reason,checked_at').order('checked_at', { ascending: false }).limit(500),
    ...SYSTEM_STATUS_COMPONENTS.map((component) => admin.from('system_status_checks').select('failure_reason,checked_at').eq('component', component.id).neq('status', 'operational').neq('status', 'not_configured').order('checked_at', { ascending: false }).limit(1)),
    admin.from('system_status_incidents').select('id,component,status,severity,title,summary,started_at,last_failure_at,resolved_at,failure_count').order('started_at', { ascending: false }).limit(50),
    admin.from('system_settings').select('key,value').in('key', ['STATUS_SLO_TARGET_PERCENT', 'STATUS_SLA_TARGET_PERCENT', 'STATUS_RESPONSE_TIME_TARGET_MS']),
    ...SYSTEM_STATUS_COMPONENTS.flatMap((component) => windows.map((windowMs) => admin.rpc('system_status_window_metrics', {
      component_input: component.id,
      since_input: new Date(until - windowMs).toISOString(),
      until_input: now.toISOString(),
    }))),
  ];
  const queryResults = await Promise.all(queryPromises);
  const latestResult = queryResults[0] as RawQueryResult;
  const failureResults = queryResults.slice(1, 1 + SYSTEM_STATUS_COMPONENTS.length) as RawQueryResult[];
  const incidentResult = queryResults[1 + SYSTEM_STATUS_COMPONENTS.length] as RawQueryResult;
  const settingsResult = queryResults[2 + SYSTEM_STATUS_COMPONENTS.length] as RawQueryResult;
  const metricResults = queryResults.slice(3 + SYSTEM_STATUS_COMPONENTS.length) as RawQueryResult[];

  const latestByComponent = new Map<string, Record<string, unknown>>();
  const latestRows = Array.isArray(latestResult.data) ? latestResult.data as Array<Record<string, unknown>> : [];
  for (const row of latestRows) {
    const component = String(row.component ?? '');
    if (!latestByComponent.has(component)) latestByComponent.set(component, row as Record<string, unknown>);
  }
  const settingsRows = Array.isArray(settingsResult.data) ? settingsResult.data as Array<Record<string, unknown>> : [];
  const settings = new Map<string, string>(settingsRows.map((row) => [String(row.key), String(row.value ?? '')]));
  const targets = {
    sloPercent: targetFromSettings(settings, env, 'STATUS_SLO_TARGET_PERCENT', DEFAULT_SLO_PERCENT),
    slaPercent: targetFromSettings(settings, env, 'STATUS_SLA_TARGET_PERCENT', DEFAULT_SLA_PERCENT),
    responseTimeMs: Math.round(targetFromSettings(settings, env, 'STATUS_RESPONSE_TIME_TARGET_MS', DEFAULT_RESPONSE_TIME_TARGET_MS)),
  };

  const components: SystemStatusComponent[] = SYSTEM_STATUS_COMPONENTS.map((definition, index) => {
    const latest = latestByComponent.get(definition.id);
    const failureRows = Array.isArray(failureResults[index]?.data) ? failureResults[index]?.data as Array<Record<string, unknown>> : [];
    const failure = failureRows[0];
    const metricOffset = index * windows.length;
    const metrics = windows.map((_, windowIndex) => metricRow(metricResults[metricOffset + windowIndex]?.data));
    return {
      id: definition.id,
      name: definition.name,
      critical: definition.critical,
      status: latest ? latest.status as SystemStatusComponent['status'] : 'unknown',
      responseTimeMs: latest?.response_time_ms === null || latest?.response_time_ms === undefined ? null : toNumber(latest.response_time_ms, 0),
      checkedAt: latest?.checked_at ? String(latest.checked_at) : null,
      lastFailureAt: failure?.checked_at ? String(failure.checked_at) : null,
      lastFailureReason: failure?.failure_reason ? String(failure.failure_reason) : null,
      uptime: {
        hours24: computeUptimePercent(metrics[0]),
        days7: computeUptimePercent(metrics[1]),
        days30: computeUptimePercent(metrics[2]),
      },
      averageResponseTimeMs: {
        hours24: round(metrics[0].averageResponseTimeMs),
        days7: round(metrics[1].averageResponseTimeMs),
        days30: round(metrics[2].averageResponseTimeMs),
      },
    };
  });

  const incidentRows = Array.isArray(incidentResult.data) ? incidentResult.data as Array<Record<string, unknown>> : [];
  const incidents = incidentRows.map((row) => formatIncident(row));
  const openIncidents = incidents.filter((incident) => incident.status === 'open').length;
  const summary = {
    total: components.length,
    operational: components.filter((component) => component.status === 'operational').length,
    degraded: components.filter((component) => component.status === 'degraded').length,
    down: components.filter((component) => component.status === 'down').length,
    notConfigured: components.filter((component) => component.status === 'not_configured').length,
    openIncidents,
  };

  // If the observability migration has not been deployed yet, report unknown rather than
  // leaking a database error or pretending that monitoring is healthy.
  const hasReadError = Boolean(latestResult.error || incidentResult.error || metricResults.some((result) => result.error));
  return {
    overallStatus: hasReadError ? 'unknown' : overallStatus(components),
    generatedAt: nowIso(now),
    responseTimeMs: elapsedMs(startedAt),
    summary,
    targets,
    components,
    incidents,
  };
}

export async function refreshInternalSystemStatus(env: Bindings, now = new Date(), fetchImpl: typeof fetch = fetch): Promise<void> {
  if (now.getTime() - lastInternalProbeAt < INTERNAL_PROBE_INTERVAL_MS) return;
  lastInternalProbeAt = now.getTime();
  const checks = await collectSystemStatusChecks(env, { now, fetchImpl });
  await recordSystemStatusChecks(env, checks.filter((check) => check.component !== 'scheduled_jobs'), 'internal_request');
}

export function resetSystemStatusProbeThrottle(): void {
  lastInternalProbeAt = 0;
}
