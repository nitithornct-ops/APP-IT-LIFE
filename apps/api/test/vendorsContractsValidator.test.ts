import { describe, expect, it } from 'vitest';
import {
  assessVendorSchema,
  createContractSchema,
  createVendorSchema,
  updateContractSchema,
  updateVendorSchema,
} from '../src/validators/vendorsContracts';

describe('Vendor and Contract validators', () => {
  it('accepts a vendor with the legacy combined initial-contract fields', () => {
    const parsed = createVendorSchema.safeParse({
      name: 'บริษัท ทดสอบ จำกัด', serviceType: 'ผู้ให้บริการ MA', email: 'contact@example.com',
      initialContract: { contractNumber: 'MA-2026-001', startDate: '2026-01-01', endDate: '2026-12-31' },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects invalid email and reversed initial-contract dates', () => {
    expect(createVendorSchema.safeParse({ name: 'Vendor', email: 'bad-email' }).success).toBe(false);
    expect(createVendorSchema.safeParse({ name: 'Vendor', initialContract: { contractNumber: 'C-1', startDate: '2026-12-31', endDate: '2026-01-01' } }).success).toBe(false);
  });

  it('requires assessment content and non-empty updates', () => {
    expect(assessVendorSchema.safeParse({ result: '' }).success).toBe(false);
    expect(assessVendorSchema.safeParse({ result: 'ผ่านเกณฑ์ SLA' }).success).toBe(true);
    expect(updateVendorSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a valid contract and rejects invalid ranges and currency', () => {
    const base = { contractNumber: 'CT-001', name: 'สัญญาบริการ', vendorId: '00000000-0000-0000-0000-000000000001' };
    expect(createContractSchema.safeParse({ ...base, startDate: '2026-01-01', endDate: '2026-12-31', currency: 'THB' }).success).toBe(true);
    expect(createContractSchema.safeParse({ ...base, startDate: '2026-12-31', endDate: '2026-01-01' }).success).toBe(false);
    expect(createContractSchema.safeParse({ ...base, currency: 'บาท' }).success).toBe(false);
    expect(updateContractSchema.safeParse({}).success).toBe(false);
  });
});
