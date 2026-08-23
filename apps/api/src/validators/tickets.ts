import { listQuerySchema, ticketRatingDetailsSchema } from '@itlife/shared';
import { z } from 'zod';

const ticketPriorityEnum = z.enum(['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต']);

export const createTicketSchema = z.object({
  title: z.string().trim().min(1, 'กรุณากรอกหัวข้อปัญหา').max(200),
  categoryId: z.string().uuid('กรุณาเลือกหมวดหมู่ Ticket'),
  priority: ticketPriorityEnum.optional(),
  description: z.string().trim().min(1, 'กรุณากรอกรายละเอียด').max(3000),
  location: z.string().trim().max(160).optional(),
  requesterPhone: z.string().trim().max(40).optional(),
  assetId: z.string().uuid().optional(),
  isSecurity: z.boolean().optional(),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const listTicketsQuerySchema = listQuerySchema.extend({
  status: z.string().trim().max(80).optional(),
  categoryId: z.string().uuid().optional(),
  priority: ticketPriorityEnum.optional(),
  search: z.string().trim().max(120).optional(),
  assigneeId: z.string().uuid().optional(),
  mine: z.enum(['true', 'false']).optional(),
});

export type ListTicketsQuery = z.infer<typeof listTicketsQuerySchema>;

/**
 * สถานะที่เปลี่ยนแบบทีละหลายใบได้ — จงใจไม่รวมปิดงาน/ยกเลิก/ส่งต่อ Outsource/ยกระดับ
 * เพราะแต่ละอย่างต้องการข้อมูลเฉพาะใบ (ผลการแก้ไข เหตุผลยกเลิก ชื่อผู้ให้บริการ)
 * ถ้าให้กรอกครั้งเดียวแล้วใช้กับทุกใบ จะได้ข้อมูลที่ดูเหมือนครบแต่ไม่ตรงกับงานจริง
 */
export const BULK_TICKET_STATUSES = ['รับเรื่องแล้ว', 'กำลังดำเนินการ', 'รออะไหล่', 'รอผู้ใช้งาน'] as const;

export const bulkUpdateTicketsSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1, 'กรุณาเลือกอย่างน้อย 1 รายการ').max(50, 'ทำได้ครั้งละไม่เกิน 50 รายการ'),
    status: z.enum(BULK_TICKET_STATUSES).optional(),
    assigneeId: z.string().uuid().nullable().optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .refine((body) => body.status !== undefined || body.assigneeId !== undefined, {
    message: 'กรุณาระบุสถานะหรือผู้รับผิดชอบที่ต้องการเปลี่ยน',
  });

export type BulkUpdateTicketsInput = z.infer<typeof bulkUpdateTicketsSchema>;


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
  /** สาเหตุที่แท้จริงของปัญหา — คนละอย่างกับ resolution ซึ่งเป็นสิ่งที่ทำไปเพื่อแก้ */
  rootCause: z.string().trim().max(500).optional(),
  outsourceName: z.string().trim().max(200).optional(),
  outsourceVendorId: z.union([z.string().uuid(), z.literal('')]).optional(),
  outsourceIssueNo: z.string().trim().max(120).optional(),
});

export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

export const addTicketConversationSchema = z.object({
  message: z.string().trim().min(1, 'กรุณากรอกข้อความ').max(2000),
  visibility: z.enum(['public', 'internal']).default('public'),
});

export type AddTicketConversationInput = z.infer<typeof addTicketConversationSchema>;

export const submitTicketFeedbackSchema = z.object({
  ratings: ticketRatingDetailsSchema,
  feedback: z.string().trim().max(2000).optional(),
});

export type SubmitTicketFeedbackInput = z.infer<typeof submitTicketFeedbackSchema>;
