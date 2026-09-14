import { describe, expect, it } from 'vitest';
import { createLicenseAllocationSchema, createLicenseSchema, listLicensesQuerySchema, renewalApprovalSchema, updateLicenseSchema } from '../src/validators/licenses';

describe('software license validators', () => {
  it('accepts a complete license and supplies renewal defaults', () => {
    const result = createLicenseSchema.parse({
      softwareName: 'Microsoft 365 Business',
      licenseType: 'Subscription',
      totalQty: 60,
      usedQty: 55,
      startDate: '2026-01-01',
      expireDate: '2026-12-31',
    });
    expect(result.expiryNoticeDays).toBe(30);
  });

  it('rejects over-allocation and reversed dates', () => {
    expect(createLicenseSchema.safeParse({ softwareName: 'Overused', totalQty: 2, usedQty: 3 }).success).toBe(false);
    expect(createLicenseSchema.safeParse({ softwareName: 'Bad dates', startDate: '2026-12-31', expireDate: '2026-01-01' }).success).toBe(false);
  });

  it('validates renewal notice bounds and partial updates', () => {
    expect(createLicenseSchema.safeParse({ softwareName: 'Too long', expiryNoticeDays: 3651 }).success).toBe(false);
    expect(updateLicenseSchema.safeParse({ usedQty: 4 }).success).toBe(true);
  });

  it('validates product metadata, license model, and allocation target type', () => {
    expect(createLicenseSchema.parse({ softwareName: 'Microsoft 365', productName: 'Microsoft 365', licenseModel: 'SaaS' }).licenseModel).toBe('SaaS');
    expect(createLicenseAllocationSchema.safeParse({ assigneeType: 'user', employeeId: '00000000-0000-0000-0000-000000000001', assetId: '00000000-0000-0000-0000-000000000002' }).success).toBe(false);
    expect(createLicenseAllocationSchema.safeParse({ assigneeType: 'device', assetId: '00000000-0000-0000-0000-000000000002' }).success).toBe(true);
    expect(renewalApprovalSchema.safeParse({ status: 'approved' }).success).toBe(true);
  });

  it('coerces pagination and validates status filters', () => {
    expect(listLicensesQuerySchema.parse({ page: '2', pageSize: '50', status: 'Active' })).toMatchObject({ page: 2, pageSize: 50, status: 'Active' });
    expect(listLicensesQuerySchema.safeParse({ status: 'Deleted' }).success).toBe(false);
  });
});
