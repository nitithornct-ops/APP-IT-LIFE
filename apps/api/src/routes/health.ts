import { Hono } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { clientIp, edgeRateLimit, rateLimit } from '../middleware/rateLimit';
import type { AppEnv, Bindings } from '../types';
import { ok } from '../utils/response';

export const healthRoute = new Hono<AppEnv>();
healthRoute.use('*', edgeRateLimit({ keyFn: (c) => `health:${clientIp(c)}` }));
healthRoute.use('*', rateLimit({ windowMs: 60_000, max: 30, keyFn: (c) => `health:${clientIp(c)}` }));

/** Process liveness: does not depend on Supabase and is not suitable as a deploy/readiness gate. */
healthRoute.get('/live', (c) => {
  const reqId = c.get('requestId');
  return c.json(ok(reqId, {
    status: 'ok' as const,
    service: 'itlife-api',
    timestamp: new Date().toISOString(),
  }));
});

/** ตรวจว่าต่อ Supabase (Postgres) ได้จริงหรือไม่ — timeout สั้นกันค้าง ไม่ให้ health check เองแฮงก์ */
async function checkDatabase(env: Bindings): Promise<'ok' | 'error'> {
  try {
    const admin = createAdminClient(env);
    const { error, count } = await admin
      .from('roles')
      .select('id', { head: true, count: 'exact' })
      .abortSignal(AbortSignal.timeout(3000));
    return error || typeof count !== 'number' ? 'error' : 'ok';
  } catch {
    return 'error';
  }
}

healthRoute.get('/', async (c) => {
  const reqId = c.get('requestId');
  const startedAt = Date.now();
  const databaseOk = await checkDatabase(c.env);
  const status = databaseOk ? ('ok' as const) : ('degraded' as const);

  return c.json(
    ok(reqId, {
      status,
      service: 'itlife-api',
      timestamp: new Date().toISOString(),
      responseTimeMs: Math.max(0, Date.now() - startedAt),
    }),
    status === 'ok' ? 200 : 503,
  );
});
