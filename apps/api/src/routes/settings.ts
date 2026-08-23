import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { writeAuditLog } from '../services/auditService';
import { buildSlaImpactSummary, type SlaImpactTicket } from '../services/slaImpactService';
import { parseTicketBusinessCalendar } from '../services/ticketSlaService';
import type { AppEnv, Bindings } from '../types';
import { dbFailJson } from '../utils/dbError';
import { verifyFileSignature } from '../utils/fileSignature';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import { slaImpactQuerySchema, updateSystemSettingSchema } from '../validators/settings';

const BRANDING_BUCKET = 'branding';
const ORGANIZATION_LOGO_KEY = 'ORG_LOGO_URL';
const TICKET_FORM_SIGNATURE_KEY = 'TICKET_FORM_SIGNATURE_PATH';
const TICKET_SIGNATURE_BUCKET = 'ticket-signatures';
const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024;
const MAX_TICKET_SIGNATURE_BYTES = 2 * 1024 * 1024;
const LOGO_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const BOOLEAN_KEYS = new Set([
  'NOTIFY_LINE_ENABLED', 'ADMIN_MFA_ENABLED', 'LINE_LOGIN_ENABLED', 'LINE_REQUIRE_EMPLOYEE_LINK',
  'LINE_AUTO_APPROVE_EMPLOYEE_LINK', 'PUBLIC_TICKET_ENABLED', 'PUBLIC_TICKET_REQUIRE_LINE',
  'PUBLIC_TICKET_EMAIL_OTP_ENABLED', 'PUBLIC_TICKET_CONSENT_REQUIRED', 'AUTO_BACKUP_ENABLED',
  'AUTO_RESTORE_DRILL_ENABLED', 'RETENTION_TRASH_EVIDENCE',
]);

const NUMBER_RANGES: Record<string, [number, number]> = {
  NOTIFY_LEAD_DAYS: [1, 365], LINE_QUEUE_MAX_ATTEMPTS: [1, 10], REVIEW_CYCLE_DAYS: [1, 1095],
  INCIDENT_DPO_ESCALATION_HOURS: [1, 24], LOGIN_MAX_FAILS_5MIN: [5, 30], PASSWORD_HASH_ITERATIONS: [1000, 20000],
  LINE_SESSION_HOURS: [1, 720], PUBLIC_TICKET_MAX_FILES: [1, 5], PUBLIC_TICKET_MAX_FILE_MB: [1, 15],
  PUBLIC_TICKET_MAX_TOTAL_MB: [1, 50], PUBLIC_TICKET_MAX_PER_HOUR: [1, 20], PUBLIC_TICKET_MAX_PER_DAY: [1, 50],
  PUBLIC_TICKET_GLOBAL_MAX_PER_HOUR: [10, 1000], PUBLIC_TICKET_GLOBAL_MAX_PER_DAY: [20, 5000],
  BACKUP_RETENTION_DAYS: [7, 3650], RESTORE_SANDBOX_RETENTION_DAYS: [7, 3650], BACKUP_HEALTH_MAX_HOURS: [1, 168],
  LINE_SESSION_RETENTION_DAYS: [1, 3650], NOTIFICATION_LOG_RETENTION_DAYS: [30, 3650],
  NOTIFICATION_QUEUE_RETENTION_DAYS: [7, 3650], TICKET_PII_RETENTION_DAYS: [30, 36500],
  SERVICE_REQUEST_PII_RETENTION_DAYS: [30, 36500], WORKFLOW_PII_RETENTION_DAYS: [30, 36500],
  ATTACHMENT_RETENTION_DAYS: [30, 36500], ATTACHMENT_STAGED_RETENTION_HOURS: [1, 720],
  ATTACHMENT_DOWNLOAD_MAX_MB: [1, 15], SOFT_DELETE_RETENTION_DAYS: [30, 36500],
};

const UNSUPPORTED_ENABLE_KEYS = new Set(['NOTIFY_LINE_ENABLED', 'LINE_LOGIN_ENABLED', 'PUBLIC_TICKET_ENABLED', 'AUTO_BACKUP_ENABLED', 'AUTO_RESTORE_DRILL_ENABLED']);

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
  if (key === 'PUBLIC_TICKET_ALLOWED_EMAIL_DOMAINS') return { value: raw.split(',').map((domain) => domain.trim().toLowerCase()).filter(Boolean).join(',') };
  return { value: raw };
}

