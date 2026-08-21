import { describe, expect, it } from 'vitest';
import { applySort } from '../src/utils/sort';

interface OrderCall {
  column: string;
  ascending?: boolean;
  nullsFirst?: boolean;
}

/** ตัวปลอมของ query builder ที่บันทึกทุก .order() ที่ถูกเรียก ตามลำดับ */
function fakeQuery() {
  const calls: OrderCall[] = [];
  const query = {
    calls,
    order(column: string, options: { ascending?: boolean; nullsFirst?: boolean }) {
      calls.push({ column, ...options });
      return query;
    },
  };
  return query;
}

const TICKET_SORTS = ['created_at', 'due_at', 'priority', 'status'] as const;
const FALLBACK = { column: 'created_at', ascending: false };

describe('applySort', () => {
  it('เรียงตามคอลัมน์ที่อยู่ใน allowlist', () => {
    const query = applySort(fakeQuery(), { sort: 'due_at', order: 'asc' }, TICKET_SORTS, FALLBACK);
    expect(query.calls[0]).toEqual({ column: 'due_at', ascending: true, nullsFirst: false });
  });

  it('order=desc เรียงจากมากไปน้อย และ default เป็น asc เมื่อไม่ระบุ', () => {
    expect(applySort(fakeQuery(), { sort: 'due_at', order: 'desc' }, TICKET_SORTS, FALLBACK).calls[0].ascending).toBe(false);
    expect(applySort(fakeQuery(), { sort: 'due_at' }, TICKET_SORTS, FALLBACK).calls[0].ascending).toBe(true);
  });

  it('ปฏิเสธคอลัมน์นอก allowlist แล้วตกกลับไปใช้ fallback', () => {
    const query = applySort(fakeQuery(), { sort: 'profiles.email', order: 'asc' }, TICKET_SORTS, FALLBACK);
    expect(query.calls).toEqual([{ column: 'created_at', ascending: false, nullsFirst: false }]);
  });

  it('ใช้ fallback เมื่อไม่ได้ส่ง sort มา', () => {
    const query = applySort(fakeQuery(), {}, TICKET_SORTS, FALLBACK);
    expect(query.calls).toEqual([{ column: 'created_at', ascending: false, nullsFirst: false }]);
  });

  it('เติม fallback เป็นลำดับรอง เพื่อให้แถวไม่สลับกันเองระหว่างหน้า', () => {
    const query = applySort(fakeQuery(), { sort: 'status', order: 'asc' }, TICKET_SORTS, FALLBACK);
    expect(query.calls).toEqual([
      { column: 'status', ascending: true, nullsFirst: false },
      { column: 'created_at', ascending: false, nullsFirst: false },
    ]);
  });

  it('ไม่เติมลำดับรองซ้ำเมื่อเรียงตามคอลัมน์เดียวกับ fallback อยู่แล้ว', () => {
    const query = applySort(fakeQuery(), { sort: 'created_at', order: 'asc' }, TICKET_SORTS, FALLBACK);
    expect(query.calls).toEqual([{ column: 'created_at', ascending: true, nullsFirst: false }]);
  });

  it('ให้แถวที่ไม่มีค่าอยู่ท้ายเสมอทั้งสองทิศ', () => {
    expect(applySort(fakeQuery(), { sort: 'due_at', order: 'asc' }, TICKET_SORTS, FALLBACK).calls[0].nullsFirst).toBe(false);
    expect(applySort(fakeQuery(), { sort: 'due_at', order: 'desc' }, TICKET_SORTS, FALLBACK).calls[0].nullsFirst).toBe(false);
  });
});
