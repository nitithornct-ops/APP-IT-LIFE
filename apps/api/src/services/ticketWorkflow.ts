import { addTicketBusinessHours, ticketBusinessMinutesBetween, type TicketBusinessCalendar } from './ticketSlaService';

/**
 * State machine และการคำนวณ SLA ของ Ticket — เจ้าของเดียวของกติกาเหล่านี้
 *
 * แยกออกมาจาก routes/tickets.ts ตอนเพิ่ม bulk update เพราะถ้าปล่อยให้แต่ละ endpoint
 * เขียนเงื่อนไขเอง สองเส้นทางจะค่อย ๆ ห่างกันจนแก้ทีละใบกับแก้ทีละชุดให้ผลไม่ตรงกัน
 */

export const TICKET_STATUS = {
  NEW: 'ใหม่',
  ACK: 'รับเรื่องแล้ว',
  IN_PROGRESS: 'กำลังดำเนินการ',
  WAITING_PARTS: 'รออะไหล่',
  WAITING_USER: 'รอผู้ใช้งาน',
  OUTSOURCE: 'ส่งต่อ Outsource',
  RESOLVED: 'เสร็จสิ้น',
  CLOSED: 'ปิดงาน',
  CANCELLED: 'ยกเลิก',
  ESCALATED: 'ยกระดับเป็น Incident',
} as const;

export const ACTIVE_WORK_STATUSES: string[] = [
  TICKET_STATUS.IN_PROGRESS,
  TICKET_STATUS.WAITING_PARTS,
  TICKET_STATUS.WAITING_USER,
  TICKET_STATUS.OUTSOURCE,
  TICKET_STATUS.RESOLVED,
  TICKET_STATUS.CLOSED,
  TICKET_STATUS.CANCELLED,
  TICKET_STATUS.ESCALATED,
];

export const TRANSITIONS: Record<string, string[]> = {
  [TICKET_STATUS.NEW]: [
    TICKET_STATUS.ACK,
    TICKET_STATUS.IN_PROGRESS,
    TICKET_STATUS.OUTSOURCE,
    TICKET_STATUS.CLOSED,
    TICKET_STATUS.CANCELLED,
    TICKET_STATUS.ESCALATED,
  ],
  [TICKET_STATUS.ACK]: ACTIVE_WORK_STATUSES,
  [TICKET_STATUS.IN_PROGRESS]: ACTIVE_WORK_STATUSES,
  [TICKET_STATUS.WAITING_PARTS]: ACTIVE_WORK_STATUSES,
  [TICKET_STATUS.WAITING_USER]: ACTIVE_WORK_STATUSES,
  [TICKET_STATUS.OUTSOURCE]: ACTIVE_WORK_STATUSES,
  [TICKET_STATUS.RESOLVED]: [TICKET_STATUS.CLOSED],
  [TICKET_STATUS.CLOSED]: [],
  [TICKET_STATUS.CANCELLED]: [],
  [TICKET_STATUS.ESCALATED]: [],
};

/** สถานะที่ถือว่ารอฝ่ายอื่น จึงหยุดนับเวลา SLA ไว้ก่อน */
export const WAITING_STATUSES = new Set<string>([TICKET_STATUS.WAITING_PARTS, TICKET_STATUS.WAITING_USER]);

export function assertTransition(from: string, to: string) {
  if (!to || from === to) return;
  if (!(TRANSITIONS[from] ?? []).includes(to)) {
    throw new Error(`ไม่สามารถเปลี่ยนสถานะ Ticket จาก "${from}" เป็น "${to}" ได้`);
  }
}

/** ส่วนของ ticket row ที่การเปลี่ยนสถานะต้องใช้ */
export interface TicketStatusSource {
  status: string;
  acknowledged_at?: string | null;
  resolved_at?: string | null;
  outsource_sent_at?: string | null;
  sla_paused_at?: string | null;
  sla_paused_minutes?: number | null;
  due_at?: string | null;
}

/**
 * เติม field ที่ต้องเปลี่ยนตามสถานะใหม่ลงใน patch — timestamp ประจำสถานะ และการหยุด/นับต่อ SLA
 *
 * ไม่ครอบคลุมการเปิดงานซ้ำ (reopen) เพราะกรณีนั้นต้องรีเซ็ต due date ใหม่ทั้งชุด
 * ผู้เรียกต้องตรวจสิทธิ์และ assertTransition มาก่อนแล้ว
 */
export function applyStatusChange(
  patch: Record<string, unknown>,
  current: TicketStatusSource,
  toStatus: string,
  now: Date,
  calendar: TicketBusinessCalendar,
): void {
  const fromStatus = current.status;
  if (toStatus === fromStatus) return;

  patch.status = toStatus;
  if (toStatus === TICKET_STATUS.ACK && !current.acknowledged_at) patch.acknowledged_at = now.toISOString();
  if (toStatus === TICKET_STATUS.RESOLVED) patch.resolved_at = current.resolved_at ?? now.toISOString();
  if (toStatus === TICKET_STATUS.CLOSED) {
    patch.resolved_at = current.resolved_at ?? now.toISOString();
    patch.closed_at = now.toISOString();
  }
  if (toStatus === TICKET_STATUS.CANCELLED) patch.closed_at = now.toISOString();
  if (toStatus === TICKET_STATUS.OUTSOURCE) patch.outsource_sent_at = current.outsource_sent_at ?? now.toISOString();

  if (!current.sla_paused_at && WAITING_STATUSES.has(toStatus)) {
    patch.sla_paused_at = now.toISOString();
    return;
  }
  if (current.sla_paused_at && !WAITING_STATUSES.has(toStatus)) {
    // เลื่อนกำหนดเสร็จออกไปเท่ากับเวลาทำการที่หยุดรอไป ไม่งั้นใบที่รออะไหล่นานจะเกิน SLA
    // ทั้งที่ทีมไม่ได้ช้าเอง
    const pausedBusinessMinutes = ticketBusinessMinutesBetween(new Date(current.sla_paused_at), now, calendar);
    patch.sla_paused_at = null;
    patch.sla_paused_minutes = Number(current.sla_paused_minutes ?? 0) + pausedBusinessMinutes;
    const effectiveDueAt = patch.due_at ?? current.due_at;
    if (effectiveDueAt && pausedBusinessMinutes > 0) {
      patch.due_at = addTicketBusinessHours(new Date(String(effectiveDueAt)), pausedBusinessMinutes / 60, calendar).toISOString();
    }
  }
}

/** ต้องหยุดเวลาหรือคืนเวลา SLA ไหมเมื่อเปลี่ยนไปสถานะนี้ — ใช้ตัดสินว่าต้องโหลดปฏิทินเวลาทำการหรือไม่ */
export function changesSlaPause(current: TicketStatusSource, toStatus: string): boolean {
  return toStatus !== current.status && (WAITING_STATUSES.has(toStatus) || Boolean(current.sla_paused_at));
}
