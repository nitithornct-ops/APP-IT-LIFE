import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '../lib/supabase';
import type { Bindings } from '../types';

/**
 * อ่านสถานะของแถวก่อนแก้ไข เพื่อส่งเข้า writeAuditLog เป็นค่า before
 * ใช้ client ที่ผูกกับ JWT ของผู้ใช้เสมอ — ถ้า RLS ไม่ให้เห็นแถวนั้น ก็ไม่ควรบันทึกเนื้อหาของมันลง log
 * คืน null เมื่ออ่านไม่ได้ ผู้เรียกยังบันทึก audit ต่อได้ (แค่ไม่มีรายการ changes)
 * Snapshot ที่คืนถูกลบข้อมูลส่วนบุคคล/เนื้อหาอิสระก่อนเสมอ เพื่อลดการคัดลอกข้อมูลทั้งแถวลง audit
 */
export async function loadAuditSnapshot(
  supabase: SupabaseClient,
  table: string,
  id: string | null | undefined,
): Promise<Record<string, unknown> | null> {
  if (!id) return null;
  const { data } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
  return sanitizeAuditData(asPlainObject(data));
}

/** รับค่าที่ Supabase คืนมาแล้วคัดเฉพาะกรณีที่เป็น object ธรรมดาจริง ๆ (ไม่ใช่ error หรือ array) */
function asPlainObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export interface AuditLogEntry {
  id?: string;
  createdAt?: string;
  actorId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  action: string;
  module: string;
  targetTable?: string | null;
  targetId?: string | null;
  detail?: Record<string, unknown> | null;
  /** สถานะของแถวก่อนแก้ไข — ใส่คู่กับ after เพื่อให้ log บอกได้ว่าเปลี่ยน "จากอะไรเป็นอะไร" */
  before?: unknown;
  /** สถานะของแถวหลังแก้ไข (ปกติคือค่าที่ได้จาก .select().single()) */
  after?: unknown;
  result?: 'success' | 'fail' | 'denied';
  requestId?: string | null;
  correlationId?: string | null;
  eventCategory?: AuditEventCategory;
  privilegedAction?: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export type AuditEventCategory =
  | 'authentication'
  | 'authorization'
  | 'data_change'
  | 'privileged_action'
  | 'administration'
  | 'access_review'
  | 'backup'
  | 'export'
  | 'security'
  | 'system';

const PRIVILEGED_ACTION = /(?:ACCESS_DENIED|PERMISSION|APPROV|REJECT|EXPORT|ARCHIVE|VERIFY|DEPLOY|ROLE|PASSWORD|MFA|RESTORE|DISABLE|ENABLE)/i;

export function isPrivilegedAuditAction(entry: Pick<AuditLogEntry, 'action' | 'module' | 'privilegedAction'>): boolean {
  return entry.privilegedAction ?? PRIVILEGED_ACTION.test(`${entry.action} ${entry.module}`);
}

export function inferAuditEventCategory(entry: Pick<AuditLogEntry, 'action' | 'module' | 'eventCategory'>): AuditEventCategory {
  if (entry.eventCategory) return entry.eventCategory;
  const action = entry.action.toUpperCase();
  const module = entry.module.toLowerCase();
  if (/^(LOGIN|LOGOUT|MFA_CHALLENGE|PASSWORD_RESET|PASSWORD_CHANGE)$/.test(action) || /^(auth|authentication|login)$/.test(module)) return 'authentication';
  if (action === 'ACCESS_DENIED' || action === 'PERMISSION_DENIED' || /^(authorization|permission|rbac)$/.test(module)) return 'authorization';
  if (action.startsWith('EXPORT') || module.includes('export')) return 'export';
  if (module.includes('backup') || module.includes('recovery')) return 'backup';
  if (module.includes('access') && (module.includes('review') || module.includes('certification'))) return 'access_review';
  if (action.includes('PASSWORD') || action.includes('MFA') || action.includes('SECURITY') || module.includes('security')) return 'security';
  if (action.includes('ROLE') || action.includes('PERMISSION') || /^(admin|administration|settings|users)$/.test(module)) return 'administration';
  if (/^(CREATE|UPDATE|DELETE|INSERT|UPSERT)(_|$)/.test(action)) return 'data_change';
  if (isPrivilegedAuditAction({ action: entry.action, module: entry.module })) return 'privileged_action';
  return 'system';
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

function normalizedTimestamp(value: string | undefined): string | null {
  if (!value) return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? value : timestamp.toISOString();
}

export function auditHashPayload(entry: Pick<AuditLogEntry, 'id' | 'createdAt' | 'actorId' | 'actorEmail' | 'actorRole' | 'action' | 'module' | 'targetTable' | 'targetId' | 'detail' | 'result' | 'requestId' | 'correlationId' | 'eventCategory' | 'privilegedAction'>): Record<string, unknown> {
  return {
    id: entry.id ?? null,
    createdAt: normalizedTimestamp(entry.createdAt),
    actorId: entry.actorId ?? null,
    actorEmail: entry.actorEmail ?? null,
    actorRole: entry.actorRole ?? null,
    action: entry.action,
    module: entry.module,
    targetTable: entry.targetTable ?? null,
    targetId: entry.targetId ?? null,
    detail: entry.detail ?? null,
    result: entry.result ?? 'success',
    requestId: entry.requestId ?? null,
    correlationId: entry.correlationId ?? null,
    eventCategory: entry.eventCategory ?? 'system',
    privilegedAction: entry.privilegedAction ?? false,
  };
}

export async function sha256Hex(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Detect a partially-applied audit hardening migration without hiding ordinary
 * database outages or permission failures. This is used to keep the legacy
 * audit trail usable while the additive integrity/archive schema catches up.
 */
export function isAuditHardeningSchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === 'string' ? candidate.code : '';
  const message = typeof candidate.message === 'string' ? candidate.message : '';
  if (!['PGRST204', 'PGRST205', '42703', '42P01'].includes(code)) return false;
  return /audit_activity_alerts|audit_log_archive|login_log_archive|audit_retention_policies|event_category|privileged_action|correlation_id|entry_hash|hash_algorithm|event_type/i.test(message);
}

/** คอลัมน์ที่เปลี่ยนทุกครั้งอยู่แล้ว ไม่ใช่สาระของการแก้ไข จึงไม่ต้องรกอยู่ในรายการ changes */
const NOISE_COLUMNS = new Set(['updated_at', 'updated_by', 'created_at', 'created_by']);
const SENSITIVE_AUDIT_KEY = /(?:password|passcode|token|secret|signature|signed_?url|storage_?path|file_?path|attachment|phone|e-?mail|employee_?code|full_?name|first_?name|last_?name|description|resolution|reason|notes?|body|comment|address|symptom|root_?cause)/i;
const REDACTED = '[REDACTED]';

function sanitizeAuditValue(value: unknown, depth: number): unknown {
  if (depth > 4) return '[TRUNCATED]';
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => sanitizeAuditValue(entry, depth + 1));
  const objectValue = asPlainObject(value);
  if (!objectValue) return value;

  return Object.fromEntries(
    Object.entries(objectValue).map(([key, entry]) => [
      key,
      SENSITIVE_AUDIT_KEY.test(key) ? REDACTED : sanitizeAuditValue(entry, depth + 1),
    ]),
  );
}

/** ลบ credentials, PII และ free text ที่อาจมี PII ก่อนเขียนลงหลักฐาน audit */
export function sanitizeAuditData(value: unknown): Record<string, unknown> | null {
  const plain = asPlainObject(value);
  if (!plain) return null;
  return sanitizeAuditValue(plain, 0) as Record<string, unknown>;
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || left === undefined) return right === null || right === undefined;
  if (typeof left === 'object' || typeof right === 'object') return JSON.stringify(left) === JSON.stringify(right);
  return String(left) === String(right);
}

