import { describe, expect, it } from 'vitest';
import { buildLicenseCostSummary, type LicenseCostRow } from '../src/services/licenseCostService';

function row(overrides: Partial<LicenseCostRow> = {}): LicenseCostRow {
  return {
    id: 'lic-1',
    software_name: 'Adobe Acrobat',
    status: 'Active',
    total_qty: 10,
    used_qty: 4,
    unit_price: 1200,
    ...overrides,
  };
}

describe('buildLicenseCostSummary', () => {
  it('คิดเงินที่เรียกคืนได้จากสิทธิ์ที่ซื้อไว้แต่ไม่ได้ใช้', () => {
    const summary = buildLicenseCostSummary([row()]);
    expect(summary.reclaimableSeats).toBe(6);
    expect(summary.reclaimableAmount).toBe(7200);
    expect(summary.pricedCount).toBe(1);
  });

  it('ไม่นับรายการที่ยังไม่ได้ใส่ราคาเป็นศูนย์บาท แต่รายงานจำนวนไว้', () => {
    const summary = buildLicenseCostSummary([
      row({ id: 'a', unit_price: 1000, total_qty: 5, used_qty: 1 }),
      row({ id: 'b', unit_price: null, total_qty: 100, used_qty: 0 }),
    ]);

    // ถ้านับ b เป็นราคา 0 ยอดจะยังเป็น 4000 เท่าเดิมแต่ผู้อ่านจะเข้าใจว่าครบแล้ว
    expect(summary.reclaimableAmount).toBe(4000);
    expect(summary.pricedCount).toBe(1);
    expect(summary.unpricedCount).toBe(1);
  });

  it('ไม่นับลิขสิทธิ์ที่หมดอายุหรือปิดใช้ เพราะเรียกคืนอะไรไม่ได้แล้ว', () => {
    const summary = buildLicenseCostSummary([
      row({ id: 'expired', status: 'Expired', total_qty: 50, used_qty: 0 }),
      row({ id: 'inactive', status: 'Inactive', total_qty: 50, used_qty: 0 }),
    ]);
    expect(summary.reclaimableAmount).toBe(0);
    expect(summary.pricedCount).toBe(0);
    // ของที่ไม่ Active ต้องไม่ไปโผล่ในช่อง "ยังไม่ได้ใส่ราคา" ด้วย
    expect(summary.unpricedCount).toBe(0);
  });

  it('ใช้เกินสิทธิ์ไม่ทำให้ยอดติดลบไปหักของรายการอื่น', () => {
    const summary = buildLicenseCostSummary([
      row({ id: 'over', total_qty: 5, used_qty: 9, unit_price: 1000 }),
      row({ id: 'under', total_qty: 10, used_qty: 8, unit_price: 1000 }),
    ]);
    expect(summary.reclaimableAmount).toBe(2000);
    expect(summary.reclaimableSeats).toBe(2);
  });

  it('รับตัวเลขที่ Postgres ส่งกลับมาเป็นสตริงได้', () => {
    const summary = buildLicenseCostSummary([row({ total_qty: '10', used_qty: '4', unit_price: '1200.50' })]);
    expect(summary.reclaimableAmount).toBeCloseTo(7203, 5);
  });

  it('เรียงรายการที่ควรทบทวนก่อนจากเงินมากไปน้อย และตัดรายการที่ไม่มีเงินเหลือทิ้ง', () => {
    const summary = buildLicenseCostSummary([
      row({ id: 'small', software_name: 'Small', total_qty: 2, used_qty: 1, unit_price: 100 }),
      row({ id: 'big', software_name: 'Big', total_qty: 20, used_qty: 2, unit_price: 5000 }),
      row({ id: 'full', software_name: 'Full', total_qty: 3, used_qty: 3, unit_price: 900 }),
    ]);

    expect(summary.topOpportunities.map((item) => item.id)).toEqual(['big', 'small']);
    expect(summary.topOpportunities[0].reclaimableAmount).toBe(90000);
  });

  it('ไม่มีลิขสิทธิ์เลยก็ต้องคืนศูนย์ ไม่ใช่ NaN', () => {
    const summary = buildLicenseCostSummary([]);
    expect(summary).toEqual({
      reclaimableAmount: 0,
      reclaimableSeats: 0,
      pricedCount: 0,
      unpricedCount: 0,
      topOpportunities: [],
    });
  });
});
