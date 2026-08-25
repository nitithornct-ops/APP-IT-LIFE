import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { errorHandler } from './middleware/errorHandler';
import { requestId } from './middleware/requestId';
import { securityHeaders } from './middleware/securityHeaders';
import { accessRegistryRoute, accessRequestsRoute } from './routes/accessRequests';
import { approvalGroupsRoute } from './routes/approvalGroups';
import { assetsRoute } from './routes/assets';
import { auditLogsRoute } from './routes/auditLogs';
import { authRoute } from './routes/auth';
import { backupMonitoringRoute } from './routes/backupMonitoring';
import { ciRelationshipsRoute, configurationItemsRoute } from './routes/cmdb';
import { changesRoute } from './routes/changes';
import { dashboardRoute } from './routes/dashboard';
import { employeeAssignmentsRoute } from './routes/employeeAssignments';
import { employeesRoute } from './routes/employees';
import { filesRoute } from './routes/files';
import { formsRoute, publicFormsRoute } from './routes/forms';
import { healthRoute } from './routes/health';
import { governanceRoute } from './routes/governance';
import { incidentsRoute } from './routes/incidents';
import { integrationsRoute } from './routes/integrations';
import { inventoryItemsRoute } from './routes/inventory';
import { licensesRoute } from './routes/licenses';
import { knowledgeRoute, publicKnowledgeRoute } from './routes/knowledge';
import { lineRoute } from './routes/line';
import { maintenancePlansRoute, pmTemplatesRoute } from './routes/maintenance';
import { accessSystemsRoute, assetCategoriesRoute, departmentsRoute, positionsRoute, ticketCategoriesRoute } from './routes/masterData';
import { notificationsRoute } from './routes/notifications';
import { permissionOverridesRoute } from './routes/permissionOverrides';
import { permissionsRoute, rolesRoute } from './routes/roles';
import { problemsRoute } from './routes/problems';
import { publicTicketsRoute } from './routes/publicTickets';
import { reportsRoute } from './routes/reports';
import { serviceCatalogRoute } from './routes/serviceCatalog';
import { serviceRequestsRoute } from './routes/serviceRequests';
import { settingsRoute } from './routes/settings';
import { tasksRoute } from './routes/tasks';
import { searchRoute } from './routes/search';
import { ticketsRoute } from './routes/tickets';
import { ticketRatingCriteriaRoute } from './routes/ticketRatingCriteria';
import { causeCodesRoute } from './routes/causeCodes';
import { technicianSkillsRoute } from './routes/technicianSkills';
import { usersRoute } from './routes/users';
import { contractsRoute, vendorsRoute } from './routes/vendorsContracts';
import { vulnerabilitiesRoute } from './routes/vulnerabilities';
import { workflowsRoute } from './routes/workflows';
import type { AppEnv } from './types';
import { fail } from './utils/response';

const app = new Hono<AppEnv>();

app.use('*', requestId);
app.use('*', securityHeaders);

app.use('*', (c, next) =>
  cors({
    origin: parseAllowedOrigins(c.env.ALLOWED_ORIGINS),
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'x-request-id', 'x-tracking-token', 'x-line-session', 'x-vendor-token'],
  })(c, next),
);

function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry: string) => entry.trim())
    .filter((entry: string) => entry.length > 0);
}

app.route('/api/v1/health', healthRoute);
app.route('/api/v1/governance', governanceRoute);
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
app.route('/api/v1/search', searchRoute);
app.route('/api/v1/ticket-rating-criteria', ticketRatingCriteriaRoute);
app.route('/api/v1/technician-skills', technicianSkillsRoute);
app.route('/api/v1/cause-codes', causeCodesRoute);
app.route('/api/v1/service-catalog', serviceCatalogRoute);
app.route('/api/v1/service-requests', serviceRequestsRoute);
app.route('/api/v1/settings', settingsRoute);
app.route('/api/v1/access-systems', accessSystemsRoute);
app.route('/api/v1/access-requests', accessRequestsRoute);
app.route('/api/v1/access-registry', accessRegistryRoute);
app.route('/api/v1/tasks', tasksRoute);
app.route('/api/v1/assets', assetsRoute);
app.route('/api/v1/maintenance-plans', maintenancePlansRoute);
app.route('/api/v1/pm-templates', pmTemplatesRoute);
app.route('/api/v1/inventory-items', inventoryItemsRoute);
app.route('/api/v1/software-licenses', licensesRoute);
app.route('/api/v1/vulnerabilities', vulnerabilitiesRoute);
app.route('/api/v1/backup-monitoring', backupMonitoringRoute);
app.route('/api/v1/workflows', workflowsRoute);
app.route('/api/v1/knowledge', knowledgeRoute);
app.route('/api/v1/public/knowledge', publicKnowledgeRoute);
app.route('/api/v1/employee-assignments', employeeAssignmentsRoute);
app.route('/api/v1/cmdb/items', configurationItemsRoute);
app.route('/api/v1/cmdb/relationships', ciRelationshipsRoute);
app.route('/api/v1/incidents', incidentsRoute);
app.route('/api/v1/integrations', integrationsRoute);
app.route('/api/v1/problems', problemsRoute);
app.route('/api/v1/reports', reportsRoute);
app.route('/api/v1/changes', changesRoute);
app.route('/api/v1/dashboard', dashboardRoute);
app.route('/api/v1/vendors', vendorsRoute);
app.route('/api/v1/contracts', contractsRoute);
app.route('/api/v1/audit-logs', auditLogsRoute);
app.route('/api/v1/notifications', notificationsRoute);
app.route('/api/v1/files', filesRoute);
app.route('/api/v1/forms', formsRoute);
app.route('/api/v1/public/forms', publicFormsRoute);
app.route('/api/v1/line', lineRoute);
app.route('/api/v1/public/tickets', publicTicketsRoute);

app.notFound((c) => c.json(fail(c.get('requestId'), 'NOT_FOUND', 'ไม่พบ endpoint ที่ร้องขอ'), 404));

app.onError(errorHandler);

export default app;
