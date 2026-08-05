import type { ErrorHandler } from 'hono';
import type { AppEnv } from '../types';
import { fail } from '../utils/response';

/**
 * ตัวจัดการ Error กลาง — ไม่เปิดเผย Stack Trace หรือรายละเอียดภายในให้ Client เห็น
 * (log รายละเอียดจริงไว้ฝั่ง Server เท่านั้น ตามหลัก Security by Design)
 */
export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  const reqId = c.get('requestId') ?? 'unknown';
  console.error(JSON.stringify({ requestId: reqId, path: c.req.path, message: err.message }));
  return c.json(fail(reqId, 'INTERNAL_ERROR', 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง'), 500);
};
