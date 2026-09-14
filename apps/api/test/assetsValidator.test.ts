import { describe, expect, it } from 'vitest';
import { assetLoanCreateSchema, bulkUpdateAssetsSchema } from '../src/validators/assets';

const ID = '11111111-1111-4111-8111-111111111111';

describe('bulkUpdateAssetsSchema', () => {
  it('รับคำสั่งที่ระบุสิ่งที่จะเปลี่ยนอย่างน้อยหนึ่งอย่าง', () => {
    expect(bulkUpdateAssetsSchema.safeParse({ ids: [ID], status: 'ซ่อมบำรุง' }).success).toBe(true);
    expect(bulkUpdateAssetsSchema.safeParse({ ids: [ID], location: 'ห้อง Server' }).success).toBe(true);
    expect(bulkUpdateAssetsSchema.safeParse({ ids: [ID], ownerEmployeeId: ID }).success).toBe(true);
    // null = คืนของ ต่างจากไม่ส่งฟิลด์มาเลย
    expect(bulkUpdateAssetsSchema.safeParse({ ids: [ID], ownerEmployeeId: null }).success).toBe(true);
  });

  it('ไม่ให้ปลดของออกจากทะเบียนใช้งานทีละหลายชิ้น', () => {
    for (const status of ['จำหน่าย/เลิกใช้', 'สูญหาย']) {
      expect(bulkUpdateAssetsSchema.safeParse({ ids: [ID], status }).success).toBe(false);
    }
  });

  it('ปฏิเสธคำสั่งที่ไม่ได้บอกว่าจะเปลี่ยนอะไร', () => {
    expect(bulkUpdateAssetsSchema.safeParse({ ids: [ID] }).success).toBe(false);
    expect(bulkUpdateAssetsSchema.safeParse({ ids: [ID], notes: 'ย้ายห้อง' }).success).toBe(false);
  });

  it('จำกัดจำนวนต่อครั้งและตรวจรูปแบบ id', () => {
    expect(bulkUpdateAssetsSchema.safeParse({ ids: [], status: 'ซ่อมบำรุง' }).success).toBe(false);
    expect(bulkUpdateAssetsSchema.safeParse({ ids: Array.from({ length: 51 }, () => ID), status: 'ซ่อมบำรุง' }).success).toBe(false);
    expect(bulkUpdateAssetsSchema.safeParse({ ids: ['not-uuid'], status: 'ซ่อมบำรุง' }).success).toBe(false);
  });

  it('ไม่รับสถานที่ว่าง เพราะการล้างสถานที่ทิ้งไม่ใช่สิ่งที่ผู้ใช้ตั้งใจสั่ง', () => {
    expect(bulkUpdateAssetsSchema.safeParse({ ids: [ID], location: '   ' }).success).toBe(false);
  });
});

describe('assetLoanCreateSchema', () => {
  const validLoan = {
    assetId: ID,
    borrowerEmployeeId: '22222222-2222-4222-8222-222222222222',
    approverEmployeeId: '33333333-3333-4333-8333-333333333333',
    borrowedAt: '2026-09-12',
    dueAt: '2026-09-19',
    purpose: 'Field work',
    conditionBefore: 'Good',
    companionEquipment: ['Adapter'],
    borrowerAcknowledged: true,
    borrowerAcknowledgementName: 'Borrower',
  };

  it('accepts the complete loan payload and applies reminder defaults', () => {
    const result = assetLoanCreateSchema.safeParse(validLoan);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.reminderDaysBefore).toBe(3);
  });

  it('rejects an invalid date range or missing acknowledgement', () => {
    expect(assetLoanCreateSchema.safeParse({ ...validLoan, dueAt: '2026-09-11' }).success).toBe(false);
    expect(assetLoanCreateSchema.safeParse({ ...validLoan, borrowerAcknowledged: false }).success).toBe(false);
  });
});
