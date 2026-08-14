import { AlertTriangle, RefreshCw } from 'lucide-react';
import { ApiError } from '../../services/apiClient';
import { Button } from './Button';

/**
 * สถานะ "โหลดข้อมูลไม่สำเร็จ" แบบเดียวกันทุกหน้า
 *
 * ก่อนหน้านี้หลายหน้าไม่ตรวจ isError เลย เมื่อ API ล้ม (เน็ตหลุด, สิทธิ์ถูกถอน, Backend ล่ม) หน้าจะค้าง
 * แสดง "ไม่พบข้อมูล" ทั้งที่จริงคือโหลดไม่ได้ ผู้ใช้เข้าใจผิดว่าข้อมูลถูกลบไปแล้ว และไม่มีปุ่มให้ลองใหม่
 * ต้องกด F5 ทั้งหน้า (พบตอน Pre-production QA audit 2026-08-13)
 */
export function QueryError({
  error,
  title = 'โหลดข้อมูลไม่สำเร็จ',
  onRetry,
  isRetrying,
}: {
  error: unknown;
  title?: string;
  onRetry?: () => void;
  isRetrying?: boolean;
}) {
  const detail =
    error instanceof ApiError || error instanceof Error
      ? error.message
      : 'ไม่ทราบสาเหตุ กรุณาตรวจสอบการเชื่อมต่อเครือข่าย';

  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-6 py-8 text-center dark:border-red-900 dark:bg-red-950"
    >
      <AlertTriangle className="h-8 w-8 text-red-500 dark:text-red-400" aria-hidden="true" />
      <p className="font-bold text-red-800 dark:text-red-200">{title}</p>
      <p className="max-w-md text-sm text-red-700 dark:text-red-300">{detail}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry} isLoading={isRetrying} className="mt-2">
          <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
          ลองใหม่
        </Button>
      )}
    </div>
  );
}
