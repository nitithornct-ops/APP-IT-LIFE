import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import { updateSystemSettingSchema } from '../validators/settings';

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

settingsRoute.get('/', requirePermission('setting.view'), async (c) => {
  const requestId = c.get('requestId');
  const { data, error } = await c.get('supabase').from('system_settings').select('*').order('sort_order').order('key');
  if (error) return c.json(fail(requestId, 'SETTINGS_LIST_FAILED', error.message), 400);
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
  if (loadError) return c.json(fail(requestId, 'SETTING_LOAD_FAILED', loadError.message), 400);
  if (!current) return c.json(fail(requestId, 'SETTING_NOT_FOUND', 'ไม่พบค่าตั้งค่าที่ระบุ'), 404);
  if (!current.is_editable) return c.json(fail(requestId, 'SETTING_READ_ONLY', 'ค่านี้จัดการผ่านระบบภายนอกหรือยังไม่พร้อมเปิดใช้งาน'), 409);
  const normalized = normalizeSettingValue(key, c.req.valid('json').value);
  if (normalized.error || normalized.value === undefined) return c.json(fail(requestId, 'SETTING_VALUE_INVALID', normalized.error ?? 'ค่าตั้งค่าไม่ถูกต้อง'), 400);
  const { data, error } = await supabase.from('system_settings').update({ value: normalized.value, updated_by: c.get('userId') }).eq('key', key).select().single();
  if (error) return c.json(fail(requestId, 'SETTING_UPDATE_FAILED', error.message), 400);
  await writeAuditLog(c.env, { actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: 'UPDATE_SETTING', module: 'settings', targetTable: 'system_settings', targetId: key, detail: { changed: current.value !== normalized.value, supportStatus: current.support_status }, requestId });
  return c.json(ok(requestId, data));
});

