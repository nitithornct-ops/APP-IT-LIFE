import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { hasPermission, requirePermission } from '../middleware/permission';
import { writeAuditLog } from '../services/auditService';
import { buildSlaImpactSummary, type SlaImpactTicket } from '../services/slaImpactService';
import { parseTicketBusinessCalendar } from '../services/ticketSlaService';
import type { AppEnv, Bindings } from '../types';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import {
  restoreSystemSettingSchema,
  settingDecisionSchema,
  settingPreviewSchema,
  slaImpactQuerySchema,
  updateSystemSettingSchema,
} from '../validators/settings';

const BRANDING_BUCKET = 'branding';
const ORGANIZATION_LOGO_KEY = 'ORG_LOGO_URL';
const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024;
const LOGO_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const BOOLEAN_KEYS = new Set([
  'NOTIFY_LINE_ENABLED', 'ADMIN_MFA_ENABLED', 'LINE_LOGIN_ENABLED',
  'AUTO_BACKUP_ENABLED', 'AUTO_RESTORE_DRILL_ENABLED', 'RETENTION_TRASH_EVIDENCE',
]);

const NUMBER_RANGES: Record<string, [number, number]> = {
  NOTIFY_LEAD_DAYS: [1, 365], LINE_QUEUE_MAX_ATTEMPTS: [1, 10], REVIEW_CYCLE_DAYS: [1, 1095],
  INCIDENT_DPO_ESCALATION_HOURS: [1, 24], LOGIN_MAX_FAILS_5MIN: [5, 30], PASSWORD_HASH_ITERATIONS: [1000, 20000],
  LINE_SESSION_HOURS: [1, 720],
  STATUS_SLO_TARGET_PERCENT: [90, 100], STATUS_SLA_TARGET_PERCENT: [90, 100], STATUS_RESPONSE_TIME_TARGET_MS: [100, 30000],
  BACKUP_RETENTION_DAYS: [7, 3650], RESTORE_SANDBOX_RETENTION_DAYS: [7, 3650], BACKUP_HEALTH_MAX_HOURS: [1, 168],
  LINE_SESSION_RETENTION_DAYS: [1, 3650], NOTIFICATION_LOG_RETENTION_DAYS: [30, 3650],
  NOTIFICATION_QUEUE_RETENTION_DAYS: [7, 3650], TICKET_PII_RETENTION_DAYS: [30, 36500],
  SERVICE_REQUEST_PII_RETENTION_DAYS: [30, 36500], WORKFLOW_PII_RETENTION_DAYS: [30, 36500],
  ATTACHMENT_RETENTION_DAYS: [30, 36500], ATTACHMENT_STAGED_RETENTION_HOURS: [1, 720],
  ATTACHMENT_DOWNLOAD_MAX_MB: [1, 15], SOFT_DELETE_RETENTION_DAYS: [30, 36500],
};

const DECIMAL_NUMBER_KEYS = new Set(['STATUS_SLO_TARGET_PERCENT', 'STATUS_SLA_TARGET_PERCENT']);

const UNSUPPORTED_ENABLE_KEYS = new Set(['NOTIFY_LINE_ENABLED', 'LINE_LOGIN_ENABLED', 'AUTO_BACKUP_ENABLED', 'AUTO_RESTORE_DRILL_ENABLED']);

export type SettingEnvironmentLabel = 'dev' | 'uat' | 'prod' | 'unknown';

/** Convert the deployment name to the small, user-facing environment label. */
export function normalizeEnvironmentLabel(input: string | undefined): SettingEnvironmentLabel {
  const value = (input ?? '').trim().toLowerCase();
  if (['dev', 'development', 'local', 'test'].includes(value)) return 'dev';
  if (['uat', 'staging', 'qa'].includes(value)) return 'uat';
  if (['prod', 'production', 'live'].includes(value)) return 'prod';
  return 'unknown';
}

const SENSITIVE_SETTING_KEY = /(?:PASSWORD|TOKEN|SECRET|API_KEY|PRIVATE_KEY|CREDENTIAL)/i;

export function sanitizeConfigValue(key: string, value: string, supportStatus?: string): string {
  if (SENSITIVE_SETTING_KEY.test(key)) return '[REDACTED]';
  if (supportStatus === 'external') return '[MANAGED_EXTERNALLY]';
  return value;
}

function settingRequiresApproval(setting: { criticality?: string | null; requires_approval?: boolean | null }): boolean {
  return setting.requires_approval === true || setting.criticality === 'critical';
}

