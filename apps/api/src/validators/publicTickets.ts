import { z } from 'zod';

const ticketPriorityEnum = z.enum(['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต']);

export const publicSubmitTicketSchema = z.object({
  guestName: z.string().trim().min(1, 'กรุณากรอกชื่อผู้แจ้ง').max(160),
  requesterPhone: z.string().trim().max(40).optional(),
  guestDepartment: z.string().trim().max(160).optional(),
  location: z.string().trim().max(160).optional(),
  categoryId: z.string().uuid('กรุณาเลือกประเภทปัญหา'),
  priority: ticketPriorityEnum.optional(),
  title: z.string().trim().min(1, 'กรุณากรอกสรุปปัญหา').max(120),
  description: z.string().trim().min(1, 'กรุณากรอกรายละเอียด').max(1500),
  privacyConsent: z.literal(true, { errorMap: () => ({ message: 'กรุณายอมรับประกาศการใช้ข้อมูลส่วนบุคคลก่อนส่ง Ticket' }) }),
  // Honeypot — a real visitor never fills this hidden field; a non-empty value marks the submission as spam.
  website: z.string().max(200).optional(),
});

export type PublicSubmitTicketInput = z.infer<typeof publicSubmitTicketSchema>;

export const publicTicketStatusQuerySchema = z.object({
  token: z.string().trim().regex(/^[0-9a-f]{64}$/i, 'รหัสติดตามไม่ถูกต้อง'),
});
