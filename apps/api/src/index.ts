import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { errorHandler } from './middleware/errorHandler';
import { requestId } from './middleware/requestId';
import { accessRegistryRoute, accessRequestsRoute } from './routes/accessRequests';
import { approvalGroupsRoute } from './routes/approvalGroups';
import { auditLogsRoute } from './routes/auditLogs';
import { authRoute } from './routes/auth';
import { employeesRoute } from './routes/employees';
import { filesRoute } from './routes/files';
import { healthRoute } from './routes/health';
import { accessSystemsRoute, assetCategoriesRoute, departmentsRoute, positionsRoute, ticketCategoriesRoute } from './routes/masterData';
import { notificationsRoute } from './routes/notifications';
import { permissionOverridesRoute } from './routes/permissionOverrides';
import { permissionsRoute, rolesRoute } from './routes/roles';
import { serviceCatalogRoute } from './routes/serviceCatalog';
import { serviceRequestsRoute } from './routes/serviceRequests';
import { ticketsRoute } from './routes/tickets';
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
app.route('/api/v1/ticket-categories', ticketCategoriesRoute);
app.route('/api/v1/asset-categories', assetCategoriesRoute);
app.route('/api/v1/permission-overrides', permissionOverridesRoute);
app.route('/api/v1/approval-groups', approvalGroupsRoute);
app.route('/api/v1/employees', employeesRoute);
app.route('/api/v1/tickets', ticketsRoute);
app.route('/api/v1/service-catalog', serviceCatalogRoute);
app.route('/api/v1/service-requests', serviceRequestsRoute);
app.route('/api/v1/access-systems', accessSystemsRoute);
app.route('/api/v1/access-requests', accessRequestsRoute);
app.route('/api/v1/access-registry', accessRegistryRoute);
app.route('/api/v1/audit-logs', auditLogsRoute);
app.route('/api/v1/notifications', notificationsRoute);
app.route('/api/v1/files', filesRoute);

app.notFound((c) => c.json(fail(c.get('requestId'), 'NOT_FOUND', 'ไม่พบ endpoint ที่ร้องขอ'), 404));

app.onError(errorHandler);

export default app;
