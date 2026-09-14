import { createAdminClient } from '../lib/supabase';
import { sha256Hex } from './auditService';
import type { Bindings } from '../types';

function normalizedTimestamp(value: string | undefined): string | null {
  if (!value) return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? value : timestamp.toISOString();
}

export interface LoginLogEntry {
  id?: string;
  createdAt?: string;
  userId?: string | null;
  emailAttempted: string;
  success: boolean;
  failureReason?: string | null;
  mfaUsed?: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
  eventType?: 'login_attempt' | 'logout' | 'mfa_challenge' | 'password_reset' | 'password_change' | 'session_refresh';
  requestId?: string | null;
  correlationId?: string | null;
}

export function loginHashPayload(entry: LoginLogEntry): Record<string, unknown> {
  return {
    id: entry.id ?? null,
    createdAt: normalizedTimestamp(entry.createdAt),
    userId: entry.userId ?? null,
    emailAttempted: entry.emailAttempted,
    success: entry.success,
    failureReason: entry.failureReason ?? null,
    mfaUsed: entry.mfaUsed ?? false,
    ipAddress: entry.ipAddress ?? null,
    userAgent: entry.userAgent ?? null,
    eventType: entry.eventType ?? 'login_attempt',
    requestId: entry.requestId ?? null,
    correlationId: entry.correlationId ?? entry.requestId ?? null,
  };
}

/** บันทึกความพยายาม Login ทุกครั้ง (สำเร็จและล้มเหลว) — เขียนผ่าน Service Role เท่านั้น */
export async function writeLoginLog(env: Bindings, entry: LoginLogEntry): Promise<void> {
  try {
    const supabase = createAdminClient(env);
    const eventType = entry.eventType ?? 'login_attempt';
    const correlationId = entry.correlationId ?? entry.requestId ?? null;
    const id = entry.id ?? crypto.randomUUID();
    const createdAt = entry.createdAt ?? new Date().toISOString();
    const entryHash = await sha256Hex(loginHashPayload({ ...entry, id, createdAt, eventType, correlationId }));
    const { error } = await supabase.from('login_logs').insert({
      id,
      user_id: entry.userId ?? null,
      email_attempted: entry.emailAttempted,
      success: entry.success,
      failure_reason: entry.failureReason ?? null,
      mfa_used: entry.mfaUsed ?? false,
      ip_address: entry.ipAddress ?? null,
      user_agent: entry.userAgent ?? null,
      event_type: eventType,
      request_id: entry.requestId ?? null,
      correlation_id: correlationId,
      entry_hash: entryHash,
      hash_algorithm: 'sha256',
      created_at: createdAt,
    });

    if (error) {
      console.error(JSON.stringify({ msg: 'login_log_write_failed', error: error.message }));
      return;
    }

    if (entry.success && entry.userId) {
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', entry.userId);
      if (profileError) {
        console.error(JSON.stringify({ msg: 'last_login_update_failed', error: profileError.message, userId: entry.userId }));
      }
    }
  } catch (err) {
    console.error(JSON.stringify({ msg: 'login_log_write_exception', error: String(err) }));
  }
}
