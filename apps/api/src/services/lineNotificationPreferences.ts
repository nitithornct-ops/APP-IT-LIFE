import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '../lib/supabase';
import type { Bindings } from '../types';

/** Notification categories that can be muted for a LINE identity. */
export const LINE_NOTIFICATION_TYPES = [
  'ticket_assigned',
  'ticket_status_changed',
  'ticket_comment',
  'ticket_closed',
  'ticket_escalated',
  'ticket_outsource_response',
  'response_warning',
  'response_breached',
  'resolution_warning',
  'resolution_breached',
  'task_reminder',
  'workflow_approval',
  'workflow_result',
  'access_request_approval_needed',
  'access_request_pending_it',
  'change_requested',
  'change_approval_result',
  'change_deployed',
  'incident_assigned',
  'incident_closed',
  'incident_dpo_screening',
  'vulnerability_assigned',
  'vulnerability_status',
  'license_expiry',
  'contract_expiry',
  'backup_problem',
] as const;

export type LineNotificationType = typeof LINE_NOTIFICATION_TYPES[number];

export interface LineNotificationPreferences {
  disabledTypes: string[];
  updatedAt: string | null;
}

export function normalizeDisabledLineNotificationTypes(value: readonly string[] | null | undefined): string[] {
  return [...new Set((value ?? []).filter((type) => LINE_NOTIFICATION_TYPES.includes(type as LineNotificationType)))];
}

export async function getLineNotificationPreferences(
  admin: SupabaseClient,
  lineUserId: string,
): Promise<{ data: LineNotificationPreferences; error: { message: string } | null }> {
  const { data, error } = await admin
    .from('line_notification_preferences')
    .select('disabled_types, updated_at')
    .eq('line_user_id', lineUserId)
    .maybeSingle();
  if (error) return { data: { disabledTypes: [], updatedAt: null }, error };
  return {
    data: {
      disabledTypes: normalizeDisabledLineNotificationTypes(data?.disabled_types as string[] | null | undefined),
      updatedAt: (data?.updated_at as string | null | undefined) ?? null,
    },
    error: null,
  };
}

/**
 * Preference lookup is intentionally fail-open for delivery. A preference-table
 * outage must not silently turn a notification queue into failed ticket work.
 */
export async function isLineNotificationEnabled(
  env: Bindings,
  lineUserId: string | null | undefined,
  notificationType: string | null | undefined,
): Promise<boolean> {
  if (!lineUserId || !notificationType) return true;
  const { data, error } = await getLineNotificationPreferences(createAdminClient(env), lineUserId);
  if (error) {
    console.error(JSON.stringify({ msg: 'line_notification_preference_lookup_failed', error: error.message }));
    return true;
  }
  return !data.disabledTypes.includes(notificationType);
}
