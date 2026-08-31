import type { TicketStatus } from '../../types/tickets';

/**
 * เส้นทาง Ticket ที่ผู้แจ้งเห็น — ใช้ร่วมกันทุกหน้าที่แสดงความคืบหน้าให้ผู้แจ้ง
 * (หน้าสาธารณะและ LINE Portal) เพื่อไม่ให้เกิด mapping สถานะซ้ำในแต่ละหน้า
 * ส่วนไอคอนและสีเป็นเรื่องของหน้า จึงไม่อยู่ในนี้
 */
export interface TicketFlowStep {
  label: string;
  description: string;
}

export const TICKET_FLOW_STEPS: TicketFlowStep[] = [
  { label: 'แจ้งเรื่อง', description: 'ระบบสร้าง Ticket' },
  { label: 'รับเรื่อง', description: 'ทีม IT ตรวจสอบ' },
  { label: 'กำลังแก้ไข', description: 'ดำเนินการและประสานงาน' },
  { label: 'รอตรวจรับ', description: 'แจ้งผลให้ผู้ใช้ยืนยัน' },
  { label: 'ปิดงาน', description: 'ยืนยันและบันทึกผล' },
];

/** สถานะที่ไม่ได้อยู่ในนี้คือสถานะที่ออกนอก flow ปกติ (ยกเลิก / ยกระดับเป็น Incident) */
const TICKET_FLOW_INDEX: Partial<Record<TicketStatus, number>> = {
  ใหม่: 0,
  รับเรื่องแล้ว: 1,
  กำลังดำเนินการ: 2,
  รออะไหล่: 2,
  รอผู้ใช้งาน: 2,
  'ส่งต่อ Outsource': 2,
  เสร็จสิ้น: 3,
  ปิดงาน: 4,
};

export interface TicketFlowWorklog {
  status_from: TicketStatus | null;
  status_to: TicketStatus | null;
}

/**
 * ขั้นปัจจุบันของใบ เมื่อสถานะออกนอก flow ปกติจะย้อนดูจาก worklog ว่าเดินไปได้ไกลสุดถึงขั้นไหน
 * แทนการตกกลับไปขั้นแรกซึ่งทำให้ผู้แจ้งเข้าใจผิดว่างานยังไม่เริ่ม
 */
export function getTicketFlowIndex(status: TicketStatus, worklogs: readonly TicketFlowWorklog[]): number {
  const currentIndex = TICKET_FLOW_INDEX[status];
  if (currentIndex !== undefined) return currentIndex;

  return worklogs.reduce((furthestStep, log) => {
    const fromIndex = log.status_from ? TICKET_FLOW_INDEX[log.status_from] : undefined;
    const toIndex = log.status_to ? TICKET_FLOW_INDEX[log.status_to] : undefined;
    return Math.max(furthestStep, fromIndex ?? 0, toIndex ?? 0);
  }, 0);
}

export function isTicketFlowInterrupted(status: TicketStatus): boolean {
  return status === 'ยกเลิก' || status === 'ยกระดับเป็น Incident';
}
