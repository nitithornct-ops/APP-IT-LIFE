import { describe, expect, it } from 'vitest';
import { createKnownErrorSchema, createProblemSchema, updateProblemSchema } from '../src/validators/problems';

describe('Problem validators', () => {
  it('accepts a normalized Problem with Incident/Ticket UUID links', () => {
    expect(createProblemSchema.safeParse({
      title: 'ระบบล่มซ้ำทุกวันจันทร์', priority: 'สูง', status: 'กำลังวิเคราะห์',
      incidentIds: ['00000000-0000-0000-0000-000000000001'],
      ticketIds: ['00000000-0000-0000-0000-000000000002'],
    }).success).toBe(true);
  });

  it('rejects invalid priority and malformed references', () => {
    expect(createProblemSchema.safeParse({ title: 'ปัญหา', priority: 'เร่งด่วน', incidentIds: ['bad-id'] }).success).toBe(false);
  });

  it('requires a non-empty Problem update', () => {
    expect(updateProblemSchema.safeParse({}).success).toBe(false);
    expect(updateProblemSchema.safeParse({ rootCause: 'สาเหตุหลัก' }).success).toBe(true);
  });

  it('requires Problem, title and workaround for a Known Error', () => {
    const valid = { problemId: '00000000-0000-0000-0000-000000000001', title: 'Memory leak', workaround: 'Restart service' };
    expect(createKnownErrorSchema.safeParse(valid).success).toBe(true);
    expect(createKnownErrorSchema.safeParse({ ...valid, workaround: '' }).success).toBe(false);
  });
});
