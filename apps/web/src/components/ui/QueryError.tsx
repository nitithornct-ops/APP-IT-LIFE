import type { ReactNode } from 'react';
import { ApiError } from '../../services/apiClient';
import { ErrorState } from './AsyncState';

/**
 * สถานะ "โหลดข้อมูลไม่สำเร็จ" แบบเดียวกันทุกหน้า
 *
 * ก่อนหน้านี้หลายหน้าไม่ตรวจ isError เลย เมื่อ API ล้ม (เน็ตหลุด, สิทธิ์ถูกถอน, Backend ล่ม) หน้าจะค้าง
 * แสดง "ไม่พบข้อมูล" ทั้งที่จริงคือโหลดไม่ได้ ผู้ใช้เข้าใจผิดว่าข้อมูลถูกลบไปแล้ว และไม่มีปุ่มให้ลองใหม่
 * ต้องกด F5 ทั้งหน้า (พบตอน Pre-production QA audit 2026-08-13)
 *
 * แสดงรหัสความผิดพลาดและ REQ id ของคำขอนั้นด้วย (design handoff 3k การ์ด "ผิดพลาด") — ผู้ใช้อ่าน
 * ข้อความภาษาไทยแล้วแจ้งเลขนี้ต่อได้ ผู้ดูแลจึงตามหา request เดียวกันใน log ได้ตรงตัวโดยไม่ต้องเดา
 * จากเวลาที่ผู้ใช้จำได้คร่าว ๆ ทุกคำตอบของ API มี meta.requestId อยู่แล้ว จึงไม่ต้องเพิ่มอะไรฝั่งหลังบ้าน
 */
export function QueryError({
  error,
  title = 'โหลดข้อมูลไม่สำเร็จ',
  onRetry,
  isRetrying,
  draftNotice,
}: {
  error: unknown;
  title?: string;
  onRetry?: () => void;
  isRetrying?: boolean;
  /** ส่งมาเฉพาะหน้าที่เก็บร่างของผู้ใช้ไว้จริง — ดูเหตุผลใน ErrorState */
  draftNotice?: ReactNode;
}) {
  const detail =
    error instanceof ApiError || error instanceof Error
      ? error.message
      : 'ไม่ทราบสาเหตุ กรุณาตรวจสอบการเชื่อมต่อเครือข่าย';

  // status ของ HTTP อ่านง่ายกว่าสำหรับผู้ใช้ (เช่น 504) ส่วน code ของระบบมีประโยชน์เมื่อไม่มี status
  const apiError = error instanceof ApiError ? error : null;
  const code = apiError ? (apiError.status ? String(apiError.status) : apiError.code) : undefined;

  return (
    <ErrorState
      title={title}
      message={detail}
      onRetry={onRetry}
      isRetrying={isRetrying}
      code={code}
      requestId={apiError?.requestId}
      draftNotice={draftNotice}
    />
  );
}
