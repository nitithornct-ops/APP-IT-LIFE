import { createAdminClient } from '../lib/supabase';
import type { Bindings } from '../types';

export async function dispatchDueTaskReminders(env: Bindings, now = new Date()): Promise<number> {
  const supabase = createAdminClient(env);
  const { data, error } = await supabase.rpc('dispatch_due_task_reminders', { p_now: now.toISOString() });
  if (error) throw new Error(`task_reminder_dispatch_failed: ${error.message}`);
  return Number(data ?? 0);
}
