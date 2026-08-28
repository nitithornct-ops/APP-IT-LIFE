import { describe, expect, it } from 'vitest';
import { hashVendorPassword, hashVendorSessionToken, verifyVendorPassword } from '../src/lib/vendorPortalAuth';
import { createVendorPortalAccountSchema, submitOutsourceWorkSchema, vendorPortalLoginSchema } from '../src/validators/vendorPortal';

describe('vendor portal authentication', () => {
  it('hashes passwords with a random salt and verifies without storing plaintext', async () => {
    const first = await hashVendorPassword('VendorPassword123');
    const second = await hashVendorPassword('VendorPassword123');
    expect(first).not.toBe(second);
    expect(first).not.toContain('VendorPassword123');
    await expect(verifyVendorPassword('VendorPassword123', first)).resolves.toBe(true);
    await expect(verifyVendorPassword('WrongPassword123', first)).resolves.toBe(false);
    await expect(verifyVendorPassword('VendorPassword123', 'invalid')).resolves.toBe(false);
  });

  it('stores only a deterministic hash of the opaque session token', async () => {
    const token = 'a'.repeat(64);
    const hash = await hashVendorSessionToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(token);
    await expect(hashVendorSessionToken(token)).resolves.toBe(hash);
  });

  it('normalizes the company login and enforces strong admin-created passwords', () => {
    expect(vendorPortalLoginSchema.parse({ vendorCode: 'vnd-001', email: 'Contact@Example.com', password: 'x' })).toMatchObject({ vendorCode: 'VND-001', email: 'contact@example.com' });
    expect(createVendorPortalAccountSchema.safeParse({ email: 'a@example.com', fullName: 'A', password: 'weakpassword' }).success).toBe(false);
    expect(createVendorPortalAccountSchema.safeParse({ email: 'a@example.com', fullName: 'A', password: 'StrongPassword123' }).success).toBe(true);
  });

  it('requires the signed company section to contain cause, resolution and test result', () => {
    expect(submitOutsourceWorkSchema.safeParse({}).success).toBe(false);
    expect(submitOutsourceWorkSchema.safeParse({
      slaCategory: 'Minor Case', rootCause: 'Software defect', resolution: 'Applied patch', testResult: 'Passed', assessorName: 'Vendor User', confirmed: true,
    }).success).toBe(true);
  });
});

