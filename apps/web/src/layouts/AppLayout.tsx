import { LogOut } from 'lucide-react';
import { Link, Outlet } from 'react-router-dom';
import { NotificationBell } from '../components/NotificationBell';
import { RequirePermission } from '../components/RequirePermission';
import { useAuth } from '../stores/authContext';

/**
 * โครงหน้าเจ้าหน้าที่แบบเรียบง่ายสำหรับ Phase 3 — Sidebar/Header/Dark mode ฉบับเต็มตาม Design
 * System จะสร้างใน Phase 5 (Frontend Core) นี่เป็นแค่โครงพอให้ทดสอบ Login/Protected Route/Admin
 * UI ได้จริงก่อน
 */
export function AppLayout() {
  const { me, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
        <nav className="flex items-center gap-4 text-sm">
          <Link to="/" className="font-semibold text-slate-800 dark:text-slate-100">
            LIFE IT
          </Link>
          <Link to="/profile" className="text-slate-600 hover:text-slate-900 dark:text-slate-300">
            โปรไฟล์
          </Link>
          <RequirePermission permission="user.manage">
            <Link to="/admin/users" className="text-slate-600 hover:text-slate-900 dark:text-slate-300">
              ผู้ใช้งาน
            </Link>
          </RequirePermission>
          <RequirePermission permission="role.view">
            <Link to="/admin/roles" className="text-slate-600 hover:text-slate-900 dark:text-slate-300">
              บทบาท/สิทธิ์
            </Link>
          </RequirePermission>
          <RequirePermission permission="audit.view">
            <Link to="/admin/audit-logs" className="text-slate-600 hover:text-slate-900 dark:text-slate-300">
              Audit Log
            </Link>
          </RequirePermission>
        </nav>
        <div className="flex items-center gap-3 text-sm">
          <NotificationBell />
          <span className="text-slate-500 dark:text-slate-400">{me?.profile.full_name}</span>
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex items-center gap-1 text-slate-600 hover:text-red-600 dark:text-slate-300"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            ออกจากระบบ
          </button>
        </div>
      </header>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}
