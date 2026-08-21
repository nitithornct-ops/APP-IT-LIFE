import { toCsv } from '@itlife/shared';

/**
 * สร้างไฟล์ CSV แล้วสั่งดาวน์โหลดในเบราว์เซอร์ — ทุกปุ่ม "ส่งออก CSV" ของ web ต้องผ่านที่นี่
 * ใส่ BOM ให้ Excel อ่านภาษาไทยได้ถูกต้อง และ escape ทุกเซลล์ผ่าน csvCell กลาง (กัน formula injection)
 */
export function downloadCsv(rows: readonly (readonly unknown[])[], fileName: string) {
  downloadCsvText(toCsv(rows), fileName);
}

/**
 * ดาวน์โหลด CSV ที่ประกอบเสร็จมาแล้ว — ใช้กับไฟล์ที่ server สร้างให้ (ส่งออกทั้งชุดตามตัวกรอง)
 * ซึ่ง escape มาจาก @itlife/shared ตัวเดียวกันกับฝั่ง web แล้ว
 */
export function downloadCsvText(csv: string, fileName: string) {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}
