import { describe, expect, it } from 'vitest';
import {
  auditChanges,
  auditChangesText,
  auditContext,
  auditFieldLabel,
  auditSummary,
  auditValueText,
  hasAuditDetail,
} from './auditDisplay';

const editDetail = {
  changes: {
    status: { from: 'กำลังดำเนินการ', to: 'เสร็จสิ้น' },
    assignee_id: { from: null, to: 'u-2' },
  },
  changedFields: ['status', 'assignee_id'],
};

describe('auditChanges', () => {
  it('กางผลเทียบก่อน/หลังที่ฝั่ง api เก็บไว้ ให้เห็นทั้งค่าเดิมและค่าใหม่', () => {
    expect(auditChanges(editDetail)).toEqual([
      { field: 'assignee_id', label: 'ผู้รับผิดชอบ', from: null, to: 'u-2' },
      { field: 'status', label: 'สถานะ', from: 'กำลังดำเนินการ', to: 'เสร็จสิ้น' },
    ]);
  });

  it('ไม่พังเมื่อ log ไม่ใช่การแก้ไข เช่น การเข้าสู่ระบบหรือการส่งออก', () => {
    expect(auditChanges(null)).toEqual([]);
    expect(auditChanges({ rowCount: 12 })).toEqual([]);
    expect(auditChanges('ไม่ใช่ object')).toEqual([]);
  });
});

describe('auditFieldLabel', () => {
  it('แปลชื่อคอลัมน์ที่รู้จัก', () => {
    expect(auditFieldLabel('due_at')).toBe('ครบกำหนด SLA');
  });

  it('คงชื่อดิบไว้เมื่อไม่รู้จัก แทนที่จะเดาแล้วผู้ตรวจสอบเข้าใจผิด', () => {
    expect(auditFieldLabel('some_new_column')).toBe('some_new_column');
  });
});

describe('auditValueText', () => {
  it('แยก "ว่าง" ออกจากค่าที่มีจริง', () => {
    expect(auditValueText(null)).toBe('(ว่าง)');
    expect(auditValueText('')).toBe('(ว่าง)');
    expect(auditValueText(undefined)).toBe('(ว่าง)');
    // เลข 0 กับ false เป็นค่าจริง ไม่ใช่ความว่างเปล่า
    expect(auditValueText(0)).toBe('0');
    expect(auditValueText(false)).toBe('ไม่ใช่');
  });
});

describe('auditSummary', () => {
  it('บอกจำนวนและชื่อฟิลด์ที่เปลี่ยน', () => {
    expect(auditSummary(editDetail)).toBe('แก้ไข 2 ฟิลด์: ผู้รับผิดชอบ, สถานะ');
  });

  it('ย่อเมื่อเปลี่ยนหลายฟิลด์ แทนที่จะยาวจนล้นช่อง', () => {
    const many = {
      changes: Object.fromEntries(
        ['status', 'title', 'priority', 'location', 'notes'].map((key) => [key, { from: 'a', to: 'b' }]),
      ),
    };
    expect(auditSummary(many)).toContain('แก้ไข 5 ฟิลด์');
    expect(auditSummary(many)).toContain('และอีก 2');
  });

  it('สรุป log ที่ไม่ใช่การแก้ไขด้วยค่าที่มีจริง ไม่ใช่ JSON ดิบ', () => {
    expect(auditSummary({ rowCount: 120, bulk: true })).toBe('rowCount: 120 · bulk: ใช่');
  });

  it('คืนขีดเมื่อไม่มีรายละเอียดเลย', () => {
    expect(auditSummary(null)).toBe('—');
    expect(auditSummary({})).toBe('—');
  });
});

describe('auditContext', () => {
  it('ตัดผลเทียบก่อน/หลังออก เหลือเฉพาะบริบทอื่นของ log', () => {
    expect(auditContext({ ...editDetail, bulk: true })).toEqual([['bulk', true]]);
  });
});

describe('hasAuditDetail', () => {
  it('บอกว่ามีอะไรให้กางดูหรือไม่', () => {
    expect(hasAuditDetail(editDetail)).toBe(true);
    expect(hasAuditDetail({ rowCount: 1 })).toBe(true);
    expect(hasAuditDetail({})).toBe(false);
    expect(hasAuditDetail(null)).toBe(false);
  });
});

describe('auditChangesText', () => {
  it('ใส่ค่าก่อน/หลังมาด้วยครบ เพราะในไฟล์ไม่มีปุ่มให้กางดู', () => {
    expect(auditChangesText(editDetail)).toBe(
      'ผู้รับผิดชอบ: (ว่าง) → u-2 | สถานะ: กำลังดำเนินการ → เสร็จสิ้น',
    );
  });

  it('รวมบริบทอื่นของ log ที่ไม่ใช่การแก้ไขด้วย', () => {
    expect(auditChangesText({ rowCount: 240 })).toBe('rowCount: 240');
    expect(auditChangesText(null)).toBe('—');
  });
});
