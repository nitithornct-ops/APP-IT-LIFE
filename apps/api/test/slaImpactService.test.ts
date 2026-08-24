import { describe, expect, it } from 'vitest';
import { buildSlaImpactSummary, type SlaImpactTicket } from '../src/services/slaImpactService';
import { parseTicketBusinessCalendar } from '../src/services/ticketSlaService';

const currentCalendar = parseTicketBusinessCalendar({
  SLA_BUSINESS_START: '08:30',
  SLA_BUSINESS_END: '17:30',
  SLA_BUSINESS_DAYS: '1,2,3,4,5',
});

function ticket(overrides: Partial<SlaImpactTicket>): SlaImpactTicket {
  return {
    id: 'ticket-1',
    status: 'กำลังดำเนินการ',
    created_at: '2026-08-17T01:30:00.000Z', // Monday 08:30 Bangkok
    due_at: '2026-08-18T07:30:00.000Z', // 15 business hours later
    resolution_sla_hours: 15,
    sla_paused_at: null,
    sla_paused_minutes: 0,
    reopen_count: 0,
    ...overrides,
  };
}

describe('SLA settings impact preview', () => {
  it('compares stored deadlines with deadlines under the proposed calendar', () => {
    const shorterDays = parseTicketBusinessCalendar({
      SLA_BUSINESS_START: '09:00',
      SLA_BUSINESS_END: '15:00',
      SLA_BUSINESS_DAYS: '1,2,3,4,5',
    });
    const result = buildSlaImpactSummary({
      tickets: [ticket({})],
      currentCalendar,
      proposedCalendar: shorterDays,
      now: new Date('2026-08-17T08:30:00.000Z'), // Monday 15:30 Bangkok
    });

    expect(result.current.safe).toBe(1);
    expect(result.proposed.safe).toBe(1);
    expect(result.changes.deadlineChanged).toBe(1);
  });

  it('separates paused, overdue and terminal tickets', () => {
    const result = buildSlaImpactSummary({
      tickets: [
        ticket({ id: 'paused', sla_paused_at: '2026-08-17T05:00:00.000Z' }),
        ticket({ id: 'overdue', created_at: '2026-08-13T01:30:00.000Z', due_at: '2026-08-14T07:30:00.000Z' }),
        ticket({ id: 'closed', status: 'ปิดงาน' }),
      ],
      currentCalendar,
      proposedCalendar: currentCalendar,
      now: new Date('2026-08-17T08:30:00.000Z'),
    });

    expect(result.proposed).toMatchObject({ total: 2, paused: 1, overdue: 1 });
  });

  it('preserves the real stored deadline for reopened tickets', () => {
    const changedCalendar = parseTicketBusinessCalendar({
      SLA_BUSINESS_START: '10:00',
      SLA_BUSINESS_END: '16:00',
      SLA_BUSINESS_DAYS: '1,2,3,4,5',
    });
    const result = buildSlaImpactSummary({
      tickets: [ticket({ reopen_count: 1 })],
      currentCalendar,
      proposedCalendar: changedCalendar,
      now: new Date('2026-08-17T03:00:00.000Z'),
    });

    expect(result.changes.preservedReopened).toBe(1);
    expect(result.changes.deadlineChanged).toBe(0);
  });
});
