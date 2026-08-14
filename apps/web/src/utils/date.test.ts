import { afterEach, describe, expect, it } from 'vitest';
import { formatThaiDate, formatThaiDateTime, toBuddhistYear } from './date';

describe('toBuddhistYear', () => {
  it('adds 543 years to the Gregorian year', () => {
    expect(toBuddhistYear(2026)).toBe(2569);
  });
});

describe('formatThaiDate', () => {
  it('formats a date with the Thai month name and Buddhist year', () => {
    expect(formatThaiDate(new Date(2026, 7, 5))).toBe('5 สิงหาคม 2569');
  });

  it('substitutes a yyyy token in the pattern instead of appending a duplicate year', () => {
    const result = formatThaiDate(new Date(2026, 7, 6, 9, 6), 'd MMMM yyyy HH:mm');
    expect(result).toBe('6 สิงหาคม 2569 09:06');
    expect(result).not.toContain('2026');
  });

  it('returns an empty string rather than throwing when the value is not a date', () => {
    expect(formatThaiDate('ไม่ใช่วันที่')).toBe('');
    expect(formatThaiDate(Number.NaN)).toBe('');
  });
});

/**
 * ฐานข้อมูลเก็บเวลาเป็น UTC — ผลลัพธ์ที่ผู้ใช้เห็นต้องเป็นเวลาไทยเสมอ ไม่ว่าเครื่องจะตั้งโซนไว้อย่างไร
 * เทสต์ชุดนี้สลับ TZ ของ process จริงเพื่อพิสูจน์ ไม่ได้ยึดตามโซนของเครื่องที่รันเทสต์
 */
describe('formatThaiDate pins output to Asia/Bangkok', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  // 2026-08-05T17:30:00Z = 6 ส.ค. 2569 00:30 ตามเวลาไทย (UTC+7) — คนละวันกับ UTC
  const instant = new Date('2026-08-05T17:30:00.000Z');

  it('shows the Thai calendar day even when the machine runs on UTC', () => {
    process.env.TZ = 'UTC';
    expect(formatThaiDateTime(instant)).toBe('6 สิงหาคม 2569 00:30');
  });

  it('shows the same Thai time on a machine set to New York', () => {
    process.env.TZ = 'America/New_York';
    expect(formatThaiDateTime(instant)).toBe('6 สิงหาคม 2569 00:30');
  });

  it('shows the same Thai time on a machine set to Tokyo', () => {
    process.env.TZ = 'Asia/Tokyo';
    expect(formatThaiDateTime(instant)).toBe('6 สิงหาคม 2569 00:30');
  });

  it('keeps a date-only format on the Thai side of midnight', () => {
    process.env.TZ = 'UTC';
    expect(formatThaiDate(instant)).toBe('6 สิงหาคม 2569');
  });
});
