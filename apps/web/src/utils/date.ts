import { format } from 'date-fns';
import { th } from 'date-fns/locale';

const BUDDHIST_YEAR_OFFSET = 543;

export function toBuddhistYear(gregorianYear: number): number {
  return gregorianYear + BUDDHIST_YEAR_OFFSET;
}

/**
 * แปลงวันที่เป็นข้อความภาษาไทยพร้อมปี พ.ศ. เช่น "5 สิงหาคม 2569"
 * ถ้า pattern มี token ปี (y/yy/yyyy) จะแทนที่ด้วยปี พ.ศ. ตรงตำแหน่งเดิม ถ้าไม่มีจะเติมปี พ.ศ. ต่อท้ายให้อัตโนมัติ
 * (ฐานข้อมูลยังเก็บเป็น UTC ตามสเปก — ฟังก์ชันนี้แปลงเป็นข้อความแสดงผลเท่านั้น)
 */
export function formatThaiDate(date: Date | string | number, pattern = 'd MMMM'): string {
  const parsed = date instanceof Date ? date : new Date(date);
  const buddhistYear = toBuddhistYear(parsed.getFullYear());
  const hasYearToken = /y+/.test(pattern);
  const effectivePattern = hasYearToken ? pattern.replace(/y+/g, `'${buddhistYear}'`) : pattern;
  const formatted = format(parsed, effectivePattern, { locale: th });
  return hasYearToken ? formatted : `${formatted} ${buddhistYear}`;
}
