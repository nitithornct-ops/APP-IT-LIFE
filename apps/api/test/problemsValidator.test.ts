import { describe, expect, it } from 'vitest';
import {
  createCorrectiveActionSchema,
  createProblemSchema,
  updateProblemSchema,
} from '../src/validators/problems';

const id = '00000000-0000-4000-8000-000000000001';

describe('Problem governance validators', () => {
  it('requires a Change when a Permanent Fix is recorded', () => {
    expect(createProblemSchema.safeParse({ title: 'ปัญหา', permanentFix: 'แก้ถาวรแล้ว' }).success).toBe(false);
    expect(createProblemSchema.safeParse({ title: 'ปัญหา', permanentFix: 'แก้ถาวรแล้ว', changeIds: [id], configurationItemIds: [id], rcaMethod: '5 Why', fiveWhy: [{ question: 'Why 1', answer: 'เพราะระบบล่ม' }] }).success).toBe(true);
    expect(updateProblemSchema.safeParse({ permanentFix: 'แก้ถาวรแล้ว' }).success).toBe(false);
  });

  it('requires a linked Change when moving a Problem to closed state', () => {
    expect(updateProblemSchema.safeParse({ status: 'ปิด' }).success).toBe(false);
    expect(updateProblemSchema.safeParse({ status: 'ปิด', changeIds: [id] }).success).toBe(true);
  });

  it('requires verification evidence for a completed child action', () => {
    expect(createCorrectiveActionSchema.safeParse({ title: 'เพิ่ม monitoring', status: 'เสร็จสิ้น' }).success).toBe(false);
    expect(createCorrectiveActionSchema.safeParse({ title: 'เพิ่ม monitoring', status: 'เสร็จสิ้น', verificationNotes: 'ตรวจ alert แล้ว' }).success).toBe(true);
  });
});
