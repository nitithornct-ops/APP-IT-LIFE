import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { loadSystemStatus, refreshInternalSystemStatus } from '../services/systemStatusService';
import type { AppEnv } from '../types';
import { fail, ok } from '../utils/response';

export const systemStatusRoute = new Hono<AppEnv>();
systemStatusRoute.use('*', requireAuth);

/** Internal status view. It is authenticated and intentionally excludes secrets and raw upstream errors. */
systemStatusRoute.get('/', async (c) => {
  try {
    await refreshInternalSystemStatus(c.env);
    return c.json(ok(c.get('requestId'), await loadSystemStatus(c.env)));
  } catch {
    return c.json(fail(c.get('requestId'), 'SYSTEM_STATUS_UNAVAILABLE', 'ไม่สามารถโหลดสถานะระบบได้ชั่วคราว'), 503);
  }
});
