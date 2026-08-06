import type { Context } from 'hono';
import type { ZodError } from 'zod';
import type { AppEnv } from '../types';
import { fail } from './response';

/**
 * ใช้เป็น hook ตัวที่ 3 ของ zValidator ทุกจุดเรียกในระบบ เพื่อให้ error ออกมาเป็นรูปแบบ
 * VALIDATION_ERROR มาตรฐานเดียวกัน — เรียก zValidator ตรงๆ ที่แต่ละ route (ไม่ห่อเป็นฟังก์ชัน
 * generic ซ้อนอีกชั้น) เพราะการห่อจะทำให้ TypeScript อนุมานชนิดของ c.req.valid() ไม่ได้แม่นยำ
 */
export function zodValidationHook(result: { success: boolean; error?: ZodError }, c: Context<AppEnv>) {
  if (!result.success && result.error) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    return c.json(fail(c.get('requestId'), 'VALIDATION_ERROR', 'ข้อมูลที่ส่งมาไม่ถูกต้อง', details), 400);
  }
}
