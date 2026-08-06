import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import type { AppEnv } from '../types';
import { paginationRange, toPaginatedData } from '../utils/pagination';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import { listAuditLogsQuerySchema } from '../validators/auditLogs';

export const auditLogsRoute = new Hono<AppEnv>();
auditLogsRoute.use('*', requireAuth);

/** อ่านอย่างเดียว — เขียนได้ทาง Service Role เท่านั้น (services/auditService.ts) ไม่มี endpoint เขียนตรง */
auditLogsRoute.get('/', requirePermission('audit.view'), zValidator('query', listAuditLogsQuerySchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { page, pageSize, module, action } = c.req.valid('query');

  let query = supabase
    .from('audit_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(...paginationRange(page, pageSize));

  if (module) query = query.eq('module', module);
  if (action) query = query.eq('action', action);

  const { data, count, error } = await query;

  if (error) {
    return c.json(fail(reqId, 'AUDIT_LOGS_LIST_FAILED', 'ดึงรายการ Audit Log ไม่สำเร็จ'), 400);
  }

  return c.json(ok(reqId, toPaginatedData(data, count, page, pageSize)));
});
