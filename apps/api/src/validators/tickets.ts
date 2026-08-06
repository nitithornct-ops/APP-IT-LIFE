import { paginationQuerySchema } from '@itlife/shared';
import { z } from 'zod';

const ticketPriorityEnum = z.enum(['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต']);

export const createTicketSchema = z.object({
  title: z.string().trim().min(1, 'กรุณากรอกหัวข้อปัญหา').max(200),
  categoryId: z.string().uuid('กรุณาเลือกหมวดหมู่ Ticket'),
  priority: ticketPriorityEnum.optional(),
  description: z.string().trim().min(1, 'กรุณากรอกรายละเอียด').max(3000),
  location: z.string().trim().max(160).optional(),
  requesterPhone: z.string().trim().max(40).optional(),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const listTicketsQuerySchema = paginationQuerySchema.extend({
  status: z.string().trim().max(80).optional(),
  assigneeId: z.string().uuid().optional(),
  mine: z.enum(['true', 'false']).optional(),
});

export type ListTicketsQuery = z.infer<typeof listTicketsQuerySchema>;

/**
 * Endpoint เดียวรองรับทั้ง triage/รับเรื่อง/บันทึกการดำเนินงาน/ส่งต่อ Outsource/ปิดงาน/ยกเลิก/
 * เปิดงานซ้ำ — เพราะทุก action ของระบบเดิม (acknowledgeTicket/triageTicket/updateTicketWork/
 * forwardTicketToOutsource/closeTicket/cancelTicket/reopenTicket) ที่จริงคือ "เปลี่ยนสถานะ + patch
 * บาง field + บันทึก worklog" แบบเดียวกัน ต่างกันแค่ status ปลายทางและ field ที่บังคับ ดู
 * routes/tickets.ts สำหรับ validation ตาม state machine และสิทธิ์ต่อประเภทการเปลี่ยนแปลง
 */
export const updateTicketSchema = z.object({
  status: z.string().trim().max(80).optional(),
  categoryId: z.string().uuid().optional(),
  priority: ticketPriorityEnum.optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  isSecurity: z.boolean().optional(),
  location: z.string().trim().max(160).optional(),
  note: z.string().trim().max(2000).optional(),
  minutesSpent: z.coerce.number().nonnegative().optional(),
  resolution: z.string().trim().max(2000).optional(),
  outsourceName: z.string().trim().max(200).optional(),
  outsourceIssueNo: z.string().trim().max(120).optional(),
});

export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

export const submitTicketFeedbackSchema = z.object({
  rating: z.coerce.number().int().min(1, 'คะแนนต้องอยู่ระหว่าง 1-5').max(5, 'คะแนนต้องอยู่ระหว่าง 1-5'),
  feedback: z.string().trim().max(2000).optional(),
});

export type SubmitTicketFeedbackInput = z.infer<typeof submitTicketFeedbackSchema>;