export const settingsRoute = new Hono<AppEnv>();
settingsRoute.use('*', requireAuth);

settingsRoute.get('/branding', async (c) => {
  return c.json(ok(c.get('requestId'), await loadBranding(c.env)));
});

async function loadTicketFormSignature(env: Bindings) {
  const admin = createAdminClient(env);
  const { data: setting } = await admin.from('system_settings')
    .select('value, updated_at')
    .eq('key', TICKET_FORM_SIGNATURE_KEY)
    .maybeSingle();
  const storagePath = String(setting?.value ?? '');
  let signatureUrl: string | null = null;
  if (storagePath) {
    const { data } = await admin.storage.from(TICKET_SIGNATURE_BUCKET).createSignedUrl(storagePath, 3600);
    signatureUrl = data?.signedUrl ?? null;
  }
  return { signatureUrl, uploadedAt: storagePath ? setting?.updated_at ?? null : null };
}

settingsRoute.get('/ticket-form-signature', requirePermission('setting.view'), async (c) => {
  return c.json(ok(c.get('requestId'), await loadTicketFormSignature(c.env)));
});

settingsRoute.post('/ticket-form-signature', requirePermission('setting.manage'), async (c) => {
  const requestId = c.get('requestId');
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json(fail(requestId, 'TICKET_FORM_SIGNATURE_REQUIRED', 'กรุณาเลือกไฟล์ลายเซ็น PNG'), 400);
  if (file.type !== 'image/png') return c.json(fail(requestId, 'TICKET_FORM_SIGNATURE_TYPE_NOT_ALLOWED', 'ลายเซ็นต้องเป็นไฟล์ PNG เท่านั้น'), 400);
  if (file.size > MAX_TICKET_SIGNATURE_BYTES) return c.json(fail(requestId, 'TICKET_FORM_SIGNATURE_TOO_LARGE', 'ไฟล์ลายเซ็นต้องมีขนาดไม่เกิน 2 MB'), 400);
  const signature = await verifyFileSignature(file, 'image/png');
  if (!signature.ok) return c.json(fail(requestId, 'TICKET_FORM_SIGNATURE_CONTENT_MISMATCH', signature.reason ?? 'เนื้อหาไฟล์ไม่ใช่ PNG'), 400);

  const admin = createAdminClient(c.env);
  const { data: current, error: loadError } = await admin.from('system_settings').select('value').eq('key', TICKET_FORM_SIGNATURE_KEY).maybeSingle();
  if (loadError || !current) return c.json(fail(requestId, 'TICKET_FORM_SIGNATURE_SETTING_NOT_FOUND', 'ไม่พบค่าตั้งค่าลายเซ็นกลาง กรุณาอัปเดตฐานข้อมูลก่อน'), 409);
  const path = `default/${crypto.randomUUID()}.png`;
  const { error: uploadError } = await admin.storage.from(TICKET_SIGNATURE_BUCKET).upload(path, file, { contentType: 'image/png', cacheControl: '3600', upsert: false });
  if (uploadError) return dbFailJson(c, 'TICKET_FORM_SIGNATURE_UPLOAD_FAILED', uploadError);
  const { error: updateError } = await admin.from('system_settings').update({ value: path, updated_by: c.get('userId'), updated_at: new Date().toISOString() }).eq('key', TICKET_FORM_SIGNATURE_KEY);
  if (updateError) {
    await admin.storage.from(TICKET_SIGNATURE_BUCKET).remove([path]);
    return dbFailJson(c, 'TICKET_FORM_SIGNATURE_SAVE_FAILED', updateError);
  }
  const previousPath = String(current.value ?? '');
  if (previousPath && previousPath !== path) await admin.storage.from(TICKET_SIGNATURE_BUCKET).remove([previousPath]);
  await writeAuditLog(c.env, { actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: 'UPDATE_TICKET_FORM_SIGNATURE', module: 'settings', targetTable: 'system_settings', targetId: TICKET_FORM_SIGNATURE_KEY, detail: { sizeBytes: file.size, replaced: Boolean(previousPath) }, requestId });
  return c.json(ok(requestId, await loadTicketFormSignature(c.env)));
});

