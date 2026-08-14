/**
 * สร้างรหัสอ้างอิงของเอกสาร/รายการ (INC-, CHG-, PRB-, GOV-, ...)
 *
 * ทุกโมดูลเคยสร้างรหัสด้วย `Math.floor(Math.random() * 9000 + 1000)` ซึ่งมีค่าเป็นไปได้เพียง 9,000 ค่า
 * ต่อหนึ่งวันต่อหนึ่ง prefix ตามหลักปัญหาวันเกิด โอกาสชนกันถึง 50% เมื่อสร้างราว 112 รายการในวันเดียว
 * และหลายตารางก็ไม่มี unique constraint คอยรับไว้ ผลคือรหัสซ้ำเงียบ ๆ หรือบันทึกไม่สำเร็จโดยไม่มีเหตุผล
 * ที่ผู้ใช้เข้าใจได้ (พบตอน Pre-production QA audit 2026-08-13)
 *
 * ใช้ crypto.getRandomValues ซึ่งมีอยู่แล้วใน Cloudflare Workers ให้ค่าสุ่ม 8 หลักฐานสิบหก
 * (4,294,967,296 ค่า) โอกาสชนกันในหนึ่งวันจึงเหลือระดับที่ไม่มีนัยสำคัญ และรูปแบบยังสอดคล้องกับ
 * เลข Ticket เดิมที่ออกโดยฐานข้อมูล (TCK-YYYYMMDD-16HEX)
 *
 * หมายเหตุ: นี่คือการลดโอกาสชนด้วยเอนโทรปี ไม่ใช่การรับประกันแบบ sequence — unique constraint
 * ในฐานข้อมูลยังเป็นด่านสุดท้ายเสมอ และตอนนี้ตอบกลับเป็น 409 พร้อมข้อความภาษาไทยแล้ว
 */

/** ส่วนวันที่แบบ YYYYMMDD ตามเวลา UTC (ให้ตรงกับรูปแบบเดิมของทุกโมดูล) */
function utcDate(now: Date): string {
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
}

/** ส่วนเดือนแบบ YYYYMM ตามเวลา UTC (บางโมดูลออกรหัสรายเดือน) */
function utcMonth(now: Date): string {
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** ค่าสุ่มเข้ารหัส 8 หลักฐานสิบหก */
export function randomCodeSuffix(): string {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0].toString(16).toUpperCase().padStart(8, '0');
}

/** รหัสรูปแบบ PREFIX-YYYYMMDD-XXXXXXXX */
export function dailyRecordCode(prefix: string, now: Date = new Date()): string {
  return `${prefix}-${utcDate(now)}-${randomCodeSuffix()}`;
}

/** รหัสรูปแบบ PREFIX-YYYYMM-XXXXXXXX สำหรับโมดูลที่ออกรหัสรายเดือน */
export function monthlyRecordCode(prefix: string, now: Date = new Date()): string {
  return `${prefix}-${utcMonth(now)}-${randomCodeSuffix()}`;
}
