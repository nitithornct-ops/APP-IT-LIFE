import type { Contract, VendorContractProfileRef } from '../../types/vendorsContracts';

export const vendorStatusTone = { Active: 'success', Inactive: 'secondary' } as const;
export const contractStatusTone = {
  Draft: 'secondary', Active: 'success', Expired: 'danger', Terminated: 'danger', Renewed: 'primary',
} as const;

export function profileName(profile: VendorContractProfileRef | null | undefined): string {
  return profile?.full_name || profile?.email || '—';
}

export function daysUntilDate(date: string | null | undefined, now = new Date()): number | null {
  if (!date) return null;
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const target = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(target) ? null : Math.ceil((target - todayUtc) / 86_400_000);
}

export function effectiveContractState(contract: Pick<Contract, 'status' | 'end_date'>, now = new Date()): 'expired' | 'expiring' | 'active' | 'other' {
  const days = daysUntilDate(contract.end_date, now);
  if (contract.status === 'Expired' || (contract.status === 'Active' && days !== null && days < 0)) return 'expired';
  if (contract.status === 'Active' && days !== null && days <= 30) return 'expiring';
  if (contract.status === 'Active') return 'active';
  return 'other';
}