function settingRpcErrorCode(message: string | undefined): string | null {
  const known = [
    'SETTING_NOT_FOUND', 'SETTING_READ_ONLY', 'SETTING_RESTORE_VERSION_REQUIRED',
    'SETTING_RESTORE_VERSION_INVALID', 'SETTING_CHANGE_STALE', 'SETTING_DECISION_INVALID',
    'SETTING_APPROVAL_SOD', 'SETTING_CHANGE_REQUEST_NOT_FOUND', 'SETTING_CHANGE_REQUEST_NOT_PENDING',
  ];
  return known.find((code) => message?.includes(code)) ?? null;
}

function sanitizeChangeRequest(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    requested_value: sanitizeConfigValue(String(row.setting_key ?? ''), String(row.requested_value ?? '')),
  };
}

async function createSettingChangeRequest(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    settingKey: string;
    requestedValue: string;
    baseVersion: number;
    changeType: 'update' | 'restore';
    sourceVersion?: number;
    requestedBy: string;
  },
) {
  return admin.from('system_setting_change_requests').insert({
    setting_key: input.settingKey,
    requested_value: input.requestedValue,
    base_version: input.baseVersion,
    change_type: input.changeType,
    source_version: input.sourceVersion ?? null,
    requested_by: input.requestedBy,
  }).select('*').single();
}

export function brandingStoragePath(url: string): string | null {
  if (!url) return null;
  try {
    const marker = `/storage/v1/object/public/${BRANDING_BUCKET}/`;
    const pathname = new URL(url).pathname;
    const markerIndex = pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    const path = decodeURIComponent(pathname.slice(markerIndex + marker.length));
    return path.startsWith('organization/') ? path : null;
  } catch {
    return null;
  }
}

async function loadBranding(env: Bindings) {
  const admin = createAdminClient(env);
  const { data } = await admin.from('system_settings').select('key, value').in('key', ['ORG_NAME', ORGANIZATION_LOGO_KEY]);
  const values = Object.fromEntries((data ?? []).map((item) => [String(item.key), String(item.value)]));
  return {
    organizationName: values.ORG_NAME || 'LIFE IT',
    logoUrl: values[ORGANIZATION_LOGO_KEY] || '',
  };
}

export function normalizeSettingValue(key: string, input: string): { value?: string; error?: string } {
  const raw = input.trim();
  if (BOOLEAN_KEYS.has(key)) {
    const normalized = raw.toLowerCase();
    const truthy = ['true', '1', 'yes', 'on', 'เปิด'].includes(normalized);
    const falsy = ['false', '0', 'no', 'off', 'ปิด'].includes(normalized);
    if (!truthy && !falsy) return { error: `ค่า ${key} ต้องเป็น true/false` };
    if (truthy && UNSUPPORTED_ENABLE_KEYS.has(key)) return { error: 'ยังเปิดความสามารถนี้ไม่ได้จนกว่าจะตั้งค่า integration และ secret ฝั่ง deployment ครบ' };
    return { value: truthy ? 'true' : 'false' };
  }
  if (DECIMAL_NUMBER_KEYS.has(key)) {
    const decimalRange = NUMBER_RANGES[key];
    if (!/^\d+(?:\.\d+)?$/.test(raw)) return { error: `Invalid numeric value for ${key}` };
    const decimal = Number(raw);
    if (!decimalRange || decimal < decimalRange[0] || decimal > decimalRange[1]) return { error: `Value for ${key} is outside the allowed range` };
    return { value: String(decimal) };
  }
  const range = NUMBER_RANGES[key];
  if (range) {
    if (!/^\d+$/.test(raw)) return { error: `ค่า ${key} ต้องเป็นจำนวนเต็ม` };
    const number = Number(raw);
    if (number < range[0] || number > range[1]) return { error: `ค่า ${key} ต้องอยู่ระหว่าง ${range[0]}-${range[1]}` };
    return { value: String(number) };
  }
  if (key === 'NOTIFY_PRIMARY_CHANNEL') return raw.toUpperCase() === 'LINE' ? { value: 'LINE' } : { error: 'ช่องทางหลักต้องเป็น LINE' };
  if (key === 'RETENTION_MODE') return ['DRY_RUN', 'ENFORCE'].includes(raw.toUpperCase()) ? { value: raw.toUpperCase() } : { error: 'RETENTION_MODE ต้องเป็น DRY_RUN หรือ ENFORCE' };
  if (key === 'SLA_BUSINESS_START' || key === 'SLA_BUSINESS_END') return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(raw) ? { value: raw } : { error: `${key} ต้องเป็น HH:mm` };
  if (key === 'SLA_BUSINESS_DAYS') {
    const days = [...new Set(raw.split(',').map((day) => day.trim()).filter(Boolean))];
    return days.length && days.every((day) => /^[0-6]$/.test(day)) ? { value: days.join(',') } : { error: 'SLA_BUSINESS_DAYS ต้องเป็นเลข 0-6 คั่นด้วย comma' };
  }
  if (key === 'SLA_HOLIDAYS') {
    const holidays = raw.split(',').map((day) => day.trim()).filter(Boolean);
    return holidays.every((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)) ? { value: holidays.join(',') } : { error: 'SLA_HOLIDAYS ต้องเป็น yyyy-mm-dd คั่นด้วย comma' };
  }
  if (key === 'PUBLIC_PRIVACY_NOTICE_URL' || key === 'LIVE_HEALTH_PUBLIC_URL') return !raw || /^https:\/\//i.test(raw) ? { value: raw } : { error: `${key} ต้องเป็น HTTPS หรือเว้นว่าง` };
  if (key === 'PUBLIC_PRIVACY_NOTICE_VERSION') return /^[0-9A-Za-z_.-]{4,40}$/.test(raw) ? { value: raw } : { error: 'เวอร์ชันใช้ได้เฉพาะตัวเลข ตัวอักษร จุด ขีดกลาง และขีดล่าง' };
  return { value: raw };
}

