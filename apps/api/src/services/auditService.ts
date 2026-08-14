import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '../lib/supabase';
import type { Bindings } from '../types';

/**
 * อ่านสถานะของแถวก่อนแก้ไข เพื่อส่งเข้า writeAuditLog เป็นค่า before
 * ใช้ client ที่ผูกกับ JWT ของผู้ใช้เสมอ — ถ้า RLS ไม่ให้เห็นแถวนั้น ก็ไม่ควรบันทึกเนื้อหาของมันลง log
 * คืน null เมื่ออ่านไม่ได้ ผู้เรียกยังบันทึก audit ต่อได้ (แค่ไม่มีรายการ changes)
 */
export async function loadAuditSnapshot(
  supabase: SupabaseClient,
  table: string,
  id: string | null | undefined,
): Promise<Record<string, unknown> | null> {
  if (!id) return null;
  const { data } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
  return asPlainObject(data);
}

/** รับค่าที่ Supabase คืนมาแล้วคัดเฉพาะกรณีที่เป็น object ธรรมดาจริง ๆ (ไม่ใช่ error หรือ array) */
function asPlainObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export interface AuditLogEntry {
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
}

/** คอลัมน์ที่เปลี่ยนทุกครั้งอยู่แล้ว ไม่ใช่สาระของการแก้ไข จึงไม่ต้องรกอยู่ในรายการ changes */
const NOISE_COLUMNS = new Set(['updated_at', 'updated_by', 'created_at', 'created_by']);

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
 * ความล้มเหลวของการเขียน Audit Log ต้องไม่ทำให้ request หลักล้มตาม จึง catch ไว้ในนี้
 */
export async function writeAuditLog(env: Bindings, entry: AuditLogEntry): Promise<void> {
  try {
    const supabase = createAdminClient(env);
    const changes = diffRows(entry.before, entry.after);
    const detail =
      entry.before || entry.after
        ? { ...(entry.detail ?? {}), changes, changedFields: Object.keys(changes) }
        : entry.detail;
    const { error } = await supabase.from('audit_logs').insert({
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
    });

    if (error) {
      console.error(JSON.stringify({ msg: 'audit_log_write_failed', error: error.message }));
    }
  } catch (err) {
    console.error(JSON.stringify({ msg: 'audit_log_write_exception', error: String(err) }));
  }
}
