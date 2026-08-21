import { describe, expect, it } from 'vitest';
import { LOCKED_TICKET_STATUSES, TICKET_SLA_DUE_SOON_HOURS, ticketSlaBadge, ticketStatusLabel, ticketStatusTone } from './ticketDisplay';

describe('ticketDisplay', () => {
  it('distinguishes work completion from final closure', () => {
    expect(ticketStatusLabel['เสร็จสิ้น']).toBe('ซ่อมเสร็จ (รอยืนยัน)');
    expect(ticketStatusTone['เสร็จสิ้น']).toBe('warning');
    expect(ticketStatusLabel['ปิดงาน']).toBe('ปิดงานแล้ว');
    expect(ticketStatusTone['ปิดงาน']).toBe('success');
  });

  it('keeps resolved tickets actionable but locks final statuses', () => {
    expect(LOCKED_TICKET_STATUSES).not.toContain('เสร็จสิ้น');
    expect(LOCKED_TICKET_STATUSES).toEqual(['ปิดงาน', 'ยกเลิก', 'ยกระดับเป็น Incident']);
  });
});

describe('ticketSlaBadge', () => {
  const now = new Date('2026-08-20T10:00:00.000Z');
  const hoursFromNow = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();

  it('เตือนสีแดงเมื่อเลยกำหนด พร้อมบอกว่าเลยมานานเท่าไร', () => {
    expect(ticketSlaBadge(hoursFromNow(-2), 'กำลังดำเนินการ', now)).toEqual({
      state: 'overdue',
      tone: 'danger',
      label: 'เกินกำหนด 2 ชม.',
    });
  });

  it('เตือนสีเหลืองเมื่อใกล้ครบกำหนด', () => {
    expect(ticketSlaBadge(hoursFromNow(3), 'ใหม่', now)).toEqual({
      state: 'dueSoon',
      tone: 'warning',
      label: 'เหลือ 3 ชม.',
    });
  });

  it('ไม่เตือนเมื่อยังเหลือเวลามากกว่าเกณฑ์ใกล้ครบกำหนด', () => {
    expect(ticketSlaBadge(hoursFromNow(TICKET_SLA_DUE_SOON_HOURS + 1), 'ใหม่', now)).toBeNull();
  });

  it('ไม่เตือนเมื่อไม่ได้กำหนด SLA หรือค่าที่ได้มาใช้ไม่ได้', () => {
    expect(ticketSlaBadge(null, 'ใหม่', now)).toBeNull();
    expect(ticketSlaBadge(undefined, 'ใหม่', now)).toBeNull();
    expect(ticketSlaBadge('ไม่ใช่วันที่', 'ใหม่', now)).toBeNull();
  });

  it('หยุดเตือนเมื่องานเดินจบแล้ว แม้จะเลยกำหนดไปนานแล้วก็ตาม', () => {
    for (const status of ['เสร็จสิ้น', 'ปิดงาน', 'ยกเลิก', 'ยกระดับเป็น Incident'] as const) {
      expect(ticketSlaBadge(hoursFromNow(-99), status, now)).toBeNull();
    }
  });

  it('ปัดเวลาลง เพื่อไม่ให้ดูเหลือเวลามากกว่าความจริง', () => {
    expect(ticketSlaBadge(hoursFromNow(1.9), 'ใหม่', now)?.label).toBe('เหลือ 1 ชม.');
    expect(ticketSlaBadge(new Date(now.getTime() + 30 * 60_000).toISOString(), 'ใหม่', now)?.label).toBe('เหลือ 30 นาที');
    expect(ticketSlaBadge(hoursFromNow(-50), 'ใหม่', now)?.label).toBe('เกินกำหนด 2 วัน');
  });

  it('ไม่แสดง "0 นาที" เมื่อเพิ่งจะครบกำหนดพอดี', () => {
    expect(ticketSlaBadge(new Date(now.getTime() + 5_000).toISOString(), 'ใหม่', now)?.label).toBe('เหลือ 1 นาที');
  });
});
