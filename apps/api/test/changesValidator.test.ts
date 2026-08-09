import { describe, expect, it } from 'vitest';
import { approveChangeSchema, createChangeSchema, deployChangeSchema, signOffChangeTestSchema } from '../src/validators/changes';

describe('Change validators', () => {
  it('accepts a complete Change request with a service request reference', () => {
    expect(createChangeSchema.safeParse({ title: 'Deploy SSO', systemAffected: 'Customer Portal', description: 'เปิดใช้งาน SSO รุ่นใหม่', riskLevel: 'กลาง', sourceServiceRequestId: '00000000-0000-0000-0000-000000000001' }).success).toBe(true);
  });

  it('requires title, affected system and description, and rejects an unknown risk', () => {
    expect(createChangeSchema.safeParse({ title: '', systemAffected: '', description: '', riskLevel: 'วิกฤต' }).success).toBe(false);
  });

  it('requires an explicit test result and pass/fail decision', () => {
    expect(signOffChangeTestSchema.safeParse({ result: 'ผ่าน regression test', passed: true }).success).toBe(true);
    expect(signOffChangeTestSchema.safeParse({ result: '', passed: true }).success).toBe(false);
  });

  it('requires a rejection reason but allows approval without a comment', () => {
    expect(approveChangeSchema.safeParse({ approve: true }).success).toBe(true);
    expect(approveChangeSchema.safeParse({ approve: false }).success).toBe(false);
    expect(approveChangeSchema.safeParse({ approve: false, comment: 'ผลกระทบสูงเกินไป' }).success).toBe(true);
  });

  it('requires a deployment version', () => {
    expect(deployChangeSchema.safeParse({ version: '2026.08.1' }).success).toBe(true);
    expect(deployChangeSchema.safeParse({ version: '' }).success).toBe(false);
  });
});
