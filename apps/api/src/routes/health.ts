import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { ok } from '../utils/response';

export const healthRoute = new Hono<AppEnv>();

healthRoute.get('/', (c) => {
  const reqId = c.get('requestId');
  return c.json(
    ok(reqId, {
      status: 'ok' as const,
      service: 'itlife-api',
      environment: c.env.ENVIRONMENT,
      timestamp: new Date().toISOString(),
    }),
  );
});
