import { ApiError } from '../../services/apiClient';
import { ErrorState } from './AsyncState';

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

  return <ErrorState title={title} message={detail} onRetry={onRetry} isRetrying={isRetrying} />;
}
