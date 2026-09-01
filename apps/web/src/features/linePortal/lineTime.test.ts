import { describe, expect, it } from 'vitest';
import { relativeThaiTime } from './lineTime';

const NOW = new Date('2026-08-29T10:00:00.000Z');

describe('relativeThaiTime', () => {
  it('ย่อช่วงเวลาล่าสุดให้อ่านเร็วในฟีดแจ้งเตือน', () => {
    expect(relativeThaiTime('2026-08-29T09:59:30.000Z', NOW)).toBe('เมื่อสักครู่');
    expect(relativeThaiTime('2026-08-29T09:45:00.000Z', NOW)).toBe('15 นาที');
    expect(relativeThaiTime('2026-08-29T05:00:00.000Z', NOW)).toBe('5 ชม.');
    expect(relativeThaiTime('2026-08-28T09:00:00.000Z', NOW)).toBe('เมื่อวาน');
    expect(relativeThaiTime('2026-08-26T09:00:00.000Z', NOW)).toBe('3 วัน');
  });

  it('กลับไปใช้วันที่จริงเมื่อเกินหนึ่งสัปดาห์ เพราะ "12 วัน" อ่านแล้วนึกภาพไม่ออก', () => {
    expect(relativeThaiTime('2026-08-17T09:00:00.000Z', NOW)).toMatch(/ส\.ค\./);
  });

  it('คืน - เมื่อค่าที่ได้ไม่ใช่วันที่ แทนการโยน error กลางหน้าจอ', () => {
    expect(relativeThaiTime('ไม่ใช่วันที่', NOW)).toBe('-');
  });
});
