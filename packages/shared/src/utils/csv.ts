/**
 * ตัวสร้าง CSV กลางของทั้งระบบ — ทุกจุดที่ export CSV ต้องเรียกผ่านที่นี่
 * เพื่อกัน formula injection (CWE-1236) แบบเดียวกันทั้ง web และ api
 */

/** อักขระที่ Excel/Sheets ตีความเป็นสูตรเมื่ออยู่ต้นเซลล์ */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * แปลงค่าหนึ่งช่องเป็นเซลล์ CSV ที่ปลอดภัย
 * - ค่าที่ขึ้นต้นด้วย = + - @ tab หรือ CR จะถูกนำหน้าด้วย ' เพื่อให้เป็นข้อความ
 * - escape เครื่องหมายคำพูดแล้วครอบด้วย " เสมอ
 */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  const safe = FORMULA_PREFIX.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** แปลงหนึ่งแถวเป็นบรรทัด CSV */
export function csvRow(cells: readonly unknown[]): string {
  return cells.map(csvCell).join(',');
}

/** ประกอบทุกแถวเป็นเนื้อไฟล์ CSV (CRLF ตาม RFC 4180) */
export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map(csvRow).join('\r\n');
}
