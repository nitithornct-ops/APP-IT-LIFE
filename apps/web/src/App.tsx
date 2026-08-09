import { Loader2 } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppShell } from './layouts/AppShell';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { HealthPage } from './pages/HealthPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { ProfilePage } from './pages/ProfilePage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';

// หน้าฝั่งผู้ดูแลระบบใช้งานไม่บ่อยเท่าหน้าหลัก — แยก bundle ด้วย lazy loading (Code Splitting)
const UsersPage = lazy(() => import('./features/admin/UsersPage').then((m) => ({ default: m.UsersPage })));
const RolesPage = lazy(() => import('./features/admin/RolesPage').then((m) => ({ default: m.RolesPage })));
const PermissionMatrixPage = lazy(() =>
  import('./features/admin/PermissionMatrixPage').then((m) => ({ default: m.PermissionMatrixPage })),
);
const AuditLogsPage = lazy(() => import('./features/admin/AuditLogsPage').then((m) => ({ default: m.AuditLogsPage })));
const MasterDataPage = lazy(() =>
  import('./features/admin/MasterDataPage').then((m) => ({ default: m.MasterDataPage })),
);
const ApprovalGroupsPage = lazy(() =>
  import('./features/admin/ApprovalGroupsPage').then((m) => ({ default: m.ApprovalGroupsPage })),
);
const EmployeesPage = lazy(() => import('./features/admin/EmployeesPage').then((m) => ({ default: m.EmployeesPage })));
const ServiceCatalogPage = lazy(() =>
  import('./features/admin/ServiceCatalogPage').then((m) => ({ default: m.ServiceCatalogPage })),
);
const TicketsPage = lazy(() => import('./features/tickets/TicketsPage').then((m) => ({ default: m.TicketsPage })));
const TicketDetailPage = lazy(() =>
  import('./features/tickets/TicketDetailPage').then((m) => ({ default: m.TicketDetailPage })),
);
const ServiceRequestsPage = lazy(() =>
  import('./features/serviceRequests/ServiceRequestsPage').then((m) => ({ default: m.ServiceRequestsPage })),
);
const ServiceRequestDetailPage = lazy(() =>
  import('./features/serviceRequests/ServiceRequestDetailPage').then((m) => ({ default: m.ServiceRequestDetailPage })),
);
const AccessRequestsPage = lazy(() =>
  import('./features/accessRequests/AccessRequestsPage').then((m) => ({ default: m.AccessRequestsPage })),
);
const AccessRequestDetailPage = lazy(() =>
  import('./features/accessRequests/AccessRequestDetailPage').then((m) => ({ default: m.AccessRequestDetailPage })),
);
const AccessRegistryPage = lazy(() =>
  import('./features/admin/AccessRegistryPage').then((m) => ({ default: m.AccessRegistryPage })),
);
const TasksPage = lazy(() => import('./features/tasks/TasksPage').then((m) => ({ default: m.TasksPage })));
const AssetsPage = lazy(() => import('./features/assets/AssetsPage').then((m) => ({ default: m.AssetsPage })));
const AssetDetailPage = lazy(() => import('./features/assets/AssetDetailPage').then((m) => ({ default: m.AssetDetailPage })));
const MaintenancePage = lazy(() => import('./features/maintenance/MaintenancePage').then((m) => ({ default: m.MaintenancePage })));
const InventoryPage = lazy(() => import('./features/inventory/InventoryPage').then((m) => ({ default: m.InventoryPage })));
const LicensesPage = lazy(() => import('./features/licenses/LicensesPage').then((m) => ({ default: m.LicensesPage })));
const EmployeeAssignmentsPage = lazy(() =>
  import('./features/employeeAssignments/EmployeeAssignmentsPage').then((m) => ({ default: m.EmployeeAssignmentsPage })),
);
const CmdbPage = lazy(() => import('./features/cmdb/CmdbPage').then((m) => ({ default: m.CmdbPage })));
const ConfigurationItemDetailPage = lazy(() =>
  import('./features/cmdb/ConfigurationItemDetailPage').then((m) => ({ default: m.ConfigurationItemDetailPage })),
);
const CiRelationshipsPage = lazy(() =>
  import('./features/cmdb/CiRelationshipsPage').then((m) => ({ default: m.CiRelationshipsPage })),
);
const IncidentsPage = lazy(() => import('./features/incidents/IncidentsPage').then((m) => ({ default: m.IncidentsPage })));
const IncidentDetailPage = lazy(() =>
  import('./features/incidents/IncidentDetailPage').then((m) => ({ default: m.IncidentDetailPage })),
);

