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
