import { ShieldAlert, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Button } from './ui/Button';
import { Card, CardBody } from './ui/Card';
import { useAuth } from '../stores/authContext';

function AccessDenied() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl items-center justify-center px-4 text-center">
      <Card className="w-full border-danger-100 dark:border-red-400/30">
        <CardBody className="flex flex-col items-center gap-3 px-6 py-12">
          <div className="grid h-14 w-14 place-items-center rounded-[13px] bg-danger-50 text-danger-700 dark:bg-red-400/10 dark:text-red-300">
            <ShieldAlert className="h-7 w-7" aria-hidden="true" />
          </div>
          <p className="text-lg font-extrabold text-ink-heading dark:text-[#e8eef9]">ไม่มีสิทธิ์เข้าถึงส่วนนี้</p>
          <p className="max-w-sm text-sm text-slate-500 dark:text-white/45">สิทธิ์ของบัญชีนี้ยังไม่ครอบคลุมหน้าที่เปิดอยู่ คุณสามารถกลับไปทำงานต่อหรือส่งคำขอสิทธิ์ได้ทันที</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Link to="/my-work"><Button variant="outline">กลับศูนย์งานของฉัน</Button></Link>
            <Link to="/access-requests"><Button>ขอสิทธิ์เข้าถึง</Button></Link>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

/**
 * ปิดกั้นหน้าที่ต้อง Login — พาไปหน้า Login พร้อมจำหน้าที่ตั้งใจจะเข้าไว้เพื่อ redirect กลับหลัง login สำเร็จ
 * ถ้าระบุ `permission` (สิทธิ์เดียว) หรือ `anyPermission` (มีอย่างน้อยหนึ่งในรายการ — ใช้เมื่อหน้าเดียว
 * เข้าถึงได้ด้วยหลายสิทธิ์ เช่น หน้าเบิกจ่าย/คืนทรัพย์สินพนักงาน ที่ทั้ง employee.manage และ asset.view เข้าดูได้) จะตรวจสิทธิ์
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
  const { session, isSessionLoading, isMfaLoading, mfaRequired, hasPermission, isMeLoading } = useAuth();
  const location = useLocation();

  if (isSessionLoading || (session && isMfaLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }


  if (mfaRequired) {
    return <Navigate to="/mfa" replace state={{ from: location.pathname }} />;
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
