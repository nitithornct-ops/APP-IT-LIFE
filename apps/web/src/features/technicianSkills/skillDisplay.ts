import type { SkillCoverageRisk, SkillLevelDefinition } from '../../types/technicianSkills';

/**
 * การแปลระดับทักษะเป็นสีและคำอธิบาย — ที่เดียวของทั้งโมดูล ตาม UI pattern ของระบบที่ห้ามให้แต่ละหน้า
 * ทำ status mapping ของตัวเอง
 *
 * ระดับ null ใช้พื้นจาง ๆ ไม่ใช่สีเทาแบบ "ปิดใช้งาน" เพราะมันแปลว่า "ยังไม่มีใครประเมิน" ซึ่งเป็น
 * งานที่ค้างอยู่ ไม่ใช่ข้อสรุปว่าเจ้าหน้าที่คนนั้นทำไม่ได้
 */
const LEVEL_CHIP_CLASSES: Record<number, string> = {
  3: 'bg-primary-700 text-white dark:bg-primary-600',
  2: 'bg-primary-200 text-primary-900 dark:bg-primary-900/60 dark:text-primary-100',
  1: 'bg-slate-100 text-slate-700 dark:bg-white/[.10] dark:text-slate-200',
};

const UNASSESSED_CHIP_CLASS = 'bg-slate-50 text-slate-300 dark:bg-white/[.03] dark:text-slate-600';

export function skillChipClass(level: number | null): string {
  return level === null ? UNASSESSED_CHIP_CLASS : LEVEL_CHIP_CLASSES[level] ?? UNASSESSED_CHIP_CLASS;
}

/** สิ่งที่แสดงในช่องตาราง — ขีดกลางแทน "ยังไม่ประเมิน" ตรงกับ mockup */
export function skillChipText(level: number | null): string {
  return level === null ? '—' : String(level);
}

export function skillLevelLabel(levels: SkillLevelDefinition[], level: number | null): string {
  if (level === null) return 'ยังไม่ประเมิน';
  return levels.find((item) => item.level === level)?.label ?? `ระดับ ${level}`;
}

export function skillLevelShort(levels: SkillLevelDefinition[], level: number | null): string {
  if (level === null) return 'ยังไม่ประเมิน';
  return levels.find((item) => item.level === level)?.short ?? `ระดับ ${level}`;
}

export const COVERAGE_RISK_DISPLAY: Record<SkillCoverageRisk, { label: string; badge: 'success' | 'warning' | 'danger'; hint: string }> = {
  covered: { label: 'มีผู้รับงานสำรอง', badge: 'success', hint: 'มีเจ้าหน้าที่ทำงานหมวดนี้ได้เองตั้งแต่สองคนขึ้นไป' },
  single: { label: 'พึ่งพาคนเดียว', badge: 'warning', hint: 'มีเจ้าหน้าที่ทำงานหมวดนี้ได้เองเพียงคนเดียว หากลาหรือติดงานอื่นจะไม่มีคนรับต่อ' },
  uncovered: { label: 'ยังไม่มีผู้รับงาน', badge: 'danger', hint: 'ยังไม่มีเจ้าหน้าที่ที่ถูกประเมินว่าทำงานหมวดนี้ได้ด้วยตนเอง' },
};

/** ตัวเลขที่ยังไม่มีข้อมูลให้แสดงขีดกลาง ไม่ใช่ 0 — ศูนย์เป็นค่าที่วัดได้จริง คนละความหมายกับไม่มีข้อมูล */
export function numberOrDash(value: number | null | undefined, suffix = ''): string {
  return value === null || value === undefined ? '—' : `${value.toLocaleString('th-TH')}${suffix}`;
}
