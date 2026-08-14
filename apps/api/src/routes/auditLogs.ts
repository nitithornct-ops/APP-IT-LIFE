import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import type { AppEnv } from '../types';
import { paginationRange, toPaginatedData } from '../utils/pagination';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import { auditOverviewQuerySchema, listAuditLogsQuerySchema, listLoginLogsQuerySchema } from '../validators/auditLogs';

export const auditLogsRoute = new Hono<AppEnv>();
auditLogsRoute.use('*', requireAuth);

function endOfDay(value: string): string {
  return `${value}T23:59:59.999+07:00`;
}

auditLogsRoute.get('/overview', requirePermission('audit.view'), zValidator('query', auditOverviewQuerySchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId');
  const since = new Date(Date.now() - c.req.valid('query').days * 86_400_000).toISOString();
  const supabase = c.get('supabase');
  const [audit, denied, failedActions, logins, failedLogins] = await Promise.all([
    supabase.from('audit_logs').select('id', { count: 'exact', head: true }).gte('created_at', since),
    supabase.from('audit_logs').select('id', { count: 'exact', head: true }).gte('created_at', since).eq('result', 'denied'),
    supabase.from('audit_logs').select('id', { count: 'exact', head: true }).gte('created_at', since).eq('result', 'fail'),
    supabase.from('login_logs').select('id', { count: 'exact', head: true }).gte('created_at', since),
    supabase.from('login_logs').select('id', { count: 'exact', head: true }).gte('created_at', since).eq('success', false),
  ]);
  const error = [audit, denied, failedActions, logins, failedLogins].find((result) => result.error)?.error;
  if (error) return dbFailJson(c, 'AUDIT_OVERVIEW_FAILED', error);
  return c.json(ok(requestId, { days: c.req.valid('query').days, auditTotal: audit.count ?? 0, denied: denied.count ?? 0, failedActions: failedActions.count ?? 0, loginTotal: logins.count ?? 0, failedLogins: failedLogins.count ?? 0 }));
});

auditLogsRoute.get('/login-logs', requirePermission('audit.view'), zValidator('query', listLoginLogsQuerySchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId');
  const { page, pageSize, email, success, from, to } = c.req.valid('query');
  let query = c.get('supabase').from('login_logs').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(...paginationRange(page, pageSize));
  if (email) query = query.ilike('email_attempted', `%${email}%`);
  if (success !== undefined) query = query.eq('success', success);
  if (from) query = query.gte('created_at', `${from}T00:00:00.000+07:00`);
  if (to) query = query.lte('created_at', endOfDay(to));
  const { data, count, error } = await query;
  if (error) return dbFailJson(c, 'LOGIN_LOGS_LIST_FAILED', error);
  return c.json(ok(requestId, toPaginatedData(data, count, page, pageSize)));
});

/** อ่านอย่างเดียว — เขียนได้ทาง Service Role เท่านั้น (services/auditService.ts) ไม่มี endpoint เขียนตรง */
auditLogsRoute.get('/', requirePermission('audit.view'), zValidator('query', listAuditLogsQuerySchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { page, pageSize, module, action, actor, result, from, to } = c.req.valid('query');

  let query = supabase
    .from('audit_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(...paginationRange(page, pageSize));

  if (module) query = query.eq('module', module);
  if (action) query = query.eq('action', action);
  if (actor) query = query.ilike('actor_email', `%${actor}%`);
  if (result) query = query.eq('result', result);
  if (from) query = query.gte('created_at', `${from}T00:00:00.000+07:00`);
  if (to) query = query.lte('created_at', endOfDay(to));

  const { data, count, error } = await query;

  if (error) {
    return c.json(fail(reqId, 'AUDIT_LOGS_LIST_FAILED', 'ดึงรายการ Audit Log ไม่สำเร็จ'), 400);
  }

  return c.json(ok(reqId, toPaginatedData(data, count, page, pageSize)));
});
