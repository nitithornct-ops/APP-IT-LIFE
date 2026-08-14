import { describe, expect, it } from 'vitest';
import {
  createFormTemplateSchema,
  sendIssueFormToVendorSchema,
  submitVendorFormSchema,
  vendorTokenParamSchema,
} from '../src/validators/forms';

describe('Form Studio validators', () => {
  it('accepts a rich-text template within the size limit', () => {
    const result = createFormTemplateSchema.safeParse({
      name: 'IT / ERP Issue',
      category: 'IT Support',
      contentHtml: '<h1>แบบฟอร์ม</h1><p>{{ticket_no}}</p>',
    });
    expect(result.success).toBe(true);
  });

  it('requires a strong opaque Vendor token', () => {
    expect(vendorTokenParamSchema.safeParse({ token: 'short' }).success).toBe(false);
    expect(vendorTokenParamSchema.safeParse({ token: 'a'.repeat(64) }).success).toBe(true);
  });

  it('limits Vendor link lifetime', () => {
    const result = sendIssueFormToVendorSchema.safeParse({ vendorId: crypto.randomUUID(), expiresInDays: 61 });
    expect(result.success).toBe(false);
  });

  it('requires root cause, resolution, and assessor name in a Vendor reply', () => {
    const result = submitVendorFormSchema.safeParse({
      slaCategory: 'Minor Case',
      rootCause: 'Configuration mismatch',
      resolution: 'Corrected configuration and tested',
      prevention: 'Added deployment checklist',
      creditType: 'none',
      changeTypes: [],
      assessorName: 'Vendor Engineer',
    });
    expect(result.success).toBe(true);
  });
});

