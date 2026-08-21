import { toCsv } from '@itlife/shared';

/**
 * ส่งออกรายการทั้งชุดตามตัวกรองที่ผู้ใช้ตั้งไว้ — ไม่ใช่แค่หน้าที่เปิดอยู่
 *
 * ทำฝั่ง server เพราะหน้าเว็บมีข้อมูลอยู่แค่หน้าเดียว การส่งออกจากหน้าเว็บจึงได้ไฟล์ที่ไม่ครบ
 * โดยที่ผู้ใช้ไม่รู้ตัว ซึ่งอันตรายกว่าการไม่มีปุ่มส่งออกเลย
 */

/** หนึ่งคอลัมน์ในไฟล์ที่ส่งออก — value() ดึงค่าจากแถวดิบ ไม่ใช่จากข้อความบนหน้าจอ */
export interface ExportColumn<T> {
  label: string;
  value: (row: T) => unknown;
}

/**
 * เพดานจำนวนแถวต่อไฟล์
 *
 * Worker มีเวลาและหน่วยความจำจำกัด การประกอบไฟล์ที่ใหญ่กว่านี้จะไปตายกลางทางแล้วผู้ใช้
 * ได้ไฟล์ที่ขาดหายโดยไม่รู้ตัว — เกินเพดานจึงตอบกลับไปว่าให้กรองให้แคบลง ไม่ตัดให้เงียบ ๆ
 */
export const LIST_EXPORT_MAX_ROWS = 5_000;

export function listCsv<T>(columns: readonly ExportColumn<T>[], rows: readonly T[]): string {
  return toCsv([
    columns.map((column) => column.label),
    ...rows.map((row) => columns.map((column) => column.value(row))),
  ]);
}

/** ชื่อไฟล์ที่มีวันที่กำกับ เพื่อให้ไฟล์ที่ดาวน์โหลดหลายรอบไม่ทับกันในโฟลเดอร์ดาวน์โหลด */
export function exportFileName(prefix: string, now = new Date()): string {
  return `${prefix}-${now.toISOString().slice(0, 10)}.csv`;
}

export interface ExportTooLarge {
  tooLarge: true;
  totalRows: number;
  maxRows: number;
  message: string;
}

/** ตรวจก่อนดึงข้อมูลจริง เพื่อไม่ต้องโหลดของที่รู้อยู่แล้วว่าส่งออกไม่ได้ */
export function checkExportSize(totalRows: number | null): ExportTooLarge | null {
  const rows = totalRows ?? 0;
  if (rows <= LIST_EXPORT_MAX_ROWS) return null;
  return {
    tooLarge: true,
    totalRows: rows,
    maxRows: LIST_EXPORT_MAX_ROWS,
    message: `ข้อมูลที่ตรงกับตัวกรองมี ${rows.toLocaleString('th-TH')} รายการ เกินเพดาน ${LIST_EXPORT_MAX_ROWS.toLocaleString('th-TH')} รายการต่อไฟล์ กรุณากรองให้แคบลงแล้วส่งออกใหม่`,
  };
}
