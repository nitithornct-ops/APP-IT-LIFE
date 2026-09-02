import type { TicketDetail, TicketWorklog } from '../../types/tickets';

/**
 * บทสนทนาระหว่างผู้แจ้งกับช่างผู้ดำเนินการเก็บอยู่ใน ticket_worklogs ตารางเดียวกับไทม์ไลน์
 * แยกกันด้วย entry_type — ตรรกะการอ่านฝั่งผู้พูดอยู่ที่นี่เพื่อให้ทุกหน้าจอตัดสินเหมือนกัน
 */

/** สถานะที่จบแล้ว — ตรงกับกฎฝั่ง API (routes/tickets.ts) ที่ไม่รับข้อความสาธารณะเพิ่ม */
export const CONVERSATION_LOCKED_STATUSES = ['ปิดงาน', 'ยกเลิก'];

export type ConversationSide = 'requester' | 'staff';

export function isConversationEntry(log: TicketWorklog): boolean {
  return log.entry_type === 'comment' || log.entry_type === 'internal_note';
}

/**
 * ฝั่งของผู้พูด — ผู้แจ้งคือคนที่เปิดใบ ไม่ว่าจะเข้ามาทางเว็บ (actor_id ตรงกับ requester_id)
 * ทาง LINE (มี actor_line_user_id) หรือแบบ guest ที่ไม่มีบัญชี (ไม่มี actor_id เลย)
 * ที่เหลือคือเจ้าหน้าที่/ช่างผู้ดำเนินการ
 */
export function conversationSide(log: TicketWorklog, requesterId: string): ConversationSide {
  if (log.actor_line_user_id) return 'requester';
  if (!log.actor_id) return 'requester';
  return log.actor_id === requesterId ? 'requester' : 'staff';
}

/** ป้ายชื่อผู้พูดที่ผู้อ่านต้องเห็น — ของตัวเองขึ้น "คุณ" ที่เหลือบอกชื่อพร้อมบทบาทในใบงาน */
export function conversationAuthor(log: TicketWorklog, ticket: TicketDetail, viewerId?: string): string {
  if (viewerId && log.actor_id === viewerId) return 'คุณ';
  if (conversationSide(log, ticket.requester_id) === 'requester') {
    const name = log.actor?.full_name
      ?? ticket.requester?.full_name
      ?? ticket.requester_name_snapshot
      ?? ticket.guest_name
      ?? 'ผู้แจ้ง';
    return `${name} · ผู้แจ้ง`;
  }
  const staffName = log.actor?.full_name ?? log.actor_label ?? 'ทีม IT';
  return log.actor_id === ticket.assignee_id ? `${staffName} · ช่างผู้ดำเนินการ` : `${staffName} · ทีม IT`;
}
