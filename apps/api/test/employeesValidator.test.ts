import { describe, expect, it } from 'vitest';
import { createEmployeeSchema, listEmployeesQuerySchema, updateEmployeeSchema } from '../src/validators/employees';

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