export const settingsRoute = new Hono<AppEnv>();
settingsRoute.use('*', requireAuth);

settingsRoute.get('/branding', async (c) => {
  return c.json(ok(c.get('requestId'), await loadBranding(c.env)));
});

settingsRoute.post('/logo', requirePermission('setting.manage'), async (c) => {
  const requestId = c.get('requestId');
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json(fail(requestId, 'LOGO_REQUIRED', 'กรุณาเลือกไฟล์โลโก้'), 400);
  const extension = LOGO_EXTENSIONS[file.type];
  if (!extension) return c.json(fail(requestId, 'LOGO_TYPE_NOT_ALLOWED', 'โลโก้ต้องเป็นไฟล์ PNG, JPG หรือ WebP'), 400);
  if (file.size > MAX_LOGO_SIZE_BYTES) return c.json(fail(requestId, 'LOGO_TOO_LARGE', 'ไฟล์โลโก้ต้องมีขนาดไม่เกิน 2 MB'), 400);

  const admin = createAdminClient(c.env);
  const { data: current, error: loadError } = await admin.from('system_settings').select('value, config_version').eq('key', ORGANIZATION_LOGO_KEY).maybeSingle();
  if (loadError || !current) return c.json(fail(requestId, 'LOGO_SETTING_NOT_FOUND', 'ไม่พบค่าตั้งค่าโลโก้ กรุณาอัปเดตฐานข้อมูลก่อน'), 409);

  const path = `organization/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await admin.storage.from(BRANDING_BUCKET).upload(path, file, {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false,
  });
  if (uploadError) return dbFailJson(c, 'LOGO_UPLOAD_FAILED', uploadError);

  const publicUrl = admin.storage.from(BRANDING_BUCKET).getPublicUrl(path).data.publicUrl;
  const logoUrl = `${publicUrl}?v=${Date.now()}`;
  const nextVersion = Number(current.config_version ?? 1) + 1;
  const { error: updateError } = await admin.from('system_settings').update({ value: logoUrl, config_version: nextVersion, updated_by: c.get('userId') }).eq('key', ORGANIZATION_LOGO_KEY);
  if (updateError) {
    await admin.storage.from(BRANDING_BUCKET).remove([path]);
    return dbFailJson(c, 'LOGO_SETTING_UPDATE_FAILED', updateError);
  }

  const previousPath = brandingStoragePath(String(current.value ?? ''));
  if (previousPath && previousPath !== path) await admin.storage.from(BRANDING_BUCKET).remove([previousPath]);
  await admin.from('system_setting_versions').insert({
    setting_key: ORGANIZATION_LOGO_KEY, version: nextVersion, value: logoUrl, previous_value: current.value ?? '',
    change_type: 'update', changed_by: c.get('userId'), environment_label: normalizeEnvironmentLabel(c.env.ENVIRONMENT),
  });
  await writeAuditLog(c.env, {
    actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: 'UPDATE_ORG_LOGO', module: 'settings',
    targetTable: 'system_settings', targetId: ORGANIZATION_LOGO_KEY,
    detail: { mimeType: file.type, sizeBytes: file.size, replaced: Boolean(previousPath) }, requestId,
  });
  return c.json(ok(requestId, { ...(await loadBranding(c.env)), logoUrl }));
});

settingsRoute.delete('/logo', requirePermission('setting.manage'), async (c) => {
  const requestId = c.get('requestId');
  const admin = createAdminClient(c.env);
  const { data: current, error: loadError } = await admin.from('system_settings').select('value, config_version').eq('key', ORGANIZATION_LOGO_KEY).maybeSingle();
  if (loadError || !current) return c.json(fail(requestId, 'LOGO_SETTING_NOT_FOUND', 'ไม่พบค่าตั้งค่าโลโก้'), 404);
  const nextVersion = Number(current.config_version ?? 1) + 1;
  const { error: updateError } = await admin.from('system_settings').update({ value: '', config_version: nextVersion, updated_by: c.get('userId') }).eq('key', ORGANIZATION_LOGO_KEY);
  if (updateError) return dbFailJson(c, 'LOGO_SETTING_UPDATE_FAILED', updateError);
  const previousPath = brandingStoragePath(String(current.value ?? ''));
  if (previousPath) await admin.storage.from(BRANDING_BUCKET).remove([previousPath]);
  await admin.from('system_setting_versions').insert({
    setting_key: ORGANIZATION_LOGO_KEY, version: nextVersion, value: '', previous_value: current.value ?? '',
    change_type: 'update', changed_by: c.get('userId'), environment_label: normalizeEnvironmentLabel(c.env.ENVIRONMENT),
  });
  await writeAuditLog(c.env, {
    actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: 'DELETE_ORG_LOGO', module: 'settings',
    targetTable: 'system_settings', targetId: ORGANIZATION_LOGO_KEY, requestId,
  });
  return c.json(ok(requestId, await loadBranding(c.env)));
});

settingsRoute.get('/sla-impact', requirePermission('setting.view'), zValidator('query', slaImpactQuerySchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId');
  const requested = c.req.valid('query');
  const keys = ['SLA_BUSINESS_START', 'SLA_BUSINESS_END', 'SLA_BUSINESS_DAYS', 'SLA_HOLIDAYS'] as const;
  const admin = createAdminClient(c.env);
  const [settingsResult, ticketsResult, policiesResult] = await Promise.all([
    admin.from('system_settings').select('key,value').in('key', [...keys]),
    admin.from('tickets')
      .select('id,status,created_at,due_at,resolution_sla_hours,sla_paused_at,sla_paused_minutes,reopen_count')
      .not('status', 'in', '(เสร็จสิ้น,ปิดงาน,ยกเลิก,ยกระดับเป็น Incident)'),
    admin.from('ticket_categories')
      .select('id,name,response_sla_hours,resolution_sla_hours,sla_hours,default_priority,status')
      .eq('status', 'active')
      .order('name'),
  ]);
  if (settingsResult.error) return dbFailJson(c, 'SLA_SETTINGS_LOAD_FAILED', settingsResult.error);
  if (ticketsResult.error) return dbFailJson(c, 'SLA_IMPACT_TICKETS_LOAD_FAILED', ticketsResult.error);
  if (policiesResult.error) return dbFailJson(c, 'SLA_POLICIES_LOAD_FAILED', policiesResult.error);

  const currentValues = Object.fromEntries((settingsResult.data ?? []).map((row) => [String(row.key), String(row.value ?? '')]));
  const proposedValues: Record<string, string> = { ...currentValues };
  for (const key of keys) {
    const input = requested[key];
    if (input === undefined) continue;
    const normalized = normalizeSettingValue(key, input);
    if (normalized.error || normalized.value === undefined) {
      return c.json(fail(requestId, 'SLA_PREVIEW_INVALID', normalized.error ?? 'ค่าปฏิทิน SLA ไม่ถูกต้อง'), 400);
    }
    proposedValues[key] = normalized.value;
  }

  const startMinute = (value: string | undefined, fallback: string) => {
    const safeValue = value || fallback;
    const [hour, minute] = safeValue.split(':').map(Number);
    return hour * 60 + minute;
  };
  if (startMinute(proposedValues.SLA_BUSINESS_END, '17:30') <= startMinute(proposedValues.SLA_BUSINESS_START, '08:30')) {
    return c.json(fail(requestId, 'SLA_PREVIEW_INVALID_RANGE', 'เวลาสิ้นสุดทำการต้องอยู่หลังเวลาเริ่มทำการ'), 400);
  }

  const currentCalendar = parseTicketBusinessCalendar(currentValues);
  const proposedCalendar = parseTicketBusinessCalendar(proposedValues);
  const summary = buildSlaImpactSummary({
    tickets: (ticketsResult.data ?? []) as SlaImpactTicket[],
    currentCalendar,
    proposedCalendar,
  });
  const minuteLabel = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

  return c.json(ok(requestId, {
    generatedAt: new Date().toISOString(),
    calendar: {
      start: minuteLabel(proposedCalendar.startMinute),
      end: minuteLabel(proposedCalendar.endMinute),
      businessDays: [...proposedCalendar.businessDays].sort((a, b) => a - b),
      holidays: [...proposedCalendar.holidays].sort(),
      minutesPerDay: proposedCalendar.endMinute - proposedCalendar.startMinute,
    },
    policies: (policiesResult.data ?? []).map((policy) => ({
      id: String(policy.id),
      name: String(policy.name),
      priority: String(policy.default_priority ?? 'ไม่ระบุ'),
      responseHours: Number(policy.response_sla_hours ?? 4),
      resolutionHours: Number(policy.resolution_sla_hours ?? policy.sla_hours ?? 24),
    })),
    ...summary,
  }));
});

settingsRoute.post('/preview', requirePermission('setting.view'), zValidator('json', settingPreviewSchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId');
  const requested = c.req.valid('json');
  const key = requested.key.trim().toUpperCase();
  const supabase = c.get('supabase');
  const { data: settings, error } = await supabase.from('system_settings').select('*').order('sort_order').order('key');
  if (error) return dbFailJson(c, 'SETTING_PREVIEW_LOAD_FAILED', error);
  const current = (settings ?? []).find((item) => String(item.key) === key);
  if (!current) return c.json(fail(requestId, 'SETTING_NOT_FOUND', 'ไม่พบค่าตั้งค่าที่ระบุ'), 404);

  const normalized = normalizeSettingValue(key, requested.value);
  if (normalized.error || normalized.value === undefined) {
    return c.json(fail(requestId, 'SETTING_VALUE_INVALID', normalized.error ?? 'ค่าตั้งค่าไม่ถูกต้อง'), 400);
  }

  const dependencies: Array<{ key: string; status: 'satisfied' | 'unsatisfied' | 'missing'; value: string | null }> = (Array.isArray(current.depends_on) ? current.depends_on : []).map((dependencyKey: string) => {
    const dependency = (settings ?? []).find((item) => String(item.key) === dependencyKey);
    const dependencyValue = dependency ? String(dependency.value ?? '') : '';
    const satisfied = Boolean(dependency) && dependencyValue !== '' && !['false', '0', 'off'].includes(dependencyValue.toLowerCase());
    return {
      key: dependencyKey,
      status: !dependency ? 'missing' as const : satisfied ? 'satisfied' as const : 'unsatisfied' as const,
      value: dependency ? sanitizeConfigValue(dependencyKey, dependencyValue, dependency.support_status) : null,
    };
  });
  const impactedSettings = (settings ?? [])
    .filter((item) => Array.isArray(item.depends_on) && item.depends_on.includes(key))
    .map((item) => String(item.key));
  const warnings = dependencies.filter((dependency) => dependency.status !== 'satisfied').map((dependency) => `Dependency ${dependency.key} is ${dependency.status}`);
  if (settingRequiresApproval(current)) warnings.push('ค่าระดับ Critical จะถูกส่งเข้าคิวอนุมัติก่อนมีผล');

  return c.json(ok(requestId, {
    key,
    changed: String(current.value ?? '') !== normalized.value,
    current: {
      value: sanitizeConfigValue(key, String(current.value ?? ''), current.support_status),
      version: Number(current.config_version ?? 1),
    },
    proposed: {
      value: sanitizeConfigValue(key, normalized.value, current.support_status),
      normalizedValue: sanitizeConfigValue(key, normalized.value, current.support_status),
    },
    criticality: current.criticality ?? 'standard',
    requiresApproval: settingRequiresApproval(current),
    dependencies,
    impactedSettings,
    warnings,
  }));
});

settingsRoute.get('/export', requirePermission('setting.view'), async (c) => {
  const requestId = c.get('requestId');
  const { data, error } = await c.get('supabase').from('system_settings').select('*').order('sort_order').order('key');
  if (error) return dbFailJson(c, 'SETTINGS_EXPORT_FAILED', error);
  const environmentKey = normalizeEnvironmentLabel(c.env.ENVIRONMENT);
  const configVersion = Math.max(1, ...(data ?? []).map((item) => Number(item.config_version ?? 1)));
  const settings = (data ?? []).map((item) => ({
    key: String(item.key),
    value: sanitizeConfigValue(String(item.key), String(item.value ?? ''), item.support_status),
    description: String(item.description ?? ''),
    group: String(item.group_key ?? ''),
    valueType: String(item.value_type ?? 'text'),
    configVersion: Number(item.config_version ?? 1),
    criticality: item.criticality ?? 'standard',
    requiresApproval: Boolean(item.requires_approval),
    dependsOn: Array.isArray(item.depends_on) ? item.depends_on : [],
    supportStatus: item.support_status ?? 'prepared',
  }));
  await writeAuditLog(c.env, {
    actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: 'EXPORT_SANITIZED_SETTINGS',
    module: 'settings', targetTable: 'system_settings', detail: { count: settings.length, configVersion, environment: environmentKey }, requestId,
  });
  const date = new Date().toISOString().slice(0, 10);
  return c.json(ok(requestId, {
    filename: `system-settings-${environmentKey}-${date}.json`,
    exportedAt: new Date().toISOString(),
    environment: environmentKey,
    configVersion,
    settings,
  }));
});

settingsRoute.get('/approvals', requirePermission('setting.view'), async (c) => {
  const requestId = c.get('requestId');
  const { data, error } = await c.get('supabase')
    .from('system_setting_change_requests')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) return dbFailJson(c, 'SETTING_APPROVALS_LOAD_FAILED', error);
  return c.json(ok(requestId, (data ?? []).map((item) => ({
    ...item,
    requested_value: sanitizeConfigValue(String(item.setting_key), String(item.requested_value ?? '')),
  }))));
});

settingsRoute.post('/approvals/:id/decision', requirePermission('setting.approve'), zValidator('json', settingDecisionSchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const { data: request, error: loadError } = await admin.from('system_setting_change_requests').select('*').eq('id', c.req.param('id')).maybeSingle();
  if (loadError) return dbFailJson(c, 'SETTING_APPROVAL_LOAD_FAILED', loadError);
  if (!request) return c.json(fail(requestId, 'SETTING_CHANGE_REQUEST_NOT_FOUND', 'ไม่พบคำขอเปลี่ยนค่าตั้งค่า'), 404);
  if (request.status !== 'pending') return c.json(fail(requestId, 'SETTING_CHANGE_REQUEST_NOT_PENDING', 'คำขอนี้ได้รับการพิจารณาแล้ว'), 409);
  if (request.requested_by === actorId) return c.json(fail(requestId, 'SETTING_APPROVAL_SOD', 'ผู้ยื่นคำขอไม่สามารถอนุมัติคำขอของตนเองได้'), 409);

  const { data, error } = await admin.rpc('decide_system_setting_change', {
    change_request_id_input: request.id,
    approver_id_input: actorId,
    decision_input: body.decision,
    approval_comment_input: body.comment ?? null,
    environment_label_input: normalizeEnvironmentLabel(c.env.ENVIRONMENT),
  });
  if (error) {
    const knownCode = settingRpcErrorCode(error.message);
    if (knownCode === 'SETTING_CHANGE_STALE') return c.json(fail(requestId, knownCode, 'ค่าตั้งค่าถูกเปลี่ยนไปแล้ว กรุณาสร้างคำขอใหม่จากค่าปัจจุบัน'), 409);
    if (knownCode) return c.json(fail(requestId, knownCode, 'ไม่สามารถพิจารณาคำขอนี้ได้'), 409);
    return dbFailJson(c, 'SETTING_APPROVAL_FAILED', error);
  }
  const result = data as { status?: string; request?: Record<string, unknown>; setting?: Record<string, unknown> };
  await writeAuditLog(c.env, {
    actorId, actorEmail: c.get('userEmail'), action: body.decision === 'approve' ? 'APPROVE_SETTING_CHANGE' : 'REJECT_SETTING_CHANGE',
    module: 'settings', targetTable: 'system_setting_change_requests', targetId: request.id,
    detail: { settingKey: request.setting_key, changeType: request.change_type, configVersion: request.base_version, status: result.status }, requestId,
  });
  return c.json(ok(requestId, {
    status: result.status ?? (body.decision === 'approve' ? 'approved' : 'rejected'),
    request: result.request,
    setting: result.setting,
  }));
});

settingsRoute.get('/:key/history', requirePermission('setting.view'), async (c) => {
  const requestId = c.get('requestId');
  const key = c.req.param('key')?.trim().toUpperCase() ?? '';
  const supabase = c.get('supabase');
  const [{ data: setting, error: settingError }, { data: history, error: historyError }] = await Promise.all([
    supabase.from('system_settings').select('key,config_version,criticality').eq('key', key).maybeSingle(),
    supabase.from('system_setting_versions').select('*').eq('setting_key', key).order('version', { ascending: false }).limit(50),
  ]);
  if (settingError) return dbFailJson(c, 'SETTING_HISTORY_SETTING_LOAD_FAILED', settingError);
  if (historyError) return dbFailJson(c, 'SETTING_HISTORY_LOAD_FAILED', historyError);
  if (!setting) return c.json(fail(requestId, 'SETTING_NOT_FOUND', 'ไม่พบค่าตั้งค่าที่ระบุ'), 404);
  return c.json(ok(requestId, {
    key,
    currentVersion: Number(setting.config_version ?? 1),
    criticality: setting.criticality ?? 'standard',
    history: (history ?? []).map((item) => ({
      ...item,
      value: sanitizeConfigValue(key, String(item.value ?? '')),
      previous_value: item.previous_value === null || item.previous_value === undefined ? null : sanitizeConfigValue(key, String(item.previous_value)),
    })),
  }));
});

settingsRoute.post('/:key/restore', requirePermission('setting.manage'), zValidator('json', restoreSystemSettingSchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId');
  const actorId = c.get('userId');
  const key = c.req.param('key')?.trim().toUpperCase() ?? '';
  const requested = c.req.valid('json');
  const supabase = c.get('supabase');
  const { data: current, error: loadError } = await supabase.from('system_settings').select('*').eq('key', key).maybeSingle();
  if (loadError) return dbFailJson(c, 'SETTING_LOAD_FAILED', loadError);
  if (!current) return c.json(fail(requestId, 'SETTING_NOT_FOUND', 'ไม่พบค่าตั้งค่าที่ระบุ'), 404);
  if (!current.is_editable) return c.json(fail(requestId, 'SETTING_READ_ONLY', 'ค่านี้จัดการผ่านระบบภายนอกหรือยังไม่พร้อมเปิดใช้งาน'), 409);
  const { data: source, error: sourceError } = await supabase.from('system_setting_versions').select('*').eq('setting_key', key).eq('version', requested.version).maybeSingle();
  if (sourceError) return dbFailJson(c, 'SETTING_HISTORY_LOAD_FAILED', sourceError);
  if (!source || requested.version >= Number(current.config_version ?? 1)) return c.json(fail(requestId, 'SETTING_RESTORE_VERSION_INVALID', 'เลือกได้เฉพาะ version ก่อนหน้าค่าปัจจุบัน'), 400);
  const normalized = normalizeSettingValue(key, String(source.value ?? ''));
  if (normalized.error || normalized.value === undefined) return c.json(fail(requestId, 'SETTING_VALUE_INVALID', normalized.error ?? 'ค่าเดิมไม่ถูกต้องตาม validation ปัจจุบัน'), 400);
  const environment = normalizeEnvironmentLabel(c.env.ENVIRONMENT);

  if (settingRequiresApproval(current)) {
    const { data: changeRequest, error } = await createSettingChangeRequest(createAdminClient(c.env), {
      settingKey: key, requestedValue: normalized.value, baseVersion: Number(current.config_version ?? 1), changeType: 'restore', sourceVersion: requested.version, requestedBy: actorId,
    });
    if (error) {
      if (error.code === '23505') return c.json(fail(requestId, 'SETTING_CHANGE_REQUEST_EXISTS', 'มีคำขอเปลี่ยนค่านี้ที่กำลังรออนุมัติอยู่แล้ว'), 409);
      return dbFailJson(c, 'SETTING_CHANGE_REQUEST_FAILED', error);
    }
    await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'REQUEST_SETTING_RESTORE', module: 'settings', targetTable: 'system_setting_change_requests', targetId: changeRequest.id, detail: { settingKey: key, sourceVersion: requested.version, baseVersion: current.config_version, criticality: current.criticality }, requestId });
    return c.json(ok(requestId, { status: 'pending', setting: current, request: sanitizeChangeRequest(changeRequest) }), 202);
  }

  const { data, error } = await createAdminClient(c.env).rpc('apply_system_setting_change', {
    setting_key_input: key, proposed_value_input: normalized.value, actor_id_input: actorId,
    environment_label_input: environment, change_type_input: 'restore', source_version_input: requested.version, change_request_id_input: null,
  });
  if (error) {
    const knownCode = settingRpcErrorCode(error.message);
    if (knownCode) return c.json(fail(requestId, knownCode, 'ไม่สามารถคืนค่าเดิมได้'), 409);
    return dbFailJson(c, 'SETTING_RESTORE_FAILED', error);
  }
  const result = data as { setting?: Record<string, unknown>; status?: string };
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'RESTORE_SETTING', module: 'settings', targetTable: 'system_settings', targetId: key, detail: { sourceVersion: requested.version, configVersion: result.setting?.config_version, environment }, requestId });
  return c.json(ok(requestId, result.setting));
});

settingsRoute.get('/', requirePermission('setting.view'), async (c) => {
  const requestId = c.get('requestId');
  const supabase = c.get('supabase');
  const [settingsResult, requestsResult] = await Promise.all([
    supabase.from('system_settings').select('*').order('sort_order').order('key'),
    supabase.from('system_setting_change_requests').select('*').eq('status', 'pending').order('created_at', { ascending: false }),
  ]);
  if (settingsResult.error) return dbFailJson(c, 'SETTINGS_LIST_FAILED', settingsResult.error);
  if (requestsResult.error) return dbFailJson(c, 'SETTING_APPROVALS_LOAD_FAILED', requestsResult.error);
  const settings = settingsResult.data ?? [];
  const environmentKey = normalizeEnvironmentLabel(c.env.ENVIRONMENT);
  const environmentLabel = environmentKey === 'dev' ? 'Dev' : environmentKey === 'uat' ? 'UAT' : environmentKey === 'prod' ? 'Prod' : 'Unknown';
  const configVersion = Math.max(1, ...settings.map((item) => Number(item.config_version ?? 1)));
  const pendingChanges = (requestsResult.data ?? []).map((item) => sanitizeChangeRequest(item));
  return c.json(ok(requestId, {
    settings,
    groups: [...new Set(settings.map((item) => String(item.group_key)))],
    summary: {
      total: settings.length,
      editable: settings.filter((item) => item.is_editable).length,
      deferred: settings.filter((item) => item.support_status === 'deferred').length,
      externallyManaged: settings.filter((item) => item.support_status === 'external').length,
      configVersion,
      critical: settings.filter((item) => settingRequiresApproval(item)).length,
      pendingApprovals: pendingChanges.length,
    },
    environment: { key: environmentKey, label: environmentLabel },
    capabilities: { canApprove: await hasPermission(c, 'setting.approve') },
    pendingChanges,
    notices: {
      secretsStoredHere: false,
      designerDeferred: true,
      integrationMessage: 'LINE/OAuth token และ secret ต้องตั้งที่ deployment environment และจะไม่ถูกอ่านกลับมาแสดงในหน้านี้',
    },
  }));
});

settingsRoute.patch('/:key', requirePermission('setting.manage'), zValidator('json', updateSystemSettingSchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId');
  const key = c.req.param('key')?.trim().toUpperCase() ?? '';
  const supabase = c.get('supabase');
  const { data: current, error: loadError } = await supabase.from('system_settings').select('*').eq('key', key).maybeSingle();
  if (loadError) return dbFailJson(c, 'SETTING_LOAD_FAILED', loadError);
  if (!current) return c.json(fail(requestId, 'SETTING_NOT_FOUND', 'ไม่พบค่าตั้งค่าที่ระบุ'), 404);
  if (!current.is_editable) return c.json(fail(requestId, 'SETTING_READ_ONLY', 'ค่านี้จัดการผ่านระบบภายนอกหรือยังไม่พร้อมเปิดใช้งาน'), 409);
  const normalized = normalizeSettingValue(key, c.req.valid('json').value);
  if (normalized.error || normalized.value === undefined) return c.json(fail(requestId, 'SETTING_VALUE_INVALID', normalized.error ?? 'ค่าตั้งค่าไม่ถูกต้อง'), 400);
  if (String(current.value ?? '') === normalized.value) return c.json(ok(requestId, current));

  if (settingRequiresApproval(current)) {
    const { data: changeRequest, error } = await createSettingChangeRequest(createAdminClient(c.env), {
      settingKey: key,
      requestedValue: normalized.value,
      baseVersion: Number(current.config_version ?? 1),
      changeType: 'update',
      requestedBy: c.get('userId'),
    });
    if (error) {
      if (error.code === '23505') return c.json(fail(requestId, 'SETTING_CHANGE_REQUEST_EXISTS', 'มีคำขอเปลี่ยนค่านี้ที่กำลังรออนุมัติอยู่แล้ว'), 409);
      return dbFailJson(c, 'SETTING_CHANGE_REQUEST_FAILED', error);
    }
    await writeAuditLog(c.env, { actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: 'REQUEST_SETTING_CHANGE', module: 'settings', targetTable: 'system_setting_change_requests', targetId: changeRequest.id, detail: { settingKey: key, baseVersion: current.config_version, criticality: current.criticality }, requestId });
    return c.json(ok(requestId, { status: 'pending', setting: current, request: sanitizeChangeRequest(changeRequest) }), 202);
  }

  const { data, error } = await createAdminClient(c.env).rpc('apply_system_setting_change', {
    setting_key_input: key,
    proposed_value_input: normalized.value,
    actor_id_input: c.get('userId'),
    environment_label_input: normalizeEnvironmentLabel(c.env.ENVIRONMENT),
    change_type_input: 'update',
    source_version_input: null,
    change_request_id_input: null,
  });
  if (error) {
    const knownCode = settingRpcErrorCode(error.message);
    if (knownCode) return c.json(fail(requestId, knownCode, 'ไม่สามารถแก้ไขค่าตั้งค่านี้ได้'), 409);
    return dbFailJson(c, 'SETTING_UPDATE_FAILED', error);
  }
  const result = data as { setting?: Record<string, unknown> };
  await writeAuditLog(c.env, { actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: 'UPDATE_SETTING', module: 'settings', targetTable: 'system_settings', targetId: key, detail: { changed: true, supportStatus: current.support_status, configVersion: result.setting?.config_version, environment: normalizeEnvironmentLabel(c.env.ENVIRONMENT) }, requestId });
  return c.json(ok(requestId, result.setting));
});
