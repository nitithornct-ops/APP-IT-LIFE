import { createAdminClient } from '../lib/supabase';
import type { Bindings } from '../types';

/** Revoke temporary RBAC grants whose expiry has passed. Called by the Worker cron. */
export async function dispatchAccessExpiry(env: Bindings, _scheduledAt = new Date()): Promise<number> {
  const { data, error } = await createAdminClient(env).rpc('expire_temporary_access');
  if (error) throw new Error(`temporary access expiry failed: ${error.message}`);
  return Number(data ?? 0);
}
