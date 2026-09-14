import { describe, expect, it } from 'vitest';
import { createServiceCatalogSchema, updateServiceCatalogSchema } from '../src/validators/serviceCatalog';

const validUuid = '00000000-0000-0000-0000-000000000001';

describe('service catalog metadata validators', () => {
  it('accepts the metadata needed to preview and publish a service', () => {
    const result = createServiceCatalogSchema.safeParse({
      serviceCode: 'SVC-ACCOUNT',
      serviceName: 'ขอ Account ใหม่',
      audience: 'พนักงานทุกคน',
      eligibility: { roles: ['employee'] },
      documentationUrl: 'https://example.com/docs/account',
      effectiveDate: '2026-09-13',
      reviewDate: '2026-12-13',
      ownerId: validUuid,
      fulfillmentGroupId: validUuid,
      estimatedCost: 1200,
    });

    expect(result.success).toBe(true);
  });

  it('rejects a Review Date before the Effective Date', () => {
    const result = createServiceCatalogSchema.safeParse({
      serviceCode: 'SVC-INVALID-DATE',
      serviceName: 'วันที่ไม่ถูกต้อง',
      effectiveDate: '2026-09-13',
      reviewDate: '2026-09-12',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.path[0] === 'reviewDate')).toBe(true);
  });

  it('allows an update to clear optional metadata', () => {
    const result = updateServiceCatalogSchema.safeParse({
      audience: null,
      documentationUrl: null,
      reviewDate: null,
    });

    expect(result.success).toBe(true);
  });
});
