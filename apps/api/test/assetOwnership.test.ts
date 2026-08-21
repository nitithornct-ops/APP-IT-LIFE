import { describe, expect, it } from 'vitest';
import {
  ASSET_DEFAULT_RETURN_LOCATION,
  buildAssignPatch,
  buildReturnPatch,
  isAssetRetired,
} from '../src/services/assetOwnership';

const now = new Date('2026-08-21T04:00:00.000Z');
const actorId = '00000000-0000-0000-0000-0000000000aa';

describe('isAssetRetired', () => {
  it('กันเฉพาะของที่ออกจากทะเบียนใช้งานแล้ว', () => {
    expect(isAssetRetired('จำหน่าย/เลิกใช้')).toBe(true);
    expect(isAssetRetired('สูญหาย')).toBe(true);
    expect(isAssetRetired('ซ่อมบำรุง')).toBe(false);
    expect(isAssetRetired(null)).toBe(false);
  });
});

describe('buildAssignPatch', () => {
  it('ตกทอดแผนกของผู้รับเมื่อผู้เรียกไม่ได้ระบุแผนกปลายทาง', () => {
    const patch = buildAssignPatch({
      toEmployeeId: 'emp-1',
      employeeDepartmentId: 'dept-emp',
      currentLocation: 'ชั้น 3',
      actorId,
      now,
    });

    expect(patch.department_id).toBe('dept-emp');
    expect(patch.status).toBe('ใช้งานอยู่');
    expect(patch.loan_date).toBe('2026-08-21');
    expect(patch.loan_due_date).toBeNull();
  });

  it('ให้แผนกและสถานที่ที่ระบุมาชนะค่าที่ตกทอด', () => {
    const patch = buildAssignPatch({
      toEmployeeId: 'emp-1',
      employeeDepartmentId: 'dept-emp',
      departmentId: 'dept-chosen',
      location: 'ชั้น 5',
      currentLocation: 'ชั้น 3',
      dueDate: '2026-09-30',
      actorId,
      now,
    });

    expect(patch.department_id).toBe('dept-chosen');
    expect(patch.location).toBe('ชั้น 5');
    expect(patch.loan_due_date).toBe('2026-09-30');
  });

  it('คงสถานที่เดิมไว้เมื่อไม่ได้ระบุสถานที่ใหม่', () => {
    const patch = buildAssignPatch({
      toEmployeeId: 'emp-1',
      employeeDepartmentId: null,
      currentLocation: 'ชั้น 3',
      actorId,
      now,
    });

    expect(patch.location).toBe('ชั้น 3');
    expect(patch.department_id).toBeNull();
  });
});

describe('buildReturnPatch', () => {
  it('ล้างผู้ถือครองทั้งหมด ไม่ใช่แค่เปลี่ยนสถานะ', () => {
    const patch = buildReturnPatch({ actorId });

    expect(patch.status).toBe('พร้อมใช้งาน');
    expect(patch.owner_employee_id).toBeNull();
    expect(patch.department_id).toBeNull();
    expect(patch.loan_date).toBeNull();
    expect(patch.loan_due_date).toBeNull();
    expect(patch.location).toBe(ASSET_DEFAULT_RETURN_LOCATION);
  });

  it('ใช้สถานที่ที่ระบุแทนคลังตั้งต้น', () => {
    expect(buildReturnPatch({ location: 'ห้อง Server', actorId }).location).toBe('ห้อง Server');
  });
});
