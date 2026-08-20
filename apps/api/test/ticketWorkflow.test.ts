import { describe, expect, it } from 'vitest';
import { DEFAULT_TICKET_BUSINESS_CALENDAR } from '../src/services/ticketSlaService';
import {
  TICKET_STATUS,
  applyStatusChange,
  assertTransition,
  changesSlaPause,
  type TicketStatusSource,
} from '../src/services/ticketWorkflow';

const calendar = DEFAULT_TICKET_BUSINESS_CALENDAR;
const now = new Date('2026-08-20T03:00:00.000Z'); // 10:00 น. เวลาไทย ซึ่งอยู่ในเวลาทำการ

function ticket(overrides: Partial<TicketStatusSource> = {}): TicketStatusSource {
  return { status: TICKET_STATUS.IN_PROGRESS, ...overrides };
}

describe('assertTransition', () => {
  it('ยอมให้เปลี่ยนไปสถานะที่อยู่ในเส้นทางของ state machine', () => {
    expect(() => assertTransition(TICKET_STATUS.NEW, TICKET_STATUS.ACK)).not.toThrow();
    expect(() => assertTransition(TICKET_STATUS.RESOLVED, TICKET_STATUS.CLOSED)).not.toThrow();
  });

  it('ปฏิเสธการข้ามขั้น และการแก้ใบที่ปิดไปแล้ว', () => {
    expect(() => assertTransition(TICKET_STATUS.NEW, TICKET_STATUS.RESOLVED)).toThrow();
    expect(() => assertTransition(TICKET_STATUS.CLOSED, TICKET_STATUS.IN_PROGRESS)).toThrow();
    expect(() => assertTransition(TICKET_STATUS.CANCELLED, TICKET_STATUS.ACK)).toThrow();
  });

  it('ไม่ถือว่าผิดเมื่อสถานะไม่เปลี่ยน', () => {
    expect(() => assertTransition(TICKET_STATUS.CLOSED, TICKET_STATUS.CLOSED)).not.toThrow();
    expect(() => assertTransition(TICKET_STATUS.CLOSED, '')).not.toThrow();
  });
});

describe('applyStatusChange', () => {
  it('ไม่แตะ patch เมื่อสถานะไม่เปลี่ยน', () => {
    const patch: Record<string, unknown> = {};
    applyStatusChange(patch, ticket(), TICKET_STATUS.IN_PROGRESS, now, calendar);
    expect(patch).toEqual({});
  });

  it('ประทับเวลารับเรื่องครั้งแรกเท่านั้น', () => {
    const first: Record<string, unknown> = {};
    applyStatusChange(first, ticket({ status: TICKET_STATUS.NEW }), TICKET_STATUS.ACK, now, calendar);
    expect(first.acknowledged_at).toBe(now.toISOString());

    const again: Record<string, unknown> = {};
    applyStatusChange(
      again,
      ticket({ status: TICKET_STATUS.NEW, acknowledged_at: '2026-08-01T00:00:00.000Z' }),
      TICKET_STATUS.ACK,
      now,
      calendar,
    );
    expect(again.acknowledged_at).toBeUndefined();
  });

  it('ปิดงานแล้วบันทึกทั้งเวลาแก้เสร็จและเวลาปิด', () => {
    const patch: Record<string, unknown> = {};
    applyStatusChange(patch, ticket({ status: TICKET_STATUS.RESOLVED }), TICKET_STATUS.CLOSED, now, calendar);
    expect(patch.resolved_at).toBe(now.toISOString());
    expect(patch.closed_at).toBe(now.toISOString());
  });

  it('หยุดนับ SLA เมื่อเข้าสถานะรอ', () => {
    const patch: Record<string, unknown> = {};
    applyStatusChange(patch, ticket(), TICKET_STATUS.WAITING_PARTS, now, calendar);
    expect(patch.sla_paused_at).toBe(now.toISOString());
  });

  it('คืนเวลาที่หยุดรอกลับเข้าไปในกำหนดเสร็จเมื่อกลับมาทำต่อ', () => {
    const pausedAt = new Date(now.getTime() - 2 * 3_600_000).toISOString();
    const dueAt = new Date(now.getTime() + 3_600_000).toISOString();
    const patch: Record<string, unknown> = {};

    applyStatusChange(
      patch,
      ticket({ status: TICKET_STATUS.WAITING_PARTS, sla_paused_at: pausedAt, sla_paused_minutes: 30, due_at: dueAt }),
      TICKET_STATUS.IN_PROGRESS,
      now,
      calendar,
    );

    expect(patch.sla_paused_at).toBeNull();
    expect(Number(patch.sla_paused_minutes)).toBeGreaterThan(30);
    expect(new Date(String(patch.due_at)).getTime()).toBeGreaterThan(new Date(dueAt).getTime());
  });

  it('ไม่หยุดนับซ้ำเมื่อย้ายจากสถานะรอหนึ่งไปอีกสถานะรอหนึ่ง', () => {
    const pausedAt = new Date(now.getTime() - 3_600_000).toISOString();
    const patch: Record<string, unknown> = {};
    applyStatusChange(
      patch,
      ticket({ status: TICKET_STATUS.WAITING_PARTS, sla_paused_at: pausedAt }),
      TICKET_STATUS.WAITING_USER,
      now,
      calendar,
    );
    expect(patch.sla_paused_at).toBeUndefined();
    expect(patch.status).toBe(TICKET_STATUS.WAITING_USER);
  });
});

describe('changesSlaPause', () => {
  it('บอกว่าต้องโหลดปฏิทินเวลาทำการเมื่อเข้าหรือออกจากสถานะรอเท่านั้น', () => {
    expect(changesSlaPause(ticket(), TICKET_STATUS.WAITING_PARTS)).toBe(true);
    const paused = ticket({ status: TICKET_STATUS.WAITING_PARTS, sla_paused_at: now.toISOString() });
    expect(changesSlaPause(paused, TICKET_STATUS.IN_PROGRESS)).toBe(true);
    expect(changesSlaPause(ticket(), TICKET_STATUS.RESOLVED)).toBe(false);
    // สถานะไม่เปลี่ยน = ไม่ต้องคำนวณอะไรเลย แม้ใบนั้นจะหยุดเวลาค้างอยู่
    expect(changesSlaPause(ticket(), TICKET_STATUS.IN_PROGRESS)).toBe(false);
  });
});
