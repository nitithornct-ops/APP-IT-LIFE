import { describe, expect, it } from 'vitest';
import { bulkUpdateEmployeesSchema, createEmployeeSchema, employeeLifecycleSchema, listEmployeesQuerySchema, updateEmployeeSchema } from '../src/validators/employees';

const DEPARTMENT_ID = '11111111-1111-4111-8111-111111111111';

describe('employee validators', () => {
  it('accepts the complete employee registry form', () => {
    const result = createEmployeeSchema.safeParse({
      employeeCode: '690401',
      prefixTh: 'นาย',
      firstNameTh: 'ทดสอบ',
      lastNameTh: 'ระบบ',
      firstNameEn: 'Test',
      lastNameEn: 'System',
      departmentId: DEPARTMENT_ID,
      usernameAd: 'test.user',
      upn: 'test.user@example.com',
      email: 'test.user@example.com',
    });
    expect(result.success).toBe(true);
  });

  it('accepts personnel source fields and rejects inverted employment dates', () => {
    expect(createEmployeeSchema.safeParse({
      employeeCode: '690402',
      firstNameTh: 'Source',
      lastNameTh: 'Employee',
      managerEmployeeId: DEPARTMENT_ID,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      employmentStatus: 'contractor',
      location: 'Bangkok',
    }).success).toBe(true);

    expect(createEmployeeSchema.safeParse({
      employeeCode: '690403',
      firstNameTh: 'Invalid',
      lastNameTh: 'Dates',
      startDate: '2026-12-31',
      endDate: '2026-01-01',
    }).success).toBe(false);
  });

  it('accepts status, department and ownership list filters', () => {
    expect(listEmployeesQuerySchema.parse({
      page: '2',
      pageSize: '25',
      status: 'active',
      departmentId: DEPARTMENT_ID,
      ownership: 'with',
    })).toMatchObject({ page: 2, pageSize: 25, status: 'active', ownership: 'with' });
  });

  it('rejects invalid filters and accepts a status-only update', () => {
    expect(listEmployeesQuerySchema.safeParse({ ownership: 'unknown' }).success).toBe(false);
    expect(listEmployeesQuerySchema.safeParse({ departmentId: 'not-uuid' }).success).toBe(false);
    expect(updateEmployeeSchema.safeParse({ status: 'inactive' }).success).toBe(true);
  });
});

describe('employeeLifecycleSchema', () => {
  it('accepts joiner, mover and leaver event shapes', () => {
    for (const eventType of ['JOINER', 'MOVER', 'LEAVER'] as const) {
      expect(employeeLifecycleSchema.safeParse({
        eventType,
        effectiveDate: '2026-09-01',
        reason: `${eventType} test`,
      }).success).toBe(true);
    }
  });

  it('rejects an invalid event type and missing reason', () => {
    expect(employeeLifecycleSchema.safeParse({ eventType: 'TRANSFER', effectiveDate: '2026-09-01', reason: 'test' }).success).toBe(false);
    expect(employeeLifecycleSchema.safeParse({ eventType: 'LEAVER', effectiveDate: '2026-09-01', reason: '' }).success).toBe(false);
  });
});

describe('bulkUpdateEmployeesSchema', () => {
  it('รับเฉพาะงานที่เกิดกับคนหลายคนพร้อมกันจริง', () => {
    expect(bulkUpdateEmployeesSchema.safeParse({ ids: [DEPARTMENT_ID], status: 'inactive' }).success).toBe(true);
    expect(bulkUpdateEmployeesSchema.safeParse({ ids: [DEPARTMENT_ID], departmentId: DEPARTMENT_ID }).success).toBe(true);
  });

  it('ปฏิเสธคำสั่งที่ไม่ได้บอกว่าจะเปลี่ยนอะไร', () => {
    expect(bulkUpdateEmployeesSchema.safeParse({ ids: [DEPARTMENT_ID] }).success).toBe(false);
  });

  it('จำกัดจำนวนต่อครั้งและตรวจรูปแบบ id', () => {
    expect(bulkUpdateEmployeesSchema.safeParse({ ids: [], status: 'active' }).success).toBe(false);
    expect(bulkUpdateEmployeesSchema.safeParse({ ids: Array.from({ length: 51 }, () => DEPARTMENT_ID), status: 'active' }).success).toBe(false);
    expect(bulkUpdateEmployeesSchema.safeParse({ ids: ['not-uuid'], status: 'active' }).success).toBe(false);
  });
});
