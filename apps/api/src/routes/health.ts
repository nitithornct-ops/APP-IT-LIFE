import type { HealthChecks } from '@itlife/shared';
import { Hono } from 'hono';
import { createAdminClient } from '../lib/supabase';
import type { AppEnv, Bindings } from '../types';
import { ok } from '../utils/response';

export const healthRoute = new Hono<AppEnv>();

/** ตรวจว่าต่อ Supabase (Postgres) ได้จริงหรือไม่ — timeout สั้นกันค้าง ไม่ให้ health check เองแฮงก์ */
async function checkDatabase(env: Bindings): Promise<'ok' | 'error'> {
  try {
    const admin = createAdminClient(env);
    const { error } = await admin
      .from('roles')
      .select('id', { head: true, count: 'exact' })
      .abortSignal(AbortSignal.timeout(3000));
    return error ? 'error' : 'ok';
  } catch {
    return 'error';
  }
}

healthRoute.get('/', async (c) => {
  const reqId = c.get('requestId');
  const checks: HealthChecks = { database: await checkDatabase(c.env) };
  const status = checks.database === 'ok' ? ('ok' as const) : ('degraded' as const);

  return c.json(
    ok(reqId, {
      status,
      service: 'itlife-api',
      environment: c.env.ENVIRONMENT,
      timestamp: new Date().toISOString(),
      checks,
    }),
  );
});
