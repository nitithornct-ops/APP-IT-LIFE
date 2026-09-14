export const LICENSE_RENEWAL_APPROVAL_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type LicenseRenewalApprovalStatus = (typeof LICENSE_RENEWAL_APPROVAL_STATUSES)[number];

export type LicenseInsightInput = {
  totalQty: number | string | null | undefined;
  usedQty: number | string | null | undefined;
  activeAllocationCount?: number | string | null;
  reclaimedAllocationCount?: number | string | null;
  unitPrice?: number | string | null;
  status: string;
  expireDate?: string | null;
  expiryNoticeDays?: number | string | null;
};

export type LicenseInsights = {
  assignedQty: number;
  availableQty: number;
  reclaimedQty: number;
  usagePct: number;
  totalCost: number | null;
  costPerUser: number | null;
  reclaimableCost: number | null;
  underUtilized: boolean;
  overAllocation: boolean;
  complianceRisk: boolean;
  renewalRecommendation: 'renew_current' | 'renew_reduced' | 'true_up' | 'review' | 'do_not_renew' | 'monitor';
};

const DAY_MS = 86_400_000;

function numeric(value: number | string | null | undefined, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function daysUntil(expireDate: string | null | undefined, now: Date): number | null {
  if (!expireDate) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.ceil((Date.parse(`${expireDate}T00:00:00Z`) - today) / DAY_MS);
}

/** Computes license metrics while keeping legacy used_qty data usable before allocation rows exist. */
export function buildLicenseInsights(input: LicenseInsightInput, now = new Date()): LicenseInsights {
  const totalQty = Math.max(0, numeric(input.totalQty));
  const legacyUsedQty = Math.max(0, numeric(input.usedQty));
  const activeAllocationCount = input.activeAllocationCount === undefined || input.activeAllocationCount === null
    ? null
    : Math.max(0, numeric(input.activeAllocationCount));
  const assignedQty = activeAllocationCount !== null ? activeAllocationCount : legacyUsedQty;
  const reclaimedQty = Math.max(0, numeric(input.reclaimedAllocationCount));
  const availableQty = totalQty - assignedQty;
  const usagePct = totalQty > 0 ? Math.round((assignedQty / totalQty) * 100) : 0;
  const unitPrice = input.unitPrice === null || input.unitPrice === undefined ? null : Math.max(0, numeric(input.unitPrice));
  const totalCost = unitPrice === null ? null : unitPrice * totalQty;
  const costPerUser = totalCost === null || assignedQty <= 0 ? null : totalCost / assignedQty;
  const reclaimableCost = unitPrice === null ? null : Math.max(0, availableQty) * unitPrice;
  const underUtilized = totalQty > 0 && assignedQty / totalQty <= 0.75;
  const overAllocation = assignedQty > totalQty;
  const days = daysUntil(input.expireDate, now);
  const expiryWindow = numeric(input.expiryNoticeDays, 30);
  const expired = input.status === 'Expired' || (days !== null && days < 0);
  const expiring = days !== null && days <= Math.max(90, expiryWindow);
  const complianceRisk = overAllocation || expired;

  let renewalRecommendation: LicenseInsights['renewalRecommendation'] = 'monitor';
  if (input.status !== 'Active' || expired) renewalRecommendation = 'do_not_renew';
  else if (overAllocation) renewalRecommendation = 'true_up';
  else if (expiring && underUtilized) renewalRecommendation = 'renew_reduced';
  else if (expiring) renewalRecommendation = 'renew_current';
  else if (underUtilized) renewalRecommendation = 'review';

  return {
    assignedQty,
    availableQty,
    reclaimedQty,
    usagePct,
    totalCost,
    costPerUser,
    reclaimableCost,
    underUtilized,
    overAllocation,
    complianceRisk,
    renewalRecommendation,
  };
}
