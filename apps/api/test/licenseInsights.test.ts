import { describe, expect, it } from 'vitest';
import { buildLicenseInsights } from '../src/services/licenseInsights';

const now = new Date('2026-09-12T08:00:00Z');

describe('buildLicenseInsights', () => {
  it('uses legacy used_qty until real allocations exist', () => {
    const result = buildLicenseInsights({
      totalQty: 30,
      usedQty: 27,
      unitPrice: 1000,
      status: 'Active',
      expireDate: '2027-12-31',
    }, now);

    expect(result).toMatchObject({
      assignedQty: 27,
      availableQty: 3,
      usagePct: 90,
      underUtilized: false,
      overAllocation: false,
      complianceRisk: false,
      renewalRecommendation: 'monitor',
    });
    expect(result.costPerUser).toBeCloseTo(1111.111, 2);
    expect(result.reclaimableCost).toBe(3000);
  });

  it('treats an explicit zero allocation count as zero assigned licenses', () => {
    const result = buildLicenseInsights({
      totalQty: 30,
      usedQty: 27,
      activeAllocationCount: 0,
      reclaimedAllocationCount: 4,
      status: 'Active',
      expireDate: '2027-12-31',
    }, now);

    expect(result).toMatchObject({ assignedQty: 0, availableQty: 30, reclaimedQty: 4, usagePct: 0, underUtilized: true });
  });

  it('flags over-allocation and recommends a true-up', () => {
    const result = buildLicenseInsights({
      totalQty: 5,
      usedQty: 5,
      activeAllocationCount: 6,
      status: 'Active',
      expireDate: '2027-12-31',
    }, now);

    expect(result).toMatchObject({ assignedQty: 6, availableQty: -1, usagePct: 120, overAllocation: true, complianceRisk: true, renewalRecommendation: 'true_up' });
  });

  it('recommends reducing a near-term renewal when utilization is low', () => {
    const result = buildLicenseInsights({
      totalQty: 30,
      usedQty: 10,
      status: 'Active',
      expireDate: '2026-10-01',
      expiryNoticeDays: 30,
    }, now);

    expect(result.renewalRecommendation).toBe('renew_reduced');
  });
});
