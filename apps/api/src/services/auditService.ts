import { createAdminClient } from '../lib/supabase';
import type { Bindings } from '../types';

export interface AuditLogEntry {
  actorId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  action: string;
  module: string;
  targetTable?: string | null;
  targetId?: string | null;
  detail?: Record<string, unknown> | null;
  result?: 'success' | 'fail' | 'denied';
  requestId?: string | null;
}

/**
 * บันทึก Audit Log — ต้องใช้ Service Role เท่านั้น เพราะ audit_logs ไม่มี insert policy
 * ให้ authenticated (ป้องกันผู้ใช้ทั่วไปปลอมแปลง Log ของตัวเอง)
 * ความล้มเหลวของการเขียน Audit Log ต้องไม่ทำให้ request หลักล้มตาม จึง catch ไว้ในนี้
 */
export async function writeAuditLog(env: Bindings, entry: AuditLogEntry): Promise<void> {
  try {
    const supabase = createAdminClient(env);
    const { error } = await supabase.from('audit_logs').insert({
      actor_id: entry.actorId ?? null,
      actor_email: entry.actorEmail ?? null,
      actor_role: entry.actorRole ?? null,
      action: entry.action,
      module: entry.module,
      target_table: entry.targetTable ?? null,
      target_id: entry.targetId ?? null,
      detail: entry.detail ?? null,
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
