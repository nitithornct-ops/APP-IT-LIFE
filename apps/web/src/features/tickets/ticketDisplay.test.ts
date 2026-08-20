import { describe, expect, it } from 'vitest';
import { LOCKED_TICKET_STATUSES, ticketStatusLabel, ticketStatusTone } from './ticketDisplay';

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
