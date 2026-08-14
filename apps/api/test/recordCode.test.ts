import { describe, expect, it } from 'vitest';
import { dailyRecordCode, monthlyRecordCode, randomCodeSuffix } from '../src/utils/recordCode';

/**
 * ทุกโมดูลเคยออกรหัสอ้างอิงด้วย Math.random() 4 หลัก (9,000 ค่าต่อวันต่อ prefix) ตามหลักปัญหาวันเกิด
 * โอกาสชนกันถึง 50% ที่ราว 112 รายการต่อวัน และหลายตารางไม่มี unique constraint คอยรับไว้
 * (พบตอน Pre-production QA audit 2026-08-13)
 */
describe('randomCodeSuffix', () => {
  it('always produces eight uppercase hex characters', () => {
    for (let round = 0; round < 500; round += 1) {
      expect(randomCodeSuffix()).toMatch(/^[0-9A-F]{8}$/);
    }
  });

  it('does not repeat across a batch far larger than the old 9,000-value space', () => {
    const seen = new Set<string>();
    for (let round = 0; round < 20_000; round += 1) seen.add(randomCodeSuffix());
    // ช่วงค่าเดิมมีเพียง 9,000 ค่า การสุ่ม 20,000 ครั้งจึงชนกันแน่นอน ส่วนช่วงใหม่ต้องแทบไม่ชนเลย
    expect(seen.size).toBeGreaterThan(19_990);
  });

  it('beats the old generator by orders of magnitude on the same workload', () => {
    const legacy = new Set<string>();
    for (let round = 0; round < 2_000; round += 1) {
      legacy.add(String(Math.floor(Math.random() * 9000 + 1000)));
    }
    const current = new Set<string>();
    for (let round = 0; round < 2_000; round += 1) current.add(randomCodeSuffix());

    expect(legacy.size).toBeLessThan(2_000); // ตัวเดิมชนแน่นอนที่ปริมาณเท่านี้
    expect(current.size).toBe(2_000);
  });
});

describe('record code format', () => {
  const at = new Date('2026-08-14T03:04:05.000Z');

  it('keeps the daily shape PREFIX-YYYYMMDD-XXXXXXXX', () => {
    expect(dailyRecordCode('INC', at)).toMatch(/^INC-20260814-[0-9A-F]{8}$/);
  });

  it('keeps the monthly shape PREFIX-YYYYMM-XXXXXXXX', () => {
    expect(monthlyRecordCode('LIC', at)).toMatch(/^LIC-202608-[0-9A-F]{8}$/);
  });

  it('uses UTC so a code issued late in the Thai evening does not jump a day', () => {
    // 2026-08-14 23:30 ตามเวลาไทย = 16:30Z ของวันเดียวกัน
    expect(dailyRecordCode('GOV', new Date('2026-08-14T16:30:00.000Z'))).toContain('-20260814-');
  });
});