settingsRoute.delete('/ticket-form-signature', requirePermission('setting.manage'), async (c) => {
  const requestId = c.get('requestId');
  const admin = createAdminClient(c.env);
  const { data: current, error: loadError } = await admin.from('system_settings').select('value').eq('key', TICKET_FORM_SIGNATURE_KEY).maybeSingle();
  if (loadError || !current) return c.json(fail(requestId, 'TICKET_FORM_SIGNATURE_SETTING_NOT_FOUND', 'ไม่พบค่าตั้งค่าลายเซ็นกลาง'), 404);
  const previousPath = String(current.value ?? '');
  const { error: updateError } = await admin.from('system_settings').update({ value: '', updated_by: c.get('userId'), updated_at: new Date().toISOString() }).eq('key', TICKET_FORM_SIGNATURE_KEY);
  if (updateError) return dbFailJson(c, 'TICKET_FORM_SIGNATURE_DELETE_FAILED', updateError);
  if (previousPath) await admin.storage.from(TICKET_SIGNATURE_BUCKET).remove([previousPath]);
  await writeAuditLog(c.env, { actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: 'DELETE_TICKET_FORM_SIGNATURE', module: 'settings', targetTable: 'system_settings', targetId: TICKET_FORM_SIGNATURE_KEY, requestId });
  return c.json(ok(requestId, await loadTicketFormSignature(c.env)));
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
  const { data: current, error: loadError } = await admin.from('system_settings').select('value').eq('key', ORGANIZATION_LOGO_KEY).maybeSingle();
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
  const { error: updateError } = await admin.from('system_settings').update({ value: logoUrl, updated_by: c.get('userId') }).eq('key', ORGANIZATION_LOGO_KEY);
  if (updateError) {
    await admin.storage.from(BRANDING_BUCKET).remove([path]);
    return dbFailJson(c, 'LOGO_SETTING_UPDATE_FAILED', updateError);
  }

  const previousPath = brandingStoragePath(String(current.value ?? ''));
  if (previousPath && previousPath !== path) await admin.storage.from(BRANDING_BUCKET).remove([previousPath]);
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
  const { data: current, error: loadError } = await admin.from('system_settings').select('value').eq('key', ORGANIZATION_LOGO_KEY).maybeSingle();
  if (loadError || !current) return c.json(fail(requestId, 'LOGO_SETTING_NOT_FOUND', 'ไม่พบค่าตั้งค่าโลโก้'), 404);
  const { error: updateError } = await admin.from('system_settings').update({ value: '', updated_by: c.get('userId') }).eq('key', ORGANIZATION_LOGO_KEY);
  if (updateError) return dbFailJson(c, 'LOGO_SETTING_UPDATE_FAILED', updateError);
  const previousPath = brandingStoragePath(String(current.value ?? ''));
  if (previousPath) await admin.storage.from(BRANDING_BUCKET).remove([previousPath]);
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

settingsRoute.get('/', requirePermission('setting.view'), async (c) => {
  const requestId = c.get('requestId');
  const { data, error } = await c.get('supabase').from('system_settings').select('*').order('sort_order').order('key');
  if (error) return dbFailJson(c, 'SETTINGS_LIST_FAILED', error);
  const settings = data ?? [];
  return c.json(ok(requestId, {
    settings,
    groups: [...new Set(settings.map((item) => String(item.group_key)))],
    summary: {
      total: settings.length,
      editable: settings.filter((item) => item.is_editable).length,
      deferred: settings.filter((item) => item.support_status === 'deferred').length,
      externallyManaged: settings.filter((item) => item.support_status === 'external').length,
    },
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
  const { data, error } = await supabase.from('system_settings').update({ value: normalized.value, updated_by: c.get('userId') }).eq('key', key).select().single();
  if (error) return dbFailJson(c, 'SETTING_UPDATE_FAILED', error);
  await writeAuditLog(c.env, { actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: 'UPDATE_SETTING', module: 'settings', targetTable: 'system_settings', targetId: key, detail: { changed: current.value !== normalized.value, supportStatus: current.support_status }, requestId });
  return c.json(ok(requestId, data));
});