/**
 * เทียบสถานะก่อน/หลัง แล้วคืนเฉพาะฟิลด์ที่เปลี่ยนค่าจริง
 *
 * เดิม audit เก็บแค่ payload ที่ผู้ใช้ส่งมา ซึ่งตอบไม่ได้ว่าค่าเดิมคืออะไร และถ้าผู้ใช้ส่งค่าเดิมกลับมา
 * ก็ยังถูกบันทึกเหมือนมีการแก้ไข ทำให้หลักฐานการตรวจสอบใช้อ้างอิงไม่ได้จริง
 * (พบตอน Pre-production QA audit 2026-08-13)
 */
export function diffRows(
  beforeValue: unknown,
  afterValue: unknown,
): Record<string, { from: unknown; to: unknown }> {
  const before = asPlainObject(beforeValue);
  const after = asPlainObject(afterValue);
  if (!before || !after) return {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (NOISE_COLUMNS.has(key)) continue;
    if (!sameValue(before[key], after[key])) changes[key] = { from: before[key] ?? null, to: after[key] ?? null };
  }
  return changes;
}

/**
 * บันทึก Audit Log — ต้องใช้ Service Role เท่านั้น เพราะ audit_logs ไม่มี insert policy
 * ให้ authenticated (ป้องกันผู้ใช้ทั่วไปปลอมแปลง Log ของตัวเอง)
 * หากเขียนไม่ได้จะ throw ให้ request ล้มและส่ง structured log ออกไป แทนการ fail-open แบบเดิม
 * ส่วน mutation ที่มีผลต่อ security/ledger มี database trigger หรือ transactional RPC เป็นหลักฐาน
 * แบบ atomic อีกชั้นหนึ่ง
 */
