import type { TicketStatus } from '../../types/tickets';

export type TicketStatusTone = 'secondary' | 'info' | 'warning' | 'success' | 'danger' | 'primary';

export const ticketStatusTone: Record<TicketStatus, TicketStatusTone> = {
  ใหม่: 'info',
  รับเรื่องแล้ว: 'primary',
  กำลังดำเนินการ: 'primary',
  รออะไหล่: 'warning',
  รอผู้ใช้งาน: 'warning',
  'ส่งต่อ Outsource': 'warning',
  เสร็จสิ้น: 'warning',
  ปิดงาน: 'success',
  ยกเลิก: 'secondary',
  'ยกระดับเป็น Incident': 'danger',
};

export const ticketStatusLabel: Record<TicketStatus, string> = {
  ใหม่: 'ใหม่',
  รับเรื่องแล้ว: 'รับเรื่องแล้ว',
  กำลังดำเนินการ: 'กำลังดำเนินการ',
  รออะไหล่: 'รออะไหล่',
  รอผู้ใช้งาน: 'รอผู้ใช้งาน',
  'ส่งต่อ Outsource': 'ส่งต่อ Outsource',
  เสร็จสิ้น: 'ซ่อมเสร็จ (รอยืนยัน)',
  ปิดงาน: 'ปิดงานแล้ว',
  ยกเลิก: 'ยกเลิก',
  'ยกระดับเป็น Incident': 'ยกระดับเป็น Incident',
};

export const LOCKED_TICKET_STATUSES: TicketStatus[] = ['ปิดงาน', 'ยกเลิก', 'ยกระดับเป็น Incident'];

/** ถือว่างานเดินจบแล้ว จึงไม่ต้องเตือน SLA ต่อ — สถานะของใบบอกเรื่องนี้อยู่แล้ว */
const SLA_SETTLED_STATUSES: TicketStatus[] = [...LOCKED_TICKET_STATUSES, 'เสร็จสิ้น'];

/** เหลือเวลาน้อยกว่านี้ถือว่าใกล้ครบกำหนด */
export const TICKET_SLA_DUE_SOON_HOURS = 4;

export type TicketSlaState = 'overdue' | 'dueSoon';

export interface TicketSlaBadge {
  state: TicketSlaState;
  tone: Extract<TicketStatusTone, 'danger' | 'warning'>;
  label: string;
}

/**
 * ปัดลงเป็นหน่วยที่ใหญ่ที่สุดที่ยังอ่านแล้วเข้าใจ — ปัดลงเพื่อไม่ให้ "1 ชม. 55 นาที"
 * กลายเป็น "2 ชม." ซึ่งทำให้ดูเหลือเวลามากกว่าจริง
 */
function humanDuration(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)} นาที`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ชม.`;
  return `${Math.floor(hours / 24)} วัน`;
}

/**
 * ป้ายเตือน SLA ของ Ticket — คืน null เมื่อไม่ต้องเตือน (ยังไม่ถึงเวลา ไม่ได้กำหนด SLA
 * หรืองานเดินจบแล้ว) เพื่อให้ตารางแสดงป้ายเฉพาะใบที่ต้องรีบจริง ไม่ใช่ทุกแถว
 */
export function ticketSlaBadge(
  dueAt: string | null | undefined,
  status: TicketStatus,
  now: Date = new Date(),
): TicketSlaBadge | null {
  if (!dueAt || SLA_SETTLED_STATUSES.includes(status)) return null;
  const due = new Date(dueAt).getTime();
  if (Number.isNaN(due)) return null;

  const remaining = due - now.getTime();
  if (remaining < 0) return { state: 'overdue', tone: 'danger', label: `เกินกำหนด ${humanDuration(-remaining)}` };
  if (remaining <= TICKET_SLA_DUE_SOON_HOURS * 3_600_000) {
    return { state: 'dueSoon', tone: 'warning', label: `เหลือ ${humanDuration(remaining)}` };
  }
  return null;
}
