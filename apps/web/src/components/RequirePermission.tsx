import type { ReactNode } from 'react';
import { useAuth } from '../stores/authContext';

/**
 * ซ่อน/แสดงส่วนของหน้าจอตามสิทธิ์ — ใช้เพื่อ UX เท่านั้น (ซ่อนเมนู/ปุ่ม) ไม่ใช่การควบคุมความปลอดภัย
 * Backend ต้องตรวจสิทธิ์ซ้ำทุกครั้งเสมอ (ดู apps/api/src/middleware/permission.ts)
 */
export function RequirePermission({
  permission,
  fallback = null,
  children,
}: {
  permission: string;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const { hasPermission, isMeLoading } = useAuth();

  if (isMeLoading) {
    return null;
  }

  return hasPermission(permission) ? <>{children}</> : <>{fallback}</>;
}
