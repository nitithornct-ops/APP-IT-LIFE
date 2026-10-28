import { describe, expect, it } from 'vitest';
import { processAccessRequestSchema, submitAccessRequestSchema, updateAccessControlItemSchema } from '../src/validators/accessRequests';
import { updateFormTemplateSchema } from '../src/validators/forms';
import { updateProblemSchema } from '../src/validators/problems';

describe('validation compatibility across dependency upgrades', () => {
  const request = { systemId: '00000000-0000-0000-0000-000000000001', accessItemId: '00000000-0000-0000-0000-000000000002', requestedActions: ['read'], businessReason: 'Required for daily work' };

  it('preserves PostgreSQL UUID inputs and validates temporary and lifecycle access rules', () => {
    expect(submitAccessRequestSchema.parse(request)).toMatchObject({ temporaryAccess: false, lifecycleEvent: 'manual' });
    expect(submitAccessRequestSchema.safeParse({ ...request, temporaryAccess: true }).success).toBe(false);
    expect(submitAccessRequestSchema.safeParse({ ...request, expiresAt: '2026-12-01T00:00:00Z' }).success).toBe(false);
    expect(submitAccessRequestSchema.safeParse({ ...request, lifecycleEvent: 'joiner', requestType: 'เพิกถอนสิทธิ์' }).success).toBe(false);
    expect(submitAccessRequestSchema.safeParse({ ...request, lifecycleEvent: 'leaver', requestType: 'ขอเพิ่มสิทธิ์' }).success).toBe(false);
    expect(submitAccessRequestSchema.safeParse({ ...request, temporaryAccess: true, expiresAt: '2026-12-01T00:00:00Z' }).success).toBe(true);
    expect(submitAccessRequestSchema.safeParse({ ...request, systemId: 'invalid' }).success).toBe(false);
  });

  it('requires evidence before successful access provisioning', () => {
    expect(processAccessRequestSchema.safeParse({ success: true }).success).toBe(false);
    expect(processAccessRequestSchema.safeParse({ success: true, evidence: 'Access verified' }).success).toBe(true);
    expect(processAccessRequestSchema.safeParse({ success: false }).success).toBe(true);
  });

  it('does not reset access privileges, form settings or Problem links on unrelated edits', () => {
    expect(updateAccessControlItemSchema.parse({ name: 'Updated' })).toEqual({ name: 'Updated' });
    expect(updateFormTemplateSchema.parse({ name: 'Updated' })).toEqual({ name: 'Updated' });
    expect(updateFormTemplateSchema.safeParse({}).success).toBe(false);
    expect(updateProblemSchema.parse({ title: 'Updated' })).toEqual({ title: 'Updated' });
  });
});
