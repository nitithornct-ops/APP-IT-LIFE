import type { DashboardTone } from '../../types/dashboard';

export function dashboardDueLabel(days: number): string {
  if (days < 0) return `เกิน ${Math.abs(days)} วัน`;
  if (days === 0) return 'วันนี้';
  return `อีก ${days} วัน`;
}

export function dashboardBarWidth(value: number, values: number[]): number {
  const maximum = Math.max(1, ...values);
  return Math.max(4, value / maximum * 100);
}

export function dashboardToneForDue(days: number): DashboardTone {
  if (days < 0) return 'danger';
  if (days <= 7) return 'amber';
  return 'primary';
}

