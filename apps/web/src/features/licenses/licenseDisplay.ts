import type { SoftwareLicense } from '../../types/assets';

export type LicenseHealth = 'active' | 'expiring' | 'expired' | 'inactive' | 'unlimited';

export function daysUntilLicenseExpiry(expireDate: string | null, now = new Date()): number | null {
  if (!expireDate) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.ceil((Date.parse(`${expireDate}T00:00:00Z`) - today) / 86_400_000);
}

export function licenseHealth(license: Pick<SoftwareLicense, 'status' | 'expire_date'>, now = new Date()): LicenseHealth {
  if (license.status === 'Inactive') return 'inactive';
  const days = daysUntilLicenseExpiry(license.expire_date, now);
  if (license.status === 'Expired' || (days !== null && days < 0)) return 'expired';
  if (days !== null && days <= 30) return 'expiring';
  if (days === null) return 'unlimited';
  return 'active';
}

export function utilizationPercent(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((used / total) * 100)));
}

export function remainingSeats(used: number, total: number): number {
  return Math.max(0, total - used);
}
