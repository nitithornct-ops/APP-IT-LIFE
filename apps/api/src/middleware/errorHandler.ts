import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../types';
import { fail } from '../utils/response';

/**
 * ตัวจัดการ Error กลาง — ไม่เปิดเผย Stack Trace หรือรายละเอียดภายในให้ Client เห็น
 * (log รายละเอียดจริงไว้ฝั่ง Server เท่านั้น ตามหลัก Security by Design)
 */
export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  const reqId = c.get('requestId') ?? 'unknown';

  /**
   * Hono โยน HTTPException สำหรับความผิดของฝั่งผู้เรียกที่ตรวจพบก่อนเข้าถึง handler เช่น body ที่
   * ประกาศ Content-Type: application/json แต่เนื้อหาไม่ใช่ JSON ที่สมบูรณ์ (validator โยน 400 พร้อม
   * ข้อความ "Malformed JSON in request body")
   *
   * ก่อนหน้านี้ตัวจัดการนี้ไม่รู้จัก HTTPException จึงกลืนสถานะเดิมทิ้งแล้วตอบ 500 ทุกกรณี ผลคือ
   * (1) ผู้เรียกได้ 500 ทั้งที่ตัวเองส่งข้อมูลผิด และ (2) log เต็มไปด้วย INTERNAL_ERROR ปลอมจนกลบ
   * error จริงของระบบ — พบตอน Pre-production QA audit 2026-08-13
   */
  if (err instanceof HTTPException) {
    const isMalformedJson = /malformed json/i.test(err.message);
    const code = isMalformedJson ? 'INVALID_JSON' : 'BAD_REQUEST';
    const message = isMalformedJson
      ? 'รูปแบบข้อมูลที่ส่งมาไม่ถูกต้อง กรุณาส่งเป็น JSON ที่สมบูรณ์'
      : 'คำขอไม่ถูกต้อง กรุณาตรวจสอบข้อมูลที่ส่งมา';
    console.error(JSON.stringify({ requestId: reqId, path: c.req.path, code, status: err.status, message: err.message }));
    return c.json(fail(reqId, code, message), err.status);
  }

  // เผื่อกรณีที่ parse JSON เองนอกเส้นทาง validator แล้วปล่อย SyntaxError หลุดขึ้นมา
  if (err instanceof SyntaxError) {
    console.error(JSON.stringify({ requestId: reqId, path: c.req.path, code: 'INVALID_JSON', message: err.message }));
    return c.json(fail(reqId, 'INVALID_JSON', 'รูปแบบข้อมูลที่ส่งมาไม่ถูกต้อง กรุณาส่งเป็น JSON ที่สมบูรณ์'), 400);
  }

  console.error(JSON.stringify({ requestId: reqId, path: c.req.path, message: err.message }));
  return c.json(fail(reqId, 'INTERNAL_ERROR', 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง'), 500);
};
