import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { errorHandler } from './middleware/errorHandler';
import { requestId } from './middleware/requestId';
import { auditLogsRoute } from './routes/auditLogs';
import { authRoute } from './routes/auth';
import { healthRoute } from './routes/health';
import { departmentsRoute, positionsRoute } from './routes/masterData';
import { permissionsRoute, rolesRoute } from './routes/roles';
import { usersRoute } from './routes/users';
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
app.route('/api/v1/auth', authRoute);
app.route('/api/v1/users', usersRoute);
app.route('/api/v1/roles', rolesRoute);
app.route('/api/v1/permissions', permissionsRoute);
app.route('/api/v1/departments', departmentsRoute);
app.route('/api/v1/positions', positionsRoute);
app.route('/api/v1/audit-logs', auditLogsRoute);

app.notFound((c) => c.json(fail(c.get('requestId'), 'NOT_FOUND', 'ไม่พบ endpoint ที่ร้องขอ'), 404));

app.onError(errorHandler);

export default app;
