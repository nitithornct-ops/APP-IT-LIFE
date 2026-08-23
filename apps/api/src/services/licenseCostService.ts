/**
 * สรุปเงินที่เรียกคืนได้จากสิทธิ์ซอฟต์แวร์ที่ซื้อไว้แต่ไม่ได้ใช้
 * design_handoff_it_service_redesign 02-screens.md หัวข้อ "3e" การ์ดสรุปเงินที่ประหยัดได้
 *
 * คิดจาก (จำนวนที่ซื้อ − จำนวนที่ใช้) × ราคาต่อสิทธิ์ เฉพาะลิขสิทธิ์ที่ยัง Active และ **มีราคาบันทึกไว้**
 *
 * กติกาที่สำคัญที่สุดของไฟล์นี้คือแถวที่ยังไม่กรอกราคาต้องไม่ถูกนับเป็นศูนย์บาท ไม่งั้นตัวเลขสรุป
 * จะต่ำกว่าความจริงเสมอโดยไม่มีใครรู้ว่าต่ำเพราะอะไร ทุกผลลัพธ์จึงพก unpricedCount กลับไปด้วย
 * เพื่อให้หน้าจอบอกได้ว่า "ตัวเลขนี้ยังไม่รวมลิขสิทธิ์อีก N รายการที่ยังไม่ได้ใส่ราคา"
 *
 * ลิขสิทธิ์ที่หมดอายุหรือปิดใช้ไม่นับ เพราะสิทธิ์ที่หมดอายุแล้วไม่มีอะไรให้คืนอีก การนับรวมจะทำให้
 * ตัวเลขพองขึ้นจากเงินที่จ่ายไปแล้วและเรียกคืนไม่ได้
 */

export interface LicenseCostRow {
  id: string;
  software_name: string;
  status: string;
  total_qty: number | string | null;
  used_qty: number | string | null;
  unit_price: number | string | null;
}

export interface LicenseCostItem {
  id: string;
  softwareName: string;
  unusedSeats: number;
  unitPrice: number;
  reclaimableAmount: number;
}

export interface LicenseCostSummary {
  /** รวมเงินที่เรียกคืนได้จากสิทธิ์ที่ไม่ได้ใช้ (บาท) */
  reclaimableAmount: number;
  /** จำนวนสิทธิ์ที่ซื้อไว้แต่ไม่ได้ใช้ นับเฉพาะรายการที่มีราคา */
  reclaimableSeats: number;
  /** จำนวนลิขสิทธิ์ Active ที่มีราคาบันทึกไว้ */
  pricedCount: number;
  /** จำนวนลิขสิทธิ์ Active ที่ยังไม่ได้บันทึกราคา — ยอดรวมยังไม่รวมของพวกนี้ */
  unpricedCount: number;
  /** เรียงจากเงินที่เรียกคืนได้มากไปน้อย เพื่อให้รู้ว่าควรเริ่มทบทวนสัญญาใด */
  topOpportunities: LicenseCostItem[];
}

const TOP_LIMIT = 5;

function toNumber(value: number | string | null): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildLicenseCostSummary(rows: LicenseCostRow[]): LicenseCostSummary {
  const items: LicenseCostItem[] = [];
  let unpricedCount = 0;

  for (const row of rows) {
    if (row.status !== 'Active') continue;

    const unitPrice = toNumber(row.unit_price);
    if (unitPrice === null) {
      unpricedCount += 1;
      continue;
    }

    const total = toNumber(row.total_qty) ?? 0;
    const used = toNumber(row.used_qty) ?? 0;
    // ใช้เกินสิทธิ์ (used > total) เป็นคนละปัญหาและมีการ์ดของตัวเองอยู่แล้ว ที่นี่จึงไม่ให้ติดลบ
    const unusedSeats = Math.max(0, total - used);

    items.push({
      id: row.id,
      softwareName: row.software_name,
      unusedSeats,
      unitPrice,
      reclaimableAmount: unusedSeats * unitPrice,
    });
  }

  const reclaimableAmount = items.reduce((sum, item) => sum + item.reclaimableAmount, 0);
  const reclaimableSeats = items.reduce((sum, item) => sum + item.unusedSeats, 0);

  return {
    reclaimableAmount,
    reclaimableSeats,
    pricedCount: items.length,
    unpricedCount,
    topOpportunities: items
      .filter((item) => item.reclaimableAmount > 0)
      .sort((a, b) => b.reclaimableAmount - a.reclaimableAmount)
      .slice(0, TOP_LIMIT),
  };
}