export async function writeAuditLog(env: Bindings, entry: AuditLogEntry): Promise<void> {
  try {
    const supabase = createAdminClient(env);
    const safeBefore = sanitizeAuditData(entry.before);
    const safeAfter = sanitizeAuditData(entry.after);
    const changes = diffRows(safeBefore, safeAfter);
    const safeDetail = sanitizeAuditData(entry.detail);
    const detail =
      entry.before || entry.after
        ? { ...(safeDetail ?? {}), changes, changedFields: Object.keys(changes) }
        : safeDetail;
    const correlationId = entry.correlationId ?? entry.requestId ?? null;
    const eventCategory = inferAuditEventCategory(entry);
    const privilegedAction = isPrivilegedAuditAction(entry);
    const id = entry.id ?? crypto.randomUUID();
    const createdAt = entry.createdAt ?? new Date().toISOString();
    const hashPayload = auditHashPayload({
      ...entry,
      id,
      createdAt,
      detail,
      requestId: entry.requestId ?? null,
      correlationId,
      eventCategory,
      privilegedAction,
    });
    const entryHash = await sha256Hex(hashPayload);
    const auditRow = {
      id,
      actor_id: entry.actorId ?? null,
      actor_email: entry.actorEmail ?? null,
      actor_role: entry.actorRole ?? null,
      action: entry.action,
      module: entry.module,
      target_table: entry.targetTable ?? null,
      target_id: entry.targetId ?? null,
      detail: detail ?? null,
      result: entry.result ?? 'success',
      request_id: entry.requestId ?? null,
      correlation_id: correlationId,
      event_category: eventCategory,
      privileged_action: privilegedAction,
      entry_hash: entryHash,
      hash_algorithm: 'sha256',
      ip_address: entry.ipAddress ?? null,
      user_agent: entry.userAgent ?? null,
      created_at: createdAt,
    };
    const { error } = await supabase.from('audit_logs').insert(auditRow);

    if (error) {
      if (!isAuditHardeningSchemaError(error)) throw new Error(error.message);

      // The core audit columns pre-date the hardening migration. Retry with
      // that stable contract so a missing additive column never breaks the
      // business mutation that was being audited.
      const { error: legacyError } = await supabase.from('audit_logs').insert({
        id: auditRow.id,
        actor_id: auditRow.actor_id,
        actor_email: auditRow.actor_email,
        actor_role: auditRow.actor_role,
        action: auditRow.action,
        module: auditRow.module,
        target_table: auditRow.target_table,
        target_id: auditRow.target_id,
        detail: auditRow.detail,
        result: auditRow.result,
        request_id: auditRow.request_id,
        ip_address: auditRow.ip_address,
        user_agent: auditRow.user_agent,
        created_at: auditRow.created_at,
      });
      if (legacyError) throw new Error(legacyError.message);
      console.warn(JSON.stringify({ msg: 'audit_log_hardening_schema_pending', requestId: entry.requestId ?? null }));
    }
  } catch (err) {
    console.error(JSON.stringify({ msg: 'audit_log_write_exception', error: String(err) }));
    throw new Error('AUDIT_LOG_WRITE_FAILED', { cause: err });
  }
}
