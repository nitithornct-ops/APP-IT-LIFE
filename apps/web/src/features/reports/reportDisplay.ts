import type { ReportBreakdownItem, ReportRow } from '../../types/reports';

export function reportCell(value: ReportRow[string]): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'ใช่' : 'ไม่ใช่';
  return String(value);
}

export function breakdownWidth(item: ReportBreakdownItem, items: ReportBreakdownItem[]): number {
  const maximum = Math.max(0, ...items.map((entry) => entry.value));
  if (!maximum || !item.value) return 0;
  return Math.max(4, Math.round((item.value / maximum) * 100));
}

export function reportSearchText(row: ReportRow): string {
  return Object.values(row).map(reportCell).join(' ').toLocaleLowerCase('th');
}
