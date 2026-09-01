import { z } from 'zod';

const ticketPriorityEnum = z.enum(['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต']);

const optionalRequesterPhoneSchema = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().min(8, 'กรุณากรอกเบอร์โทรอย่างน้อย 8 ตัวอักษร').max(40).optional(),
);

export const publicSubmitTicketSchema = z.object({
  guestName: z.string().trim().min(3, 'กรุณากรอกชื่อ–นามสกุลผู้แจ้ง').max(160)
    .refine((value) => value.split(/\s+/).length >= 2, 'กรุณากรอกทั้งชื่อและนามสกุลผู้แจ้ง'),
  requesterPosition: z.string().trim().max(160).optional(),
  requesterPhone: optionalRequesterPhoneSchema,
  guestDepartment: z.string().trim().max(160).optional(),
  incidentAt: z.string().trim().refine((value) => !Number.isNaN(new Date(value).getTime()), 'วันที่และเวลาที่พบปัญหาไม่ถูกต้อง').optional(),
  erpModule: z.string().trim().max(120).optional(),
  location: z.string().trim().max(160).optional(),
  assetCode: z.string().trim().max(80).optional(),
  categoryId: z.string().uuid('กรุณาเลือกประเภทปัญหา'),
  priority: ticketPriorityEnum.optional(),
  title: z.string().trim().min(1, 'กรุณากรอกสรุปปัญหา').max(200),
  description: z.string().trim().min(1, 'กรุณากรอกรายละเอียด').max(3000),
  privacyConsent: z.literal(true, { errorMap: () => ({ message: 'กรุณายอมรับประกาศการใช้ข้อมูลส่วนบุคคลก่อนส่ง Ticket' }) }),
  turnstileToken: z.string().trim().min(1, 'กรุณายืนยันความปลอดภัยก่อนส่ง Ticket').max(2048),
  // Honeypot — a real visitor never fills this hidden field; a non-empty value marks the submission as spam.
  website: z.string().max(200).optional(),
});

export type PublicSubmitTicketInput = z.infer<typeof publicSubmitTicketSchema>;

export const publicTicketStatusQuerySchema = z.object({
  token: z.string().trim().regex(/^(?:[0-9a-f]{64}|[A-HJ-NP-Z2-9]{12}|[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2})$/i, 'รหัสติดตามไม่ถูกต้อง'),
});
