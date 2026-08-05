import { format } from 'date-fns';
import { th } from 'date-fns/locale';

const BUDDHIST_YEAR_OFFSET = 543;

export function toBuddhistYear(gregorianYear: number): number {
  return gregorianYear + BUDDHIST_YEAR_OFFSET;
}

/** แปลงวันที่เป็นข้อความภาษาไทยพร้อมปี พ.ศ. เช่น "5 สิงหาคม 2569" (ฐานข้อมูลยังเก็บเป็น UTC ตามสเปก) */
export function formatThaiDate(date: Date | string | number, pattern = 'd MMMM'): string {
  const parsed = date instanceof Date ? date : new Date(date);
  const formatted = format(parsed, pattern, { locale: th });
  return `${formatted} ${toBuddhistYear(parsed.getFullYear())}`;
}
