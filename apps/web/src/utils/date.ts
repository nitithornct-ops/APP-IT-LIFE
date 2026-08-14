import { format } from 'date-fns';
import { th } from 'date-fns/locale';

const BUDDHIST_YEAR_OFFSET = 543;

/**
 * ระบบให้บริการหน่วยงานในประเทศไทย และฐานข้อมูลเก็บเวลาเป็น UTC ตามสเปก การแสดงผลจึงต้องตรึงไว้ที่
 * Asia/Bangkok เสมอ ไม่ใช่ timezone ของเครื่องผู้ใช้
 *
 * ก่อนหน้านี้ฟังก์ชันนี้เรียก getFullYear()/format() ตรง ๆ ซึ่งอ่านค่าตามนาฬิกาของเครื่อง ผลคือเครื่องที่
 * ตั้งโซนเวลาไว้ผิด (หรือผู้ใช้ที่เดินทาง) จะเห็น "วันครบกำหนด SLA" คลาดไปหนึ่งวันเต็ม โดยที่หน้าจอ
 * ไม่แสดงอะไรผิดปกติเลย — พบตอน Pre-production QA audit 2026-08-13
 */
const BANGKOK_TIME_ZONE = 'Asia/Bangkok';

const bangkokParts = new Intl.DateTimeFormat('en-US', {
  timeZone: BANGKOK_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * คืน Date ที่ "เวลาท้องถิ่น" ของมันตรงกับเวลานาฬิกาที่กรุงเทพ ณ ช่วงเวลาเดียวกัน
 * date-fns อ่านค่าจากฟิลด์ท้องถิ่นของ Date เสมอ การเลื่อนค่าก่อนส่งเข้า format() จึงเป็นวิธีที่ได้ผล
 * โดยไม่ต้องเพิ่ม dependency ตัวจัดการ timezone
 */
function toBangkokWallClock(instant: Date): Date {
  const parts: Record<string, string> = {};
  for (const part of bangkokParts.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return new Date(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
}

export function toBuddhistYear(gregorianYear: number): number {
  return gregorianYear + BUDDHIST_YEAR_OFFSET;
}

/**
 * แปลงวันที่เป็นข้อความภาษาไทยพร้อมปี พ.ศ. ตามเวลาไทย เช่น "5 สิงหาคม 2569"
 * ถ้า pattern มี token ปี (y/yy/yyyy) จะแทนที่ด้วยปี พ.ศ. ตรงตำแหน่งเดิม ถ้าไม่มีจะเติมปี พ.ศ. ต่อท้ายให้อัตโนมัติ
 *
 * ค่าที่แปลงเป็นวันที่ไม่ได้จะคืนสตริงว่าง ไม่โยน error เพราะฟังก์ชันนี้ถูกเรียกระหว่าง render ของ 37 หน้า
 * การโยน RangeError ที่นั่นจะทำให้ทั้งหน้าจอขาวแทนที่จะเสียแค่ช่องวันที่ช่องเดียว
 */
export function formatThaiDate(date: Date | string | number, pattern = 'd MMMM'): string {
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';

  const bangkok = toBangkokWallClock(parsed);
  const buddhistYear = toBuddhistYear(bangkok.getFullYear());
  const hasYearToken = /y+/.test(pattern);
  const effectivePattern = hasYearToken ? pattern.replace(/y+/g, `'${buddhistYear}'`) : pattern;
  const formatted = format(bangkok, effectivePattern, { locale: th });
  return hasYearToken ? formatted : `${formatted} ${buddhistYear}`;
}

/** วันที่พร้อมเวลาแบบสั้นตามเวลาไทย เช่น "5 สิงหาคม 2569 14:30" */
export function formatThaiDateTime(date: Date | string | number): string {
  return formatThaiDate(date, 'd MMMM yyyy HH:mm');
}
