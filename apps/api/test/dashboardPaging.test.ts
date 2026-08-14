import { describe, expect, it } from 'vitest';

/**
 * ตรรกะการไล่ดึงข้อมูลของ /dashboard/summary
 *
 * โค้ดเดิมใช้ `.limit(2000)` ครั้งเดียวโดยไม่มี `.order()` ผลจริงคือ:
 *   * ได้แค่ 1000 แถว เพราะ PostgREST มีเพดาน max-rows ของตัวเอง `.limit(2000)` จึงไม่เคยมีผล
 *   * ยอดบนการ์ดหยุดนิ่งเมื่อข้อมูลเกินเพดาน โดยไม่มีอะไรบอกผู้ใช้ว่าตัวเลขถูกตัด
 * (พบตอน Pre-production QA audit 2026-08-13)
 *
 * เทสต์นี้จำลอง PostgREST ที่มีเพดาน max-rows หลายค่า เพื่อยืนยันว่าการไล่ดึงยึด count ของ
 * ฐานข้อมูลเป็นหลัก ไม่ใช่ขนาดของหน้าที่ได้กลับมา
 */

const PAGE_SIZE = 1000;
const MAX_SCAN_ROWS = 10_000;

/** ตรรกะเดียวกับ loadSource() ใน routes/dashboard.ts แยกออกมาให้ทดสอบได้โดยไม่ต้องมี Supabase จริง */
async function scan(
  fetchPage: (from: number, to: number) => Promise<{ data: unknown[]; count: number }>,
): Promise<{ rows: unknown[]; total: number; truncated: boolean; requests: number }> {
  const rows: unknown[] = [];
  let total = 0;
  let requests = 0;

  while (rows.length < MAX_SCAN_ROWS) {
    const { data, count } = await fetchPage(rows.length, rows.length + PAGE_SIZE - 1);
    requests += 1;
    total = count;
    rows.push(...data);
    if (data.length === 0 || rows.length >= total) break;
  }

  return { rows, total, truncated: total > rows.length, requests };
}

/** PostgREST จำลอง: ตอบไม่เกิน serverMaxRows แถวต่อคำขอ ไม่ว่าจะขอช่วงกว้างแค่ไหน */
function fakePostgrest(totalRows: number, serverMaxRows: number) {
  const all = Array.from({ length: totalRows }, (_, index) => ({ id: index }));
  return async (from: number, to: number) => ({
    data: all.slice(from, Math.min(to + 1, from + serverMaxRows)),
    count: totalRows,
  });
}

describe('dashboard source paging', () => {
  it('reads every row when the data set is larger than the old 2000 cap', async () => {
    const result = await scan(fakePostgrest(2100, 1000));
    expect(result.total).toBe(2100);
    expect(result.rows).toHaveLength(2100);
    expect(result.truncated).toBe(false);
  });

  it('still finishes when the server caps pages well below PAGE_SIZE', async () => {
    // เพดานฝั่ง PostgREST ต่ำกว่าขนาดหน้าที่เราขอ — เงื่อนไขหยุดต้องมาจาก count ไม่ใช่ขนาดหน้า
    const result = await scan(fakePostgrest(2100, 250));
    expect(result.rows).toHaveLength(2100);
    expect(result.truncated).toBe(false);
    expect(result.requests).toBe(Math.ceil(2100 / 250));
  });

  it('reports the true total but flags truncation past the safety ceiling', async () => {
    const result = await scan(fakePostgrest(25_000, 1000));
    expect(result.total).toBe(25_000);
    expect(result.rows).toHaveLength(MAX_SCAN_ROWS);
    expect(result.truncated).toBe(true);
  });

  it('makes a single request for a small table', async () => {
    const result = await scan(fakePostgrest(12, 1000));
    expect(result.rows).toHaveLength(12);
    expect(result.requests).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it('handles an empty table without looping', async () => {
    const result = await scan(fakePostgrest(0, 1000));
    expect(result.rows).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.requests).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it('stops exactly on a page boundary instead of asking for one empty page too many', async () => {
    const result = await scan(fakePostgrest(2000, 1000));
    expect(result.rows).toHaveLength(2000);
    expect(result.requests).toBe(2);
  });
});
