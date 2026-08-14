import { describe, expect, it } from 'vitest';
import { addTicketBusinessHours, parseTicketBusinessCalendar, ticketBusinessMinutesBetween } from '../src/services/ticketSlaService';

describe('Legacy-compatible Ticket business SLA', () => {
  const calendar = parseTicketBusinessCalendar({
    SLA_BUSINESS_START: '08:30',
    SLA_BUSINESS_END: '17:30',
    SLA_BUSINESS_DAYS: '1,2,3,4,5',
    SLA_HOLIDAYS: '2026-08-12',
  });

  it('continues on the next working day after business hours', () => {
    const fridayAtFourPm = new Date('2026-08-14T09:00:00.000Z'); // 16:00 Bangkok
    expect(addTicketBusinessHours(fridayAtFourPm, 4, calendar).toISOString()).toBe('2026-08-17T04:00:00.000Z');
  });

  it('skips configured holidays', () => {
    const beforeHoliday = new Date('2026-08-11T09:30:00.000Z'); // 16:30 Bangkok
    expect(addTicketBusinessHours(beforeHoliday, 2, calendar).toISOString()).toBe('2026-08-13T02:30:00.000Z');
  });

  it('moves an early submission to business opening before counting', () => {
    const earlyMonday = new Date('2026-08-17T00:00:00.000Z'); // 07:00 Bangkok
    expect(addTicketBusinessHours(earlyMonday, 1, calendar).toISOString()).toBe('2026-08-17T02:30:00.000Z');
  });

  it('counts only business minutes while an SLA is paused', () => {
    const start = new Date('2026-08-11T09:30:00.000Z'); // Tue 16:30 Bangkok
    const end = new Date('2026-08-13T03:30:00.000Z'); // Thu 10:30; Wed is holiday
    expect(ticketBusinessMinutesBetween(start, end, calendar)).toBe(180);
  });
});
