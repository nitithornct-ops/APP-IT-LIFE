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

