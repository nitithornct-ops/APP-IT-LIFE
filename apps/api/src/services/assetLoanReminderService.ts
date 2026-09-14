import { createAdminClient } from '../lib/supabase';
import type { Bindings } from '../types';

/** Dispatches the one reminder scheduled for each active Asset loan. */
export async function dispatchDueAssetLoanReminders(env: Bindings, now = new Date()): Promise<number> {
  const supabase = createAdminClient(env);
  const { data, error } = await supabase.rpc('dispatch_due_asset_loan_reminders', { p_now: now.toISOString() });
  if (error) throw new Error(`asset_loan_reminder_dispatch_failed: ${error.message}`);
  return Number(data ?? 0);
}
