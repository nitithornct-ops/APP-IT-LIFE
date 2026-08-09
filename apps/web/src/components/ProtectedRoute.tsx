import { ShieldAlert, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../stores/authContext';

function AccessDenied() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 text-center">
      <ShieldAlert className="h-8 w-8 text-red-500" aria-hidden="true" />
      <p className="text-sm text-slate-600 dark:text-slate-300">ท่านไม่มีสิทธิ์เข้าถึงหน้านี้</p>
    </div>
  );
}

/**
 * ปิดกั้นหน้าที่ต้อง Login — พาไปหน้า Login พร้อมจำหน้าที่ตั้งใจจะเข้าไว้เพื่อ redirect กลับหลัง login สำเร็จ
 * ถ้าระบุ `permission` (สิทธิ์เดียว) หรือ `anyPermission` (มีอย่างน้อยหนึ่งในรายการ — ใช้เมื่อหน้าเดียว
 * เข้าถึงได้ด้วยหลายสิทธิ์ เช่น ทรัพย์สินพนักงาน ที่ทั้ง employee.manage และ asset.view เข้าดูได้) จะตรวจสิทธิ์
 * จากผล /auth/me และแสดงหน้า Access Denied หากไม่มีสิทธิ์ (เพื่อ UX เท่านั้น — Backend ยังตรวจสิทธิ์ซ้ำทุก
 * request อยู่แล้ว)
 */
export function ProtectedRoute({
  children,
  permission,
  anyPermission,
}: {
  children: ReactNode;
  permission?: string;
  anyPermission?: string[];
}) {
  const { session, isSessionLoading, hasPermission, isMeLoading } = useAuth();
  const location = useLocation();

  if (isSessionLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (permission || anyPermission?.length) {
    if (isMeLoading) {
      return (
        <div className="flex min-h-screen items-center justify-center" role="status">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
        </div>
      );
    }
    const allowed = permission ? hasPermission(permission) : (anyPermission ?? []).some((key) => hasPermission(key));
    if (!allowed) {
      return <AccessDenied />;
    }
  }

  return <>{children}</>;
}
