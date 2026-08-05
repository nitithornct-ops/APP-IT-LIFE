import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { errorHandler } from './middleware/errorHandler';
import { requestId } from './middleware/requestId';
import { healthRoute } from './routes/health';
import type { AppEnv } from './types';
import { fail } from './utils/response';

const app = new Hono<AppEnv>();

app.use('*', requestId);

app.use('*', (c, next) =>
  cors({
    origin: parseAllowedOrigins(c.env.ALLOWED_ORIGINS),
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
  })(c, next),
);

function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry: string) => entry.trim())
    .filter((entry: string) => entry.length > 0);
}

app.route('/api/v1/health', healthRoute);

app.notFound((c) => c.json(fail(c.get('requestId'), 'NOT_FOUND', 'ไม่พบ endpoint ที่ร้องขอ'), 404));

app.onError(errorHandler);

export default app;
