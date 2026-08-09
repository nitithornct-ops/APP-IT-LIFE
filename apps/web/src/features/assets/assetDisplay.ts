import type { AssetStatus } from '../../types/assets';

export { ASSET_AUDIT_RESULTS, ASSET_CRITICALITIES, ASSET_STATUSES, ASSET_TYPES } from '../../types/assets';

export const assetStatusTone: Record<AssetStatus, 'success' | 'primary' | 'warning' | 'secondary' | 'danger'> = {
  พร้อมใช้งาน: 'success',
  ใช้งานอยู่: 'primary',
  ซ่อมบำรุง: 'warning',
  'จำหน่าย/เลิกใช้': 'secondary',
  สูญหาย: 'danger',
};

export function employeeName(e: { first_name_th: string; last_name_th: string; nickname?: string | null } | null | undefined): string {
  if (!e) return '—';
  const name = `${e.first_name_th} ${e.last_name_th}`.trim();
  return e.nickname ? `${name} (${e.nickname})` : name;
}

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('th-TH', { maximumFractionDigits: 0 });
}
