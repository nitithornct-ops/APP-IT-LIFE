import { describe, expect, it } from 'vitest';
import { constantTimeEqualText, hashVendorPassword, hashVendorSessionToken, verifyVendorPassword } from '../src/lib/vendorPortalAuth';
import { changeVendorPortalPasswordSchema, createVendorPortalAccountSchema, submitOutsourceWorkSchema, vendorPortalLoginSchema } from '../src/validators/vendorPortal';

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

  it('compares CSRF tokens without leaking whether an equal-length value differs early', () => {
    expect(constantTimeEqualText('a'.repeat(64), 'a'.repeat(64))).toBe(true);
    expect(constantTimeEqualText('a'.repeat(64), 'b'.repeat(64))).toBe(false);
    expect(constantTimeEqualText('a'.repeat(64), 'a'.repeat(63))).toBe(false);
  });

  it('normalizes the company login username and enforces strong admin-created passwords', () => {
    expect(vendorPortalLoginSchema.parse({ vendorCode: 'vnd-001', username: 'Vendor.Contact', password: 'x' })).toMatchObject({ vendorCode: 'VND-001', username: 'vendor.contact' });
    expect(createVendorPortalAccountSchema.safeParse({ username: 'vendor', email: 'a@example.com', fullName: 'A', password: 'weakpassword' }).success).toBe(false);
    expect(createVendorPortalAccountSchema.safeParse({ username: 'vendor', email: 'a@example.com', fullName: 'A', password: 'StrongPassword123' }).success).toBe(true);
    expect(createVendorPortalAccountSchema.safeParse({ username: 'ชื่อบริษัท', email: 'a@example.com', fullName: 'A', password: 'StrongPassword123' }).success).toBe(false);
  });

  it('requires a strong, different password when changing the temporary password', () => {
    expect(changeVendorPortalPasswordSchema.safeParse({ currentPassword: 'StrongPassword123', newPassword: 'StrongPassword123' }).success).toBe(false);
    expect(changeVendorPortalPasswordSchema.safeParse({ currentPassword: 'StrongPassword123', newPassword: 'NewStrongPassword456' }).success).toBe(true);
  });

  it('requires the signed company section to contain cause, resolution and test result', () => {
    expect(submitOutsourceWorkSchema.safeParse({}).success).toBe(false);
    expect(submitOutsourceWorkSchema.safeParse({
      slaCategory: 'Minor Case', rootCause: 'Software defect', resolution: 'Applied patch', testResult: 'Passed', assessorName: 'Vendor User', confirmed: true,
    }).success).toBe(true);
  });
});

