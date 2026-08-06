import { createAdminClient } from '../lib/supabase';
import type { Bindings } from '../types';

export interface LoginLogEntry {
  userId?: string | null;
  emailAttempted: string;
  success: boolean;
  failureReason?: string | null;
  mfaUsed?: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** บันทึกความพยายาม Login ทุกครั้ง (สำเร็จและล้มเหลว) — เขียนผ่าน Service Role เท่านั้น */
export async function writeLoginLog(env: Bindings, entry: LoginLogEntry): Promise<void> {
  try {
    const supabase = createAdminClient(env);
    const { error } = await supabase.from('login_logs').insert({
      user_id: entry.userId ?? null,
      email_attempted: entry.emailAttempted,
      success: entry.success,
      failure_reason: entry.failureReason ?? null,
      mfa_used: entry.mfaUsed ?? false,
      ip_address: entry.ipAddress ?? null,
      user_agent: entry.userAgent ?? null,
    });

    if (error) {
      console.error(JSON.stringify({ msg: 'login_log_write_failed', error: error.message }));
    }
  } catch (err) {
    console.error(JSON.stringify({ msg: 'login_log_write_exception', error: String(err) }));
  }
}
