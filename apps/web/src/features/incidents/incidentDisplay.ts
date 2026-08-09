import type { Incident } from '../../types/incidents';

export const incidentStatusTone: Record<Incident['status'], 'info' | 'warning' | 'success'> = {
  เปิด: 'info',
  กำลังดำเนินการ: 'warning',
  ปิดเคส: 'success',
};

export const riskTone: Record<string, 'success' | 'warning' | 'danger' | 'secondary'> = {
  ต่ำ: 'success',
  ปานกลาง: 'warning',
  สูง: 'danger',
  วิกฤต: 'danger',
};

export function riskCellClass(score: number): string {
  if (score <= 4) return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100';
  if (score <= 9) return 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100';
  if (score <= 14) return 'bg-orange-200 text-orange-950 dark:bg-orange-900/50 dark:text-orange-100';
  return 'bg-red-200 text-red-950 dark:bg-red-900/60 dark:text-red-100';
}
