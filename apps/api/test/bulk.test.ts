import { describe, expect, it } from 'vitest';
import { BulkItemError, runBulk } from '../src/utils/bulk';

describe('runBulk', () => {
  it('คืนผลแยกต่อรายการ แทนที่จะล้มทั้งชุดเพราะรายการเดียว', async () => {
    const result = await runBulk(['a', 'b', 'c'], async (id) => {
      if (id === 'b') throw new BulkItemError('NOT_FOUND', 'ไม่พบรายการนี้');
      return { id };
    });

    expect(result.succeeded).toEqual([{ id: 'a' }, { id: 'c' }]);
    expect(result.failed).toEqual([{ id: 'b', code: 'NOT_FOUND', message: 'ไม่พบรายการนี้' }]);
  });

  it('ทำตามลำดับที่ส่งมา ไม่ขนาน เพื่อให้ audit log เรียงตามที่เกิดจริง', async () => {
    const order: string[] = [];
    await runBulk(['a', 'b', 'c'], async (id) => {
      order.push(`start:${id}`);
      await new Promise((resolve) => setTimeout(resolve, id === 'a' ? 10 : 0));
      order.push(`end:${id}`);
      return id;
    });

    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c']);
  });

  it('ตัด id ซ้ำทิ้ง ไม่งั้นรายการเดียวจะถูกเขียน log สองรอบ', async () => {
    let calls = 0;
    const result = await runBulk(['a', 'a', 'b'], async (id) => {
      calls += 1;
      return id;
    });

    expect(calls).toBe(2);
    expect(result.succeeded).toEqual(['a', 'b']);
  });

  it('รายงานข้อผิดพลาดที่ไม่คาดคิดเป็นรายการที่ไม่สำเร็จ ไม่โยนออกไปทั้งชุด', async () => {
    const result = await runBulk(['a', 'b'], async (id) => {
      if (id === 'a') throw new TypeError('อ่านค่าจาก undefined');
      return id;
    });

    expect(result.succeeded).toEqual(['b']);
    expect(result.failed).toEqual([{ id: 'a', code: 'BULK_ITEM_FAILED', message: 'ดำเนินการกับรายการนี้ไม่สำเร็จ' }]);
  });
});
