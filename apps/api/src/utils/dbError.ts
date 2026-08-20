import type { Context } from 'hono';
import type { PostgrestError } from '@supabase/supabase-js';
import type { ApiErrorResponse } from '@itlife/shared';
import type { AppEnv } from '../types';
import { fail } from './response';

/**
 * แปลง Error จาก Supabase/PostgREST เป็น Response มาตรฐานของระบบ
 *
 * ก่อนหน้านี้ route ส่วนใหญ่ส่ง `error.message` ดิบกลับไปให้ Client ทำให้ชื่อตาราง ชื่อ constraint และ
 * โครงสร้าง schema รั่วออกไป และผู้ใช้เห็นข้อความอย่าง
 * `duplicate key value violates unique constraint "employees_employee_code_unique"` บน Toast
 * (พบจาก Pre-production QA audit 2026-08-13 — 183 จุดใน 33 ไฟล์)
 *
 * ตัวช่วยนี้ทำสองอย่างพร้อมกัน: log ข้อความจริงไว้ฝั่ง Server เท่านั้น และแปลง SQLSTATE ของ Postgres
 * เป็น HTTP Status ที่ถูกความหมาย (409 เมื่อข้อมูลซ้ำ/ชนกัน, 404 เมื่อไม่พบแถว) แทนที่จะตอบ 400 ทุกกรณี
 */

interface DbErrorLike {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

export type DbFailStatus = 400 | 404 | 409 | 422 | 500;

/** ข้อความมาตรฐานภาษาไทยต่อประเภทความผิดพลาด ใช้เมื่อ route ไม่ได้ระบุข้อความเฉพาะทาง */
const MESSAGE_BY_KIND: Record<string, string> = {
  duplicate: 'มีข้อมูลนี้อยู่แล้วในระบบ กรุณาตรวจสอบรหัสหรือชื่อที่ซ้ำกัน',
  foreignKey: 'ข้อมูลอ้างอิงไม่ถูกต้อง หรือรายการที่อ้างถึงไม่มีอยู่ในระบบ',
  inUse: 'ไม่สามารถลบหรือแก้ไขได้ เพราะมีรายการอื่นอ้างอิงข้อมูลนี้อยู่',
  notNull: 'ข้อมูลบางช่องที่จำเป็นยังว่างอยู่ กรุณากรอกให้ครบ',
  check: 'ค่าที่กรอกไม่อยู่ในเงื่อนไขที่ระบบกำหนด',
  notFound: 'ไม่พบรายการที่ระบุ',
  permission: 'ท่านไม่มีสิทธิ์ดำเนินการนี้',
  unknown: 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
};

/** จำแนกความผิดพลาดจาก SQLSTATE (https://www.postgresql.org/docs/current/errcodes-appendix.html) */
export function classifyDbError(error: DbErrorLike | null | undefined): {
  kind: keyof typeof MESSAGE_BY_KIND;
  status: DbFailStatus;
} {
  const code = error?.code ?? '';
  const message = error?.message ?? '';

  if (code === '23505') return { kind: 'duplicate', status: 409 };
  if (code === '23503') return { kind: 'foreignKey', status: 409 };
  if (code === '23502') return { kind: 'notNull', status: 400 };
  if (code === '23514' || code === '22P02' || code === '22007') return { kind: 'check', status: 400 };
  if (code === '42501') return { kind: 'permission', status: 403 as unknown as DbFailStatus };
  // PGRST116 = ".single() ได้ 0 แถว" ซึ่งหมายถึงไม่พบรายการ ไม่ใช่คำขอผิดรูปแบบ
  if (code === 'PGRST116' || message.includes('Cannot coerce the result to a single JSON object')) {
    return { kind: 'notFound', status: 404 };
  }
  // Unknown SQLSTATEs include connection failures and internal database errors; they are
  // server failures, not malformed client requests. Returning 500 also makes monitoring
  // and retry behaviour accurate instead of hiding outages in the 4xx bucket.
  return { kind: 'unknown', status: 500 };
}

/**
 * สร้าง Response ที่ปลอดภัยจาก Error ของฐานข้อมูล
 *
 * @param requestId  request id ของ request นี้ (ใช้ผูก log ฝั่ง server กับสิ่งที่ผู้ใช้เห็น)
 * @param code       error code ของระบบ เช่น 'EMPLOYEE_CREATE_FAILED'
 * @param error      error object จาก Supabase
 * @param message    ข้อความภาษาไทยที่ต้องการให้ผู้ใช้เห็น (ถ้าไม่ระบุจะใช้ข้อความตามประเภทที่จำแนกได้)
 */
export function dbFail(
  requestId: string,
  code: string,
  error: PostgrestError | DbErrorLike | null | undefined,
  message?: string,
): { body: ApiErrorResponse; status: DbFailStatus } {
  const { kind, status } = classifyDbError(error);

  // รายละเอียดจริงอยู่ใน log ฝั่ง Server เท่านั้น ไม่ส่งออกไปกับ Response
  console.error(
    JSON.stringify({
      requestId,
      code,
      sqlState: error?.code ?? null,
      message: error?.message ?? null,
      details: error?.details ?? null,
      hint: error?.hint ?? null,
    }),
  );

  return { body: fail(requestId, code, message ?? MESSAGE_BY_KIND[kind]), status };
}

/**
 * รูปแบบที่ route ใช้บ่อยที่สุด — คืน Response พร้อมส่งกลับได้ทันที
 *
 *   if (error) return dbFailJson(c, 'EMPLOYEE_CREATE_FAILED', error);
 *   if (error) return dbFailJson(c, 'EMPLOYEE_CREATE_FAILED', error, 'เพิ่มพนักงานไม่สำเร็จ');
 */
export function dbFailJson(
  c: Context<AppEnv>,
  code: string,
  error: PostgrestError | DbErrorLike | null | undefined,
  message?: string,
) {
  const { body, status } = dbFail(c.get('requestId'), code, error, message);
  return c.json(body, status);
}
