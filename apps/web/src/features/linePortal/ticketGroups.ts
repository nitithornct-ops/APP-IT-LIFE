import type { TicketStatus } from '../../types/tickets';
import type { LineTicketSummary } from './types';

/**
 * ผู้แจ้งไม่ได้สนใจสถานะทั้งสิบแบบ แต่สนใจว่า "ต้องรอ" "ต้องทำอะไรต่อ" หรือ "จบแล้ว"
 * จึงยุบสถานะจริงเหลือสามกลุ่มสำหรับหน้าพอร์ทัล โดยยังใช้ชื่อสถานะจริงบนป้ายของแต่ละใบ
 */
export type LineTicketGroup = 'open' | 'awaiting' | 'closed';

export function lineTicketGroup(status: TicketStatus): LineTicketGroup {
  if (status === 'เสร็จสิ้น') return 'awaiting';
  if (status === 'ปิดงาน' || status === 'ยกเลิก') return 'closed';
  return 'open';
}

export interface LineTicketCounts {
  open: number;
  awaiting: number;
  closed: number;
}

export function countLineTickets(tickets: readonly LineTicketSummary[]): LineTicketCounts {
  return tickets.reduce<LineTicketCounts>((counts, ticket) => {
    counts[lineTicketGroup(ticket.status)] += 1;
    return counts;
  }, { open: 0, awaiting: 0, closed: 0 });
}

/**
 * ใบที่ผู้แจ้งต้องติดตามบนหน้าแรก — ใบที่รอผู้แจ้งยืนยันมาก่อนเพราะค้างอยู่ที่ตัวผู้แจ้งเอง
 * ตามด้วยใบที่ทีม IT กำลังทำ เรียงจากที่อัปเดตล่าสุด
 */
export function activeLineTickets(tickets: readonly LineTicketSummary[]): LineTicketSummary[] {
  const groupWeight: Record<LineTicketGroup, number> = { awaiting: 0, open: 1, closed: 2 };
  return tickets
    .filter((ticket) => lineTicketGroup(ticket.status) !== 'closed')
    .sort((a, b) => {
      const byGroup = groupWeight[lineTicketGroup(a.status)] - groupWeight[lineTicketGroup(b.status)];
      if (byGroup !== 0) return byGroup;
      return new Date(b.updated_at ?? b.created_at).getTime() - new Date(a.updated_at ?? a.created_at).getTime();
    });
}
