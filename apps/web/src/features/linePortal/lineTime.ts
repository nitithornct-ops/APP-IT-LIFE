const BANGKOK = 'Asia/Bangkok';

/** "21 ส.ค." — ไม่ใส่ปีเพราะฟีดในพอร์ทัลย้อนหลังไม่เกินไม่กี่เดือน */
const shortDate = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', timeZone: BANGKOK });
/** "29 ส.ค. 13:40" — ใช้กับไทม์ไลน์และข้อความที่ต้องรู้เวลาแน่นอน */
const dateWithTime = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: BANGKOK,
});
/** "21 ส.ค. 2569 10:02" — ใช้กับหัวใบที่ต้องระบุปีชัดเจน */
const fullDateTime = new Intl.DateTimeFormat('th-TH', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: BANGKOK,
});

/**
 * เวลาแบบสั้นสำหรับฟีดในพอร์ทัล ("5 นาที", "2 ชม.", "เมื่อวาน", "21 ส.ค.")
 * ผู้แจ้งอ่านฟีดเพื่อรู้ว่า "เพิ่งเกิด" หรือ "นานแล้ว" ไม่ได้ต้องการความละเอียดระดับนาที
 * เกินหนึ่งสัปดาห์จึงกลับไปใช้วันที่จริง ซึ่งอ่านง่ายกว่า "12 วัน"
 */
export function relativeThaiTime(value: string, now: Date = new Date()): string {
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return '-';

  const elapsedMs = now.getTime() - target.getTime();
  if (elapsedMs < 60_000) return 'เมื่อสักครู่';

  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return `${minutes} นาที`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ชม.`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'เมื่อวาน';
  if (days < 7) return `${days} วัน`;

  return shortDate.format(target);
}

export function thaiDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '-' : fullDateTime.format(parsed);
}

export function thaiDayTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '-' : dateWithTime.format(parsed);
}