function LazyPageFallback() {
  return (
    <div className="flex justify-center py-20" role="status">
      <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/health" element={<HealthPage />} />

      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<HomePage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route
          path="/tasks"
          element={
            <ProtectedRoute permission="task.view">
              <Suspense fallback={<LazyPageFallback />}>
                <TasksPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/incidents"
          element={
            <ProtectedRoute permission="incident.view">
              <Suspense fallback={<LazyPageFallback />}>
                <IncidentsPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/incidents/:id"
          element={
            <ProtectedRoute permission="incident.view">
              <Suspense fallback={<LazyPageFallback />}>
                <IncidentDetailPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/assets"
          element={
            <ProtectedRoute permission="asset.view">
              <Suspense fallback={<LazyPageFallback />}>
                <AssetsPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/assets/:id"
          element={
            <ProtectedRoute permission="asset.view">
              <Suspense fallback={<LazyPageFallback />}>
                <AssetDetailPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance"
          element={
            <ProtectedRoute permission="maintenance.view">
              <Suspense fallback={<LazyPageFallback />}>
                <MaintenancePage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/inventory-items"
          element={
            <ProtectedRoute permission="inventory.view">
              <Suspense fallback={<LazyPageFallback />}>
                <InventoryPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/software-licenses"
          element={
            <ProtectedRoute permission="license.view">
              <Suspense fallback={<LazyPageFallback />}>
                <LicensesPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/cmdb"
          element={
            <ProtectedRoute permission="cmdb.view">
              <Suspense fallback={<LazyPageFallback />}>
                <CmdbPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/cmdb/relationships"
          element={
            <ProtectedRoute permission="cmdb.view">
              <Suspense fallback={<LazyPageFallback />}>
                <CiRelationshipsPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/cmdb/:id"
          element={
            <ProtectedRoute permission="cmdb.view">
              <Suspense fallback={<LazyPageFallback />}>
                <ConfigurationItemDetailPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/employee-assignments"
          element={
            <ProtectedRoute anyPermission={['employee.manage', 'asset.view']}>
              <Suspense fallback={<LazyPageFallback />}>
                <EmployeeAssignmentsPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/tickets"
          element={
            <ProtectedRoute permission="ticket.view">
              <Suspense fallback={<LazyPageFallback />}>
                <TicketsPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/tickets/:id"
          element={
            <ProtectedRoute permission="ticket.view">
              <Suspense fallback={<LazyPageFallback />}>
                <TicketDetailPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/service-requests"
          element={
            <ProtectedRoute permission="service_request.view">
              <Suspense fallback={<LazyPageFallback />}>
                <ServiceRequestsPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/service-requests/:id"
          element={
            <ProtectedRoute permission="service_request.view">
              <Suspense fallback={<LazyPageFallback />}>
                <ServiceRequestDetailPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/access-requests"
          element={
            <ProtectedRoute permission="access_request.view">
              <Suspense fallback={<LazyPageFallback />}>
                <AccessRequestsPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/access-requests/:id"
          element={
            <ProtectedRoute permission="access_request.view">
              <Suspense fallback={<LazyPageFallback />}>
                <AccessRequestDetailPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute permission="user.manage">
              <Suspense fallback={<LazyPageFallback />}>
                <UsersPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/roles"
          element={
            <ProtectedRoute permission="role.view">
              <Suspense fallback={<LazyPageFallback />}>
                <RolesPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/permission-matrix"
          element={
            <ProtectedRoute permission="role.view">
              <Suspense fallback={<LazyPageFallback />}>
                <PermissionMatrixPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/master-data"
          element={
            <ProtectedRoute>
              <Suspense fallback={<LazyPageFallback />}>
                <MasterDataPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/employees"
          element={
            <ProtectedRoute permission="employee.manage">
              <Suspense fallback={<LazyPageFallback />}>
                <EmployeesPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/service-catalog"
          element={
            <ProtectedRoute permission="service_catalog.manage">
              <Suspense fallback={<LazyPageFallback />}>
                <ServiceCatalogPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/access-registry"
          element={
            <ProtectedRoute permission="access_registry.manage">
              <Suspense fallback={<LazyPageFallback />}>
                <AccessRegistryPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/approval-groups"
          element={
            <ProtectedRoute permission="approval_group.manage">
              <Suspense fallback={<LazyPageFallback />}>
                <ApprovalGroupsPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/audit-logs"
          element={
            <ProtectedRoute permission="audit.view">
              <Suspense fallback={<LazyPageFallback />}>
                <AuditLogsPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
      </Route>
    </Routes>
  );
}
