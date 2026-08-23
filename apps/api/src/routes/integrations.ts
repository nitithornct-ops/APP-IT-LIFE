import { Hono } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { buildIntegrationCenter, type IntegrationOutboxRow, type LineDeliveryRow } from '../services/integrationCenterService';
import type { AppEnv } from '../types';
import { dbFailJson } from '../utils/dbError';
import { ok } from '../utils/response';

const OUTBOX_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'ERROR', 'DEAD', 'CANCELLED'] as const;

export const integrationsRoute = new Hono<AppEnv>();
integrationsRoute.use('*', requireAuth);

integrationsRoute.get('/overview', requirePermission('integration.view'), async (c) => {
  const admin = createAdminClient(c.env);
  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const [
    recentOutbox,
    recentLine,
    notificationCount,
    lineSuccessCount,
    lineFailureCount,
    activeLineUsersCount,
    managePermission,
    ...outboxCountResults
  ] = await Promise.all([
    admin.from('integration_outbox')
      .select('id,integration_code,event_type,target_module,status,attempt_count,max_attempts,next_attempt_at,last_error,created_at,processed_at')
      .order('created_at', { ascending: false }).limit(30),
    admin.from('line_notification_log').select('id,to_target,success,error,created_at').order('created_at', { ascending: false }).limit(30),
    admin.from('notifications').select('id', { count: 'exact', head: true }).gte('created_at', since),
    admin.from('line_notification_log').select('id', { count: 'exact', head: true }).eq('success', true).gte('created_at', since),
    admin.from('line_notification_log').select('id', { count: 'exact', head: true }).eq('success', false).gte('created_at', since),
    admin.from('line_users').select('id', { count: 'exact', head: true }).eq('link_status', 'Active'),
    c.get('supabase').rpc('has_permission', { permission_key_input: 'integration.manage' }),
    ...OUTBOX_STATUSES.map((status) => admin.from('integration_outbox').select('id', { count: 'exact', head: true }).eq('status', status)),
  ]);

  const failed = [recentOutbox, recentLine, notificationCount, lineSuccessCount, lineFailureCount, activeLineUsersCount, ...outboxCountResults].find((result) => result.error);
  if (failed?.error) return dbFailJson(c, 'INTEGRATION_OVERVIEW_LOAD_FAILED', failed.error, 'โหลดสถานะการเชื่อมต่อไม่สำเร็จ');

  const outboxCounts = Object.fromEntries(OUTBOX_STATUSES.map((status, index) => [status, outboxCountResults[index].count ?? 0]));
  return c.json(ok(c.get('requestId'), buildIntegrationCenter({
    env: c.env,
    canManage: !managePermission.error && managePermission.data === true,
    outboxCounts,
    notifications24h: notificationCount.count ?? 0,
    lineSuccess24h: lineSuccessCount.count ?? 0,
    lineFailure24h: lineFailureCount.count ?? 0,
    activeLineUsers: activeLineUsersCount.count ?? 0,
    outboxRows: (recentOutbox.data ?? []) as IntegrationOutboxRow[],
    lineRows: (recentLine.data ?? []) as LineDeliveryRow[],
  })));
});
