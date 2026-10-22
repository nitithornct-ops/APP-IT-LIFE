import { describe, expect, it } from 'vitest';
import { TRANSITIONS } from '../../../../api/src/services/ticketWorkflow';
import { ticketWorkStatuses } from './ticketFlow';
import type { TicketStatus } from '../../types/tickets';

describe('staff work actions', () => {
  it('offers only transitions accepted by the API, plus the current state for notes', () => {
    for (const [status, allowed] of Object.entries(TRANSITIONS)) {
      for (const target of ticketWorkStatuses(status as TicketStatus)) {
        expect(target === status || allowed.includes(target)).toBe(true);
        if (target !== status) expect(['ปิดงาน', 'ยกระดับเป็น Incident']).not.toContain(target);
      }
    }
  });

  it('does not send a new ticket directly to acceptance or offer a way back to new', () => {
    expect(ticketWorkStatuses('ใหม่')).not.toContain('เสร็จสิ้น');
    expect(ticketWorkStatuses('กำลังดำเนินการ')).not.toContain('ใหม่');
    expect(ticketWorkStatuses('เสร็จสิ้น')).toEqual(['เสร็จสิ้น']);
  });
});
